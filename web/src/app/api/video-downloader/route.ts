export const runtime = "edge";
export const dynamic = "force-dynamic";

const ALLOWED_HOSTS = new Set(["facebook.com","www.facebook.com","m.facebook.com","fb.watch","youtube.com","www.youtube.com","m.youtube.com","youtu.be","instagram.com","www.instagram.com","tiktok.com","www.tiktok.com","vm.tiktok.com","vt.tiktok.com","twitter.com","www.twitter.com","x.com","www.x.com","pinterest.com","www.pinterest.com","pin.it"]);

function json(data: unknown, status = 200, extraHeaders?: Record<string, string>) { return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extraHeaders } }); }

const QUOTA_HEADERS = ["x-ratelimit-requests-limit", "x-ratelimit-requests-remaining", "x-ratelimit-requests-reset"];
function extractQuotaHeaders(h: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of QUOTA_HEADERS) {
    const v = h.get(key);
    if (v !== null) out[key] = v;
  }
  return out;
}

/**
 * Three RapidAPI providers, tried in order as a fallback chain.
 * Each is a SEPARATE API subscription under the same account, so each
 * has its own independent monthly quota (confirmed via the account's
 * Subscriptions & Usage page: each API shows its own % usage, not a
 * shared/pooled number) — unlike multiple keys on the SAME API, which
 * do share one quota.
 *
 * Providers 1 & 2 share the same request/response shape
 * (/v1/social/autolink, { url }, { medias: [...] }). Provider 3 has a
 * different endpoint, request body and (unconfirmed, provider was
 * returning "API unreachable" at integration time) response shape, so
 * it gets its own request builder + response normalizer to still
 * return the same DownloaderResult shape the frontend expects.
 *
 * Env vars (comma-separated for multiple keys on one provider):
 *   RAPIDAPI_KEY           -> social-download-all-in-one.p.rapidapi.com
 *   RAPIDAPI_KEY_ZM        -> zm-api.p.rapidapi.com
 *   RAPIDAPI_KEY_AIOSAVER  -> all-in-one-social-media-saver-api.p.rapidapi.com
 */
type DownloaderMedia = { url: string; quality?: string; extension?: string; type?: string };
type NormalizedResult = { url?: string; source?: string; author?: string; title?: string; thumbnail?: string; duration?: number; medias: DownloaderMedia[]; type?: string; error: boolean; message?: string };

type ProviderConfig = {
  host: string;
  keys: string[];
  buildRequest: (targetUrl: string) => { path: string; body: unknown };
  normalize: (data: unknown) => NormalizedResult;
};

function parseKeys(raw: string | undefined): string[] {
  return (raw || "").split(",").map((k) => k.trim()).filter(Boolean);
}

// Providers 1 & 2: identical /v1/social/autolink shape.
function buildAutolinkRequest(targetUrl: string) {
  return { path: "/v1/social/autolink", body: { url: targetUrl } };
}
function normalizeAutolink(data: unknown): NormalizedResult {
  const d = (data || {}) as Record<string, unknown>;
  return {
    url: typeof d.url === "string" ? d.url : undefined,
    source: typeof d.source === "string" ? d.source : undefined,
    author: typeof d.author === "string" ? d.author : undefined,
    title: typeof d.title === "string" ? d.title : undefined,
    thumbnail: typeof d.thumbnail === "string" ? d.thumbnail : undefined,
    duration: typeof d.duration === "number" ? d.duration : undefined,
    medias: Array.isArray(d.medias) ? (d.medias as DownloaderMedia[]) : [],
    type: typeof d.type === "string" ? d.type : undefined,
    error: Boolean(d.error),
    message: typeof d.message === "string" ? d.message : undefined,
  };
}

// Provider 3: downloadContent endpoint, different request body.
// Response shape is unconfirmed (provider was down at integration
// time), so this normalizer tries a few plausible shapes defensively
// rather than assuming one. If it turns out wrong once the provider
// is reachable, only this function needs adjusting.
function buildAiosaverRequest(targetUrl: string) {
  return { path: "/downloadContent", body: { url: targetUrl, format: "mp4", quality: "high" } };
}
function normalizeAiosaver(data: unknown): NormalizedResult {
  const d = (data || {}) as Record<string, unknown>;
  // Try common alternate field names this style of API tends to use.
  const rawMedias = d.medias ?? d.media ?? d.links ?? d.downloads ?? d.data;
  let medias: DownloaderMedia[] = [];
  if (Array.isArray(rawMedias)) {
    medias = rawMedias
      .map((m) => {
        if (typeof m === "string") return { url: m };
        if (m && typeof m === "object") {
          const mm = m as Record<string, unknown>;
          const url = mm.url ?? mm.link ?? mm.downloadUrl;
          if (typeof url === "string") return { url, quality: typeof mm.quality === "string" ? mm.quality : undefined, extension: typeof mm.extension === "string" ? mm.extension : undefined, type: typeof mm.type === "string" ? mm.type : undefined };
        }
        return null;
      })
      .filter((m): m is DownloaderMedia => m !== null);
  } else if (typeof d.downloadUrl === "string") {
    medias = [{ url: d.downloadUrl }];
  } else if (typeof d.url === "string" && d.url !== undefined) {
    // Some APIs echo the input url AND give a separate output link field; only
    // treat `url` as a media link if there's no better candidate above.
  }
  const hasError = Boolean(d.error) || typeof d.messages === "string" || (typeof d.message === "string" && medias.length === 0);
  return {
    title: typeof d.title === "string" ? d.title : undefined,
    author: typeof d.author === "string" ? d.author : undefined,
    thumbnail: typeof d.thumbnail === "string" ? d.thumbnail : undefined,
    medias,
    error: hasError,
    message: typeof d.messages === "string" ? d.messages : (typeof d.message === "string" ? d.message : (hasError ? "This provider returned an unrecognized response." : undefined)),
  };
}

function getProviders(): ProviderConfig[] {
  const providers: ProviderConfig[] = [];
  const primaryKeys = parseKeys(process.env.RAPIDAPI_KEY);
  if (primaryKeys.length > 0) providers.push({ host: "social-download-all-in-one.p.rapidapi.com", keys: primaryKeys, buildRequest: buildAutolinkRequest, normalize: normalizeAutolink });
  const zmKeys = parseKeys(process.env.RAPIDAPI_KEY_ZM);
  if (zmKeys.length > 0) providers.push({ host: "zm-api.p.rapidapi.com", keys: zmKeys, buildRequest: buildAutolinkRequest, normalize: normalizeAutolink });
  const aiosaverKeys = parseKeys(process.env.RAPIDAPI_KEY_AIOSAVER);
  if (aiosaverKeys.length > 0) providers.push({ host: "all-in-one-social-media-saver-api.p.rapidapi.com", keys: aiosaverKeys, buildRequest: buildAiosaverRequest, normalize: normalizeAiosaver });
  return providers;
}

export async function POST(request: Request) {
  const providers = getProviders();
  if (providers.length === 0) return json({ error: true, message: "Server configuration missing: RAPIDAPI_KEY" }, 500);

  let body: { url?: unknown };
  try { body = await request.json(); } catch { return json({ error: true, message: "Invalid JSON request." }, 400); }
  if (typeof body.url !== "string" || body.url.length > 4096) return json({ error: true, message: "Please provide a valid video URL." }, 400);
  let parsed: URL;
  try { parsed = new URL(body.url); } catch { return json({ error: true, message: "The video URL is invalid." }, 400); }
  if (!["https:","http:"].includes(parsed.protocol)) return json({ error: true, message: "Only HTTP and HTTPS links are supported." }, 400);
  if (!ALLOWED_HOSTS.has(parsed.hostname.toLowerCase())) return json({ error: true, message: "This website is not in the supported platform list." }, 400);

  let lastQuota: Record<string, string> = {};
  const attempts: { provider: ProviderConfig; key: string }[] = [];
  for (const provider of providers) {
    for (const key of provider.keys) attempts.push({ provider, key });
  }

  for (let i = 0; i < attempts.length; i++) {
    const { provider, key } = attempts[i];
    const isLastAttempt = i === attempts.length - 1;
    const { path, body: reqBody } = provider.buildRequest(parsed.toString());
    const url = `https://${provider.host}${path}`;
    try {
      const upstream = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "X-RapidAPI-Host": provider.host, "X-RapidAPI-Key": key }, body: JSON.stringify(reqBody) });
      const quota = extractQuotaHeaders(upstream.headers);
      lastQuota = quota;
      // Quota exhausted / forbidden on this key: try the next key/provider instead of returning the error.
      if ((upstream.status === 429 || upstream.status === 403) && !isLastAttempt) continue;
      const raw = await upstream.text();
      let data: unknown;
      try { data = JSON.parse(raw); } catch {
        if (!isLastAttempt) continue;
        return json({ error: true, message: "Video provider returned an invalid response." }, 502, quota);
      }
      const normalized = provider.normalize(data);
      // Provider-level failure (e.g. "API unreachable" from the backend)
      // with more attempts left: fall through to the next provider instead
      // of surfacing a confusing error.
      if (normalized.error && !isLastAttempt && (normalized.medias.length === 0)) continue;
      return json(normalized, upstream.ok ? 200 : upstream.status, quota);
    } catch {
      if (!isLastAttempt) continue;
      return json({ error: true, message: "Could not connect to the video provider. Please try again." }, 502, lastQuota);
    }
  }
  return json({ error: true, message: "All providers have exhausted their quota." }, 429, lastQuota);
}
