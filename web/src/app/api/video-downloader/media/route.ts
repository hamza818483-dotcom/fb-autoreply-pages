export const runtime = "edge";
export const dynamic = "force-dynamic";

const ALLOWED_HOSTS = new Set([
  "facebook.com", "www.facebook.com", "m.facebook.com", "fb.watch",
  "youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be",
  "instagram.com", "www.instagram.com",
  "tiktok.com", "www.tiktok.com", "vm.tiktok.com", "vt.tiktok.com",
  "twitter.com", "www.twitter.com", "x.com", "www.x.com",
  "pinterest.com", "www.pinterest.com", "pin.it",
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
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...corsHeaders(request) },
  });
}
export async function OPTIONS(request: Request) {
  if (request.headers.get("Origin") && !allowedOrigin(request)) return new Response(null, { status: 403 });
  return new Response(null, { status: 204, headers: { ...corsHeaders(request), "Access-Control-Max-Age": "86400" } });
}

export async function GET(request: Request) {
  const backend = process.env.RENDER_API_URL?.trim().replace(/\/+$/, "");
  const apiKey = process.env.SELF_API_KEY;
  if (!backend || !apiKey) return error(request, "Video Saver backend is not configured yet.", 503);

  const sourceValue = new URL(request.url).searchParams.get("url");
  if (!sourceValue || sourceValue.length > 4096) return error(request, "Please provide a video URL.");
  let source: URL;
  try { source = new URL(sourceValue); } catch { return error(request, "The video URL is invalid."); }
  if (!["http:", "https:"].includes(source.protocol) || !ALLOWED_HOSTS.has(source.hostname.toLowerCase())) {
    return error(request, "This video platform is not supported.");
  }

  try {
    const endpoint = new URL("/extract", backend);
    endpoint.searchParams.set("url", source.toString());
    const lookup = await fetch(endpoint.toString(), {
      headers: { "x-api-key": apiKey, "Accept": "application/json" },
      signal: AbortSignal.timeout(110000),
    });
    const data = await lookup.json().catch(() => ({})) as {
      detail?: string | { message?: string; code?: string; cause?: string; hint?: string };
      medias?: Array<{ url?: string; format_id?: string; vcodec?: string; ext?: string }>;
    };
    if (!lookup.ok) {
      const detail = data.detail;
      const message = typeof detail === "string" ? detail
        : detail && typeof detail.message === "string" ? detail.message
        : "Could not resolve this video.";
      const diagnostic = detail && typeof detail === "object"
        ? [detail.code, detail.cause, detail.hint].filter(Boolean).join(" — ")
        : "";
      return error(request, diagnostic ? `${message} ${diagnostic}` : message, lookup.status);
    }

    const formatId = new URL(request.url).searchParams.get("format_id");
    if (formatId && !/^[A-Za-z0-9._+-]{1,80}$/.test(formatId)) return error(request, "The selected format is invalid.");
    const selected = formatId
      ? (data.medias || []).find((item) => item.url && item.format_id === formatId)
      : (data.medias || []).find((item) => item.url && item.vcodec && item.vcodec !== "none");
    if (!selected?.url) return error(request, "The selected download format is no longer available. Fetch the link again.", 404);

    const range = request.headers.get("Range");
    const upstreamHeaders = new Headers();
    if (range && /^bytes=\d*-\d*(,\d*-\d*)*$/.test(range)) {
      upstreamHeaders.set("Range", range);
      const ifRange = request.headers.get("If-Range");
      if (ifRange) upstreamHeaders.set("If-Range", ifRange);
    }
    const media = await fetch(selected.url, { headers: upstreamHeaders, redirect: "follow" });
    if (!(media.ok || media.status === 206) || !media.body) {
      return error(request, `Media host returned HTTP ${media.status}.`, 502);
    }

    const extension = (selected.ext || "mp4").toLowerCase().replace(/[^a-z0-9]/g, "") || "mp4";
    const requestedName = new URL(request.url).searchParams.get("filename") || "video";
    const cleanName = requestedName.normalize("NFKC").replace(/[\\u0000-\\u001f\\u007f]/g, "").replace(/[\\\\/:"*?<>|]/g, "").trim().slice(0, 100) || "video";
    const asciiName = cleanName.replace(/[^\\x20-\\x7E]/g, "_").replace(/["\\\\]/g, "_") || "video";
    const encodedName = encodeURIComponent(cleanName).replace(/['()]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
    const fallbackType = extension === "webm" ? "video/webm"
      : extension === "m4a" ? "audio/mp4"
      : extension === "mp3" ? "audio/mpeg"
      : extension === "mp4" ? "video/mp4"
      : "application/octet-stream";
    const upstreamType = media.headers.get("Content-Type");
    const contentType = upstreamType && !upstreamType.toLowerCase().includes("application/octet-stream")
      ? upstreamType : fallbackType;
    const headers = new Headers({
      "Content-Type": contentType,
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${asciiName}.${extension}"; filename*=UTF-8''${encodedName}.${extension}`,
      ...corsHeaders(request),
    });
    for (const name of ["Content-Length", "Content-Range", "Accept-Ranges", "ETag", "Last-Modified"]) {
      const value = media.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new Response(media.body, { status: media.status, headers });
  } catch {
    return error(request, "Could not fetch this video. It may be private, unavailable, or blocked by its platform.", 502);
  }
}
