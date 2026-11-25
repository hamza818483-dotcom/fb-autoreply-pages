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

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Video-Provider": "SELF_HOSTED" },
  });
}

export async function POST(request: Request) {
  const backend = process.env.RENDER_API_URL?.trim().replace(/\/+$/, "");
  const apiKey = process.env.SELF_API_KEY;
  if (!backend || !apiKey) {
    return json({ error: true, message: "Video Saver backend is not configured yet." }, 503);
  }

  let body: { url?: unknown };
  try { body = await request.json(); } catch { return json({ error: true, message: "Invalid request body." }, 400); }
  if (typeof body.url !== "string" || body.url.length > 4096) {
    return json({ error: true, message: "Please provide a valid video URL." }, 400);
  }

  let source: URL;
  try { source = new URL(body.url); } catch { return json({ error: true, message: "The video URL is invalid." }, 400); }
  if (!["http:", "https:"].includes(source.protocol) || !ALLOWED_HOSTS.has(source.hostname.toLowerCase())) {
    return json({ error: true, message: "This platform is not supported." }, 400);
  }

  try {
    const endpoint = new URL("/extract", backend);
    endpoint.searchParams.set("url", source.toString());
    const upstream = await fetch(endpoint.toString(), {
      headers: { "x-api-key": apiKey, "Accept": "application/json" },
      signal: AbortSignal.timeout(110000),
    });
    const data = await upstream.json().catch(() => ({})) as Record<string, unknown>;
    if (!upstream.ok) {
      const detail = data.detail;
      if (detail && typeof detail === "object" && !Array.isArray(detail)) {
        const detailRecord = detail as Record<string, unknown>;
        return json({
          error: true,
          message: typeof detailRecord.message === "string" ? detailRecord.message : "Video extraction failed.",
          diagnostic: {
            code: typeof detailRecord.code === "string" ? detailRecord.code : "UPSTREAM_ERROR",
            stage: typeof detailRecord.stage === "string" ? detailRecord.stage : "Render backend",
            cause: typeof detailRecord.cause === "string" ? detailRecord.cause : "No additional cause was provided.",
            hint: typeof detailRecord.hint === "string" ? detailRecord.hint : "Retry the request.",
            upstreamStatus: upstream.status,
          },
        }, upstream.status);
      }
      return json({
        error: true,
        message: typeof detail === "string" ? detail : "Video extraction failed. Please retry.",
        diagnostic: { code: "UPSTREAM_ERROR", stage: "Render backend", cause: "Backend returned an error without diagnostic details.", upstreamStatus: upstream.status },
      }, upstream.status);
    }

    const medias = Array.isArray(data.medias) ? data.medias as Array<Record<string, unknown>> : [];
    const host = source.hostname.toLowerCase().replace(/^www\\./, "");
    const platform = host.includes("youtube") || host === "youtu.be" ? "YouTube"
      : host.includes("facebook") || host === "fb.watch" ? "Facebook"
      : host.includes("instagram") ? "Instagram"
      : host.includes("tiktok") ? "TikTok"
      : host === "x.com" || host.includes("twitter.com") ? "X"
      : host === "pin.it" || host.includes("pinterest") ? "Pinterest" : "Social media";
    // YouTube downloads are intentionally routed to official creator exports.
    // Data/API keys provide metadata/search, not downloadable media files.
    const downloadSupported = platform !== "YouTube";
    return json({
      error: false,
      provider: "SELF_HOSTED",
      platform,
      download_supported: downloadSupported,
      notice: downloadSupported ? undefined : "For your own YouTube videos, download the original file using YouTube Studio or Google Takeout. YouTube Data API keys do not grant video-download access.",
      title: typeof data.title === "string" ? data.title : "Video Found",
      author: typeof data.author === "string" ? data.author : undefined,
      thumbnail: typeof data.thumbnail === "string" ? data.thumbnail : undefined,
      duration: typeof data.duration === "number" ? data.duration : undefined,
      source: typeof data.platform === "string" ? data.platform : undefined,
      medias: medias.map((media) => ({
        url: media.url,
        quality: media.quality || media.resolution || "Standard",
        extension: media.ext || "mp4",
        type: media.vcodec && media.vcodec !== "none" ? "video" : "audio",
        data_size: media.filesize,
        format_id: media.format_id,
      })),
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    const cause = error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 500) : "Unknown network error";
    return json({
      error: true,
      message: timedOut ? "The video service took too long to respond." : "Could not connect to the video service.",
      diagnostic: {
        code: timedOut ? "RENDER_REQUEST_TIMEOUT" : "RENDER_CONNECTION_FAILED",
        stage: "Cloudflare → Render connection",
        cause,
        hint: timedOut ? "Render may be waking up or the source extraction exceeded the 110-second limit." : "Check Render service status, RENDER_API_URL, and Cloudflare-to-Render connectivity.",
      },
    }, 502);
  }
}
