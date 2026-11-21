export const runtime = "edge";
export const dynamic = "force-dynamic";

const RAPIDAPI_HOST = "social-download-all-in-one.p.rapidapi.com";
const RAPIDAPI_URL = `https://${RAPIDAPI_HOST}/v1/social/autolink`;
const ALLOWED_HOSTS = new Set([
  "facebook.com", "www.facebook.com", "m.facebook.com", "fb.watch",
  "youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be",
  "instagram.com", "www.instagram.com",
  "tiktok.com", "www.tiktok.com", "vm.tiktok.com", "vt.tiktok.com",
  "twitter.com", "www.twitter.com", "x.com", "www.x.com",
  "pinterest.com", "www.pinterest.com", "pin.it"
]);

function error(message: string, status = 400) {
  return new Response(JSON.stringify({ error: true, message }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

export async function GET(request: Request) {
  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) return error("Server configuration missing: RAPIDAPI_KEY", 500);

  const source = new URL(request.url).searchParams.get("url");
  if (!source || source.length > 4096) return error("Please provide a video URL.");
  let parsed: URL;
  try { parsed = new URL(source); } catch { return error("The video URL is invalid."); }
  if (!["http:", "https:"].includes(parsed.protocol) || !ALLOWED_HOSTS.has(parsed.hostname.toLowerCase())) {
    return error("This video platform is not supported.");
  }

  try {
    const lookup = await fetch(RAPIDAPI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-RapidAPI-Host": RAPIDAPI_HOST,
        "X-RapidAPI-Key": apiKey
      },
      body: JSON.stringify({ url: parsed.toString() })
    });
    if (!lookup.ok) return error("Video provider could not process this link.", 502);
    const data = await lookup.json() as { medias?: Array<{ url?: string; extension?: string; type?: string; quality?: string }> };
    const medias = Array.isArray(data.medias) ? data.medias : [];
    const candidates = medias.filter((m) => typeof m.url === "string" && /^https:\/\//i.test(m.url));
    candidates.sort((a, b) => {
      const aMp4 = a.extension?.toLowerCase() === "mp4" ? 1 : 0;
      const bMp4 = b.extension?.toLowerCase() === "mp4" ? 1 : 0;
      return bMp4 - aMp4;
    });
    const mediaUrl = candidates[0]?.url;
    if (!mediaUrl) return error("এই লিংকের জন্য downloadable video পাওয়া যায়নি।", 404);

    const media = await fetch(mediaUrl);
    if (!media.ok || !media.body) return error("Video file could not be fetched. Try another link.", 502);
    const headers = new Headers();
    headers.set("Content-Type", media.headers.get("Content-Type") || "video/mp4");
    headers.set("Cache-Control", "no-store");
    headers.set("Content-Disposition", 'inline; filename="source-video.mp4"');
    const length = media.headers.get("Content-Length");
    if (length) headers.set("Content-Length", length);
    headers.set("Accept-Ranges", "none");
    return new Response(media.body, { status: 200, headers });
  } catch {
    return error("Could not fetch this video. It may be private, unavailable, or blocked by the provider.", 502);
  }
}
