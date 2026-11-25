export const runtime = "edge";
export const dynamic = "force-dynamic";

const ALLOWED_HOSTS = new Set([
  "facebook.com", "www.facebook.com", "m.facebook.com", "fb.watch",
  "instagram.com", "www.instagram.com",
  "tiktok.com", "www.tiktok.com", "vm.tiktok.com", "vt.tiktok.com",
  "twitter.com", "www.twitter.com", "x.com", "www.x.com",
  "pinterest.com", "www.pinterest.com", "pin.it",
]);

function cors(request: Request): Headers {
  const headers = new Headers({ "Cache-Control": "no-store" });
  const origin = request.headers.get("Origin");
  const allowed = (process.env.ATLAS_ALLOWED_ORIGINS || "").split(",").map(v => v.trim()).filter(Boolean);
  if (origin && (origin === new URL(request.url).origin || allowed.includes(origin))) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }
  return headers;
}
function json(request: Request, message: string, status = 400) {
  const headers = cors(request);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify({ error: true, message }), { status, headers });
}
function config() {
  const backend = process.env.RENDER_API_URL?.trim().replace(/\/+$/, "");
  const key = process.env.SELF_API_KEY;
  return backend && key ? { backend, key } : null;
}

export async function OPTIONS(request: Request) {
  const headers = cors(request);
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  headers.set("Access-Control-Max-Age", "86400");
  return new Response(null, { status: 204, headers });
}

export async function POST(request: Request) {
  const cfg = config();
  if (!cfg) return json(request, "Video Saver backend is not configured.", 503);
  let body: { url?: string; format_id?: string };
  try { body = await request.json(); } catch { return json(request, "Invalid request body."); }
  if (!body.url || body.url.length > 4096 || !body.format_id || !/^[A-Za-z0-9._+-]{1,80}$/.test(body.format_id)) {
    return json(request, "A valid video URL and format are required.");
  }
  try {
    const source = new URL(body.url);
    if (!["http:", "https:"].includes(source.protocol) || !ALLOWED_HOSTS.has(source.hostname.toLowerCase())) {
      return json(request, "This platform is not supported for processed downloads.");
    }
    const response = await fetch(new URL("/jobs", cfg.backend), {
      method: "POST", headers: { "x-api-key": cfg.key, "Content-Type": "application/json" },
      body: JSON.stringify({ url: source.toString(), format_id: body.format_id }),
      signal: AbortSignal.timeout(110000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return json(request, data.detail || "Could not start the download job.", response.status);
    return new Response(JSON.stringify(data), { status: 202, headers: new Headers({ ...Object.fromEntries(cors(request)), "Content-Type": "application/json" }) });
  } catch {
    return json(request, "Could not contact the download server.", 502);
  }
}

export async function GET(request: Request) {
  const cfg = config();
  if (!cfg) return json(request, "Video Saver backend is not configured.", 503);
  const params = new URL(request.url).searchParams;
  const id = params.get("job_id") || "";
  const token = params.get("token") || "";
  if (!/^[a-f0-9]{32}$/.test(id) || token.length < 32 || token.length > 128) {
    return json(request, "This download link is invalid or expired.", 400);
  }
  const file = params.get("file") === "1";
  try {
    const endpoint = new URL(`/jobs/${id}${file ? "/file" : ""}`, cfg.backend);
    if (!file) endpoint.searchParams.set("token", token);
    else endpoint.searchParams.set("token", token);
    const upstream = await fetch(endpoint, {
      headers: { "x-api-key": cfg.key },
      signal: AbortSignal.timeout(file ? 300000 : 30000),
    });
    if (!upstream.ok || !upstream.body) {
      const data = await upstream.json().catch(() => ({}));
      return json(request, data.detail || "The download is not ready or has expired.", upstream.status);
    }
    const headers = cors(request);
    if (file) {
      for (const name of ["Content-Type", "Content-Length", "Content-Disposition", "Accept-Ranges"]) {
        const value = upstream.headers.get(name);
        if (value) headers.set(name, value);
      }
      return new Response(upstream.body, { status: upstream.status, headers });
    }
    headers.set("Content-Type", "application/json; charset=utf-8");
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch {
    return json(request, "Could not contact the download server.", 502);
  }
}
