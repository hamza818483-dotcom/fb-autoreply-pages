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
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
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
      const detail = typeof data.detail === "string" ? data.detail : "Video extraction failed. Please retry.";
      return json({ error: true, message: detail }, upstream.status);
    }

    const medias = Array.isArray(data.medias) ? data.medias as Array<Record<string, unknown>> : [];
    return json({
      error: false,
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
  } catch {
    return json({ error: true, message: "Video service is waking up or temporarily unavailable. Please retry in a minute." }, 502);
  }
}
