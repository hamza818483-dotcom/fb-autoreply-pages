export const runtime = "edge";
export const dynamic = "force-dynamic";
const RAPIDAPI_HOST = "social-download-all-in-one.p.rapidapi.com";
const RAPIDAPI_URL = `https://${RAPIDAPI_HOST}/v1/social/autolink`;
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
function getApiKeys(): string[] {
  const raw = process.env.RAPIDAPI_KEY || "";
  return raw.split(",").map((k) => k.trim()).filter(Boolean);
}

export async function POST(request: Request) {
  const apiKeys = getApiKeys();
  if (apiKeys.length === 0) return json({ error: true, message: "Server configuration missing: RAPIDAPI_KEY" }, 500);
  let body: { url?: unknown };
  try { body = await request.json(); } catch { return json({ error: true, message: "Invalid JSON request." }, 400); }
  if (typeof body.url !== "string" || body.url.length > 4096) return json({ error: true, message: "Please provide a valid video URL." }, 400);
  let parsed: URL;
  try { parsed = new URL(body.url); } catch { return json({ error: true, message: "The video URL is invalid." }, 400); }
  if (!["https:","http:"].includes(parsed.protocol)) return json({ error: true, message: "Only HTTP and HTTPS links are supported." }, 400);
  if (!ALLOWED_HOSTS.has(parsed.hostname.toLowerCase())) return json({ error: true, message: "This website is not in the supported platform list." }, 400);

  let lastQuota: Record<string, string> = {};
  for (let i = 0; i < apiKeys.length; i++) {
    const apiKey = apiKeys[i];
    const isLastKey = i === apiKeys.length - 1;
    try {
      const upstream = await fetch(RAPIDAPI_URL, { method: "POST", headers: { "Content-Type": "application/json", "X-RapidAPI-Host": RAPIDAPI_HOST, "X-RapidAPI-Key": apiKey }, body: JSON.stringify({ url: parsed.toString() }) });
      const quota = extractQuotaHeaders(upstream.headers);
      lastQuota = quota;
      // Quota exhausted on this key: try the next key instead of returning the error.
      if ((upstream.status === 429 || upstream.status === 403) && !isLastKey) continue;
      const raw = await upstream.text();
      let data: unknown;
      try { data = JSON.parse(raw); } catch { return json({ error: true, message: "Video provider returned an invalid response." }, 502, quota); }
      return json(data, upstream.status, quota);
    } catch {
      if (!isLastKey) continue;
      return json({ error: true, message: "Could not connect to the video provider. Please try again." }, 502, lastQuota);
    }
  }
  return json({ error: true, message: "All RapidAPI keys have exhausted their quota." }, 429, lastQuota);
}
