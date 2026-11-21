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
 * Each provider is a RapidAPI-hosted endpoint for the same
 * /v1/social/autolink-shaped API. Multiple keys for the same host
 * share one account's quota (RapidAPI billing is account-wide), so
 * real extra quota only comes from a different host (a different
 * RapidAPI account/provider) or a different key on that host.
 *
 * Env vars (all optional, comma-separated for multiple keys on one host):
 *   RAPIDAPI_KEY                 -> keys for social-download-all-in-one.p.rapidapi.com
 *   RAPIDAPI_KEY_ZM              -> keys for zm-api.p.rapidapi.com
 */
type Provider = { host: string; keys: string[] };

function parseKeys(raw: string | undefined): string[] {
  return (raw || "").split(",").map((k) => k.trim()).filter(Boolean);
}

function getProviders(): Provider[] {
  const providers: Provider[] = [];
  const primaryKeys = parseKeys(process.env.RAPIDAPI_KEY);
  if (primaryKeys.length > 0) providers.push({ host: "social-download-all-in-one.p.rapidapi.com", keys: primaryKeys });
  const zmKeys = parseKeys(process.env.RAPIDAPI_KEY_ZM);
  if (zmKeys.length > 0) providers.push({ host: "zm-api.p.rapidapi.com", keys: zmKeys });
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
  const attempts: { host: string; key: string }[] = [];
  for (const provider of providers) {
    for (const key of provider.keys) attempts.push({ host: provider.host, key });
  }

  for (let i = 0; i < attempts.length; i++) {
    const { host, key } = attempts[i];
    const isLastAttempt = i === attempts.length - 1;
    const url = `https://${host}/v1/social/autolink`;
    try {
      const upstream = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "X-RapidAPI-Host": host, "X-RapidAPI-Key": key }, body: JSON.stringify({ url: parsed.toString() }) });
      const quota = extractQuotaHeaders(upstream.headers);
      lastQuota = quota;
      // Quota exhausted / forbidden on this key: try the next key/provider instead of returning the error.
      if ((upstream.status === 429 || upstream.status === 403) && !isLastAttempt) continue;
      const raw = await upstream.text();
      let data: unknown;
      try { data = JSON.parse(raw); } catch { return json({ error: true, message: "Video provider returned an invalid response." }, 502, quota); }
      return json(data, upstream.status, quota);
    } catch {
      if (!isLastAttempt) continue;
      return json({ error: true, message: "Could not connect to the video provider. Please try again." }, 502, lastQuota);
    }
  }
  return json({ error: true, message: "All providers have exhausted their quota." }, 429, lastQuota);
}
