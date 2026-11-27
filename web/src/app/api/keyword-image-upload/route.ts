export const runtime = "edge";

const SB_URL = "https://wbdyjpjbczfunyhhmtry.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJIUzI1NiIsInR5cCI6IkpXVCJ9";

type R2BucketLike = {
  put: (key: string, value: ArrayBuffer, options?: { httpMetadata?: { contentType?: string; cacheControl?: string } }) => Promise<unknown>;
};

const PUBLIC_BASE = "https://pub-24088cd28cb842ed828c661e2cdd259d.r2.dev";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

export async function POST(request: Request) {
  try {
    const auth = request.headers.get("authorization") || "";
    const accessToken = auth.replace(/^Bearer\s+/i, "").trim();
    if (!accessToken) return json({ error: "Please sign in again" }, 401);

    const form = await request.formData();
    const file = form.get("file");
    const pageId = String(form.get("page_id") || "");
    if (!(file instanceof File) || !pageId) return json({ error: "Image and page are required" }, 400);

    const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
    if (!allowed.has(file.type)) return json({ error: "Use a JPG, PNG, or WebP image" }, 400);
    if (file.size > 5 * 1024 * 1024) return json({ error: "Image must be 5 MB or smaller" }, 413);

    const userRes = await fetch(`${SB_URL}/auth/v1/user`, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${accessToken}` },
    });
    if (!userRes.ok) return json({ error: "Your session has expired. Please sign in again." }, 401);

    const pageRes = await fetch(
      `${SB_URL}/rest/v1/fb_pages?page_id=eq.${encodeURIComponent(pageId)}&select=page_id`,
      { headers: { apikey: SB_KEY, Authorization: `Bearer ${accessToken}` } }
    );
    const pages = await pageRes.json();
    if (!pageRes.ok || !Array.isArray(pages) || pages.length === 0) {
      return json({ error: "You do not have access to this Facebook Page" }, 403);
    }

    const bucket = (process.env as unknown as { KEYWORD_REPLY_IMAGES?: R2BucketLike }).KEYWORD_REPLY_IMAGES;
    if (!bucket) return json({ error: "R2 image storage is not connected to this deployment" }, 503);

    const ext = file.type === "image/jpeg" ? "jpg" : file.type === "image/png" ? "png" : "webp";
    const key = `keyword-replies/${pageId}/${crypto.randomUUID()}.${ext}`;
    await bucket.put(key, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type, cacheControl: "public, max-age=31536000, immutable" },
    });

    return json({ ok: true, url: `${PUBLIC_BASE}/${key}` });
  } catch (error) {
    console.error("[keyword-image-upload]", error);
    return json({ error: "Image upload failed. Please try again." }, 500);
  }
}
