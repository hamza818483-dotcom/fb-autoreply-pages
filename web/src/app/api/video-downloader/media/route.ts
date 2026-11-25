export const runtime = "edge";
export const dynamic = "force-dynamic";

const ALLOWED_HOSTS = new Set([
  "facebook.com", "www.facebook.com", "m.facebook.com", "fb.watch",
  "youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be",
  "instagram.com", "www.instagram.com",
  "tiktok.com", "www.tiktok.com", "vm.tiktok.com", "vt.tiktok.com",
  "twitter.com", "www.twitter.com", "x.com", "www.x.com",
  "pinterest.com", "www.pinterest.com", "pin.it"
]);

function allowedOrigin(request: Request): string | null {
  const origin = request.headers.get("Origin");
  if (!origin) return null;
  if (origin === new URL(request.url).origin) return origin;
  const allowed = (process.env.ATLAS_ALLOWED_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean);
  return allowed.includes(origin) ? origin : null;
}
function corsHeaders(request: Request): Record<string, string> {
  const origin = allowedOrigin(request);
  return origin ? {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Range, If-Range",
    "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges, ETag, Last-Modified",
    "Vary": "Origin",
  } : {};
}
function error(request: Request, message: string, status = 400) {
  return new Response(JSON.stringify({ error: true, message }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...corsHeaders(request) }
  });
}
export async function OPTIONS(request: Request) {
  if (request.headers.get("Origin") && !allowedOrigin(request)) return new Response(null, { status: 403 });
  return new Response(null, { status: 204, headers: { ...corsHeaders(request), "Access-Control-Max-Age": "86400" } });
}

function parseList(raw: string | undefined): string[] {
  return (raw || "").split(",").map((s) => s.trim()).filter(Boolean);
}

// Minimal KV binding shape (avoids pulling in @cloudflare/workers-types just
// for this). Present only when VIDEO_CACHE is bound in Cloudflare Pages
// (Settings -> Functions -> KV namespace bindings). Falls back to an
// in-memory cache (best-effort within one warm edge instance) if unbound,
// so this still works before/without the KV binding being configured.
type KVLike = {
  get: (key: string, type?: "text") => Promise<string | null>;
  put: (key: string, value: string, opts?: { expirationTtl?: number }) => Promise<void>;
};

function getKv(): KVLike | null {
  // @cloudflare/next-on-pages (used in this project, see layout.tsx) exposes
  // bound resources like KV namespaces through process.env, the same way it
  // already exposes RAPIDAPI_KEY/RAPIDAPI_HOSTS above — so this mirrors that.
  const kv = (process.env as unknown as Record<string, unknown>).VIDEO_CACHE as KVLike | undefined;
  return kv && typeof kv.get === "function" && typeof kv.put === "function" ? kv : null;
}

// In-memory fallback, used when KV isn't bound (or as a fast first check
// before hitting KV) — same role as before, just now backed by KV too.
const MEDIA_URL_CACHE = new Map<string, { url: string; at: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes — long enough for one edit session
const CACHE_TTL_SEC = 300;

function cacheKey(source: string): string {
  return `media-url:${source}`;
}

function getMemCached(source: string): string | null {
  const hit = MEDIA_URL_CACHE.get(source);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) { MEDIA_URL_CACHE.delete(source); return null; }
  return hit.url;
}

async function getCachedMediaUrl(source: string): Promise<string | null> {
  const mem = getMemCached(source);
  if (mem) return mem;
  const kv = getKv();
  if (!kv) return null;
  try {
    const stored = await kv.get(cacheKey(source), "text");
    if (stored) { MEDIA_URL_CACHE.set(source, { url: stored, at: Date.now() }); return stored; }
  } catch {
    // KV unavailable/misconfigured — fall through to a fresh lookup.
  }
  return null;
}

async function setCachedMediaUrl(source: string, mediaUrl: string): Promise<void> {
  MEDIA_URL_CACHE.set(source, { url: mediaUrl, at: Date.now() });
  const kv = getKv();
  if (!kv) return;
  try {
    await kv.put(cacheKey(source), mediaUrl, { expirationTtl: CACHE_TTL_SEC });
  } catch {
    // Non-fatal — in-memory cache still has it for this instance.
  }
}

// In-flight de-dup: if several Range requests for the same source arrive
// concurrently (typical on initial <video> load), only the first actually
// calls RapidAPI; the rest await the same promise.
const INFLIGHT = new Map<string, Promise<string | null>>();

async function lookupMediaUrl(source: string): Promise<string | null> {
  const hosts = parseList(process.env.RAPIDAPI_HOSTS);
  const apiKey = process.env.RAPIDAPI_KEY;
  if (hosts.length === 0 || !apiKey) return null;

  for (const host of hosts) {
    try {
      const special = host === "all-in-one-social-media-saver-api.p.rapidapi.com";
      const lookup = await fetch(`https://${host}${special ? "/downloadContent" : "/v1/social/autolink"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-RapidAPI-Host": host, "X-RapidAPI-Key": apiKey },
        body: JSON.stringify(special ? { url: source, format: "mp4", quality: "high" } : { url: source })
      });
      if (lookup.status === 429 || lookup.status === 403) continue; // quota exhausted on this host, try next
      if (!lookup.ok) continue;
      const data = await lookup.json() as { medias?: Array<{ url?: string; extension?: string; type?: string; quality?: string }>; media?: unknown; links?: unknown; downloads?: unknown; data?: unknown; downloadUrl?: string };
      const rawMedias = data.medias ?? data.media ?? data.links ?? data.downloads ?? data.data;
      const medias = Array.isArray(rawMedias)
        ? rawMedias.map((item) => typeof item === "string" ? { url: item } : item as { url?: string; extension?: string; type?: string; quality?: string })
        : typeof data.downloadUrl === "string" ? [{ url: data.downloadUrl }] : [];
      const candidates = medias.filter((m) => typeof m.url === "string" && /^https:\/\//i.test(m.url));
      candidates.sort((a, b) => {
        const aMp4 = a.extension?.toLowerCase() === "mp4" ? 1 : 0;
        const bMp4 = b.extension?.toLowerCase() === "mp4" ? 1 : 0;
        return bMp4 - aMp4;
      });
      const mediaUrl = candidates[0]?.url;
      if (mediaUrl) return mediaUrl;
    } catch {
      continue;
    }
  }
  return null;
}

async function resolveMediaUrl(source: string): Promise<string | null> {
  const cached = await getCachedMediaUrl(source);
  if (cached) return cached;

  const existing = INFLIGHT.get(source);
  if (existing) return existing;

  const promise = lookupMediaUrl(source).then(async (mediaUrl) => {
    INFLIGHT.delete(source);
    if (mediaUrl) await setCachedMediaUrl(source, mediaUrl);
    return mediaUrl;
  }).catch((err) => {
    INFLIGHT.delete(source);
    throw err;
  });
  INFLIGHT.set(source, promise);
  return promise;
}

export async function GET(request: Request) {
  const source = new URL(request.url).searchParams.get("url");
  if (!source || source.length > 4096) return error(request, "Please provide a video URL.");
  let parsed: URL;
  try { parsed = new URL(source); } catch { return error(request, "The video URL is invalid."); }
  if (!["http:", "https:"].includes(parsed.protocol) || !ALLOWED_HOSTS.has(parsed.hostname.toLowerCase())) {
    return error(request, "This video platform is not supported.");
  }

  try {
    const mediaUrl = await resolveMediaUrl(parsed.toString());
    if (!mediaUrl) return error(request, "এই লিংকের জন্য downloadable video পাওয়া যায়নি।", 404);

    // Pass byte-range requests through so Mediabunny UrlSource can fetch only
    // the MP4 metadata and selected media packets instead of buffering the file.
    const range = request.headers.get("Range");
    const upstreamHeaders = new Headers();
    if (range && /^bytes=\d*-\d*(,\d*-\d*)*$/.test(range)) {
      upstreamHeaders.set("Range", range);
      const ifRange = request.headers.get("If-Range");
      if (ifRange) upstreamHeaders.set("If-Range", ifRange);
    }
    const media = await fetch(mediaUrl, { headers: upstreamHeaders });
    if (!(media.ok || media.status === 206) || !media.body) {
      return error(request, `Video file could not be fetched (upstream HTTP ${media.status}). Try another link.`, 502);
    }
    const headers = new Headers();
    headers.set("Content-Type", media.headers.get("Content-Type") || "video/mp4");
    headers.set("Cache-Control", "no-store");
    for (const [name, value] of Object.entries(corsHeaders(request))) headers.set(name, value);
    headers.set("Content-Disposition", 'inline; filename="source-video.mp4"');
    for (const name of ["Content-Length", "Content-Range", "Accept-Ranges", "ETag", "Last-Modified"]) {
      const value = media.headers.get(name);
      if (value) headers.set(name, value);
    }
    // Preserve 206 only when the upstream actually honored the range.
    return new Response(media.body, { status: media.status, headers });
  } catch {
    return error(request, "Could not fetch this video. It may be private, unavailable, or blocked by the provider.", 502);
  }
}
