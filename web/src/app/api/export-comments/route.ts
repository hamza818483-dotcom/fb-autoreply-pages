export const runtime = "edge";

// Ported from the legacy root _worker.js's handleExportComments/extractPostId
// (same logic) — the dashboard (web/) is its own Next.js deployment and does
// not share that worker's routes, so this must exist here too for the
// Comment Collector feature to work at this domain.

const GRAPH = "https://graph.facebook.com/v19.0";
const SB_URL = "https://wbdyjpjbczfunyhhmtry.supabase.co";
const SB_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndiZHlqcGpiY3pmdW55aGhtdHJ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA2OTI5ODAsImV4cCI6MjA5NjI2ODk4MH0.0WR1sgVsl_1XWZfSd0Pwoe6Uxp-2GMTksfseMn5aWjg";

function jsonResp(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function extractPostIdSync(input: string | null | undefined): string | null {
  const s = (input || "").trim();
  if (!s) return null;
  if (/^\d+(_\d+)?$/.test(s)) return s;
  try {
    const u = new URL(s);
    const storyFbid = u.searchParams.get("story_fbid");
    const idParam = u.searchParams.get("id");
    if (storyFbid && idParam) return `${idParam}_${storyFbid}`;
    const m = u.pathname.match(/\/(posts|videos|photos|reel)\/(?:[^/]+\/)?(\d+)/);
    if (m) return m[2];
    if (/\/share\/(p|v|r)\//.test(u.pathname)) return null;
    const parts = u.pathname.split("/").filter(Boolean);
    for (let i = parts.length - 1; i >= 0; i--) {
      if (/^\d+$/.test(parts[i])) return parts[i];
    }
  } catch {
    // Not a URL — give up.
  }
  return null;
}

async function extractPostId(input: string | null | undefined): Promise<string | null> {
  const s = (input || "").trim();
  if (!s) return null;
  const direct = extractPostIdSync(s);
  if (direct) return direct;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (!/\/share\/(p|v|r)\//.test(u.pathname)) return null;
  try {
    let current = s;
    for (let hop = 0; hop < 5; hop++) {
      const res = await fetch(current, {
        method: "GET",
        redirect: "manual",
        headers: { "User-Agent": "facebookexternalhit/1.1" },
        signal: AbortSignal.timeout(10000),
      });
      const loc = res.headers.get("location");
      if (!loc) return extractPostIdSync(current);
      const resolved = new URL(loc, current).toString();
      const got = extractPostIdSync(resolved);
      if (got) return got;
      current = resolved;
    }
    return null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const { post_url, page_id, access_token: userAccessToken } = await request.json();
    if (!userAccessToken) return jsonResp({ error: "লগইন প্রয়োজন" }, 401);
    if (!page_id) return jsonResp({ error: "page_id প্রয়োজন" }, 400);

    const postId = await extractPostId(post_url);
    if (!postId) return jsonResp({ error: "পোস্ট লিংক/আইডি বুঝতে পারিনি" }, 400);

    const ownRes = await fetch(
      `${SB_URL}/rest/v1/fb_pages?page_id=eq.${encodeURIComponent(page_id)}&select=page_id,page_name,page_access_token`,
      {
        headers: {
          apikey: SB_KEY,
          Authorization: `Bearer ${userAccessToken}`,
        },
        signal: AbortSignal.timeout(10000),
      }
    );
    const ownRows = await ownRes.json();
    if (!ownRes.ok || !Array.isArray(ownRows) || ownRows.length === 0) {
      return jsonResp({ error: "এই পেজের অ্যাক্সেস নেই" }, 403);
    }
    const pageAccessToken = ownRows[0].page_access_token;

    const comments: { name: string; message: string; time: string }[] = [];
    let nextUrl: string | null =
      `${GRAPH}/${encodeURIComponent(postId)}/comments?fields=from{name},message,created_time&filter=stream&order=chronological&limit=100&summary=true&access_token=${encodeURIComponent(pageAccessToken)}`;
    let fbTotalCount: number | null = null;
    let guard = 0;
    while (nextUrl && guard < 100) {
      guard++;
      const r = await fetch(nextUrl, { signal: AbortSignal.timeout(15000) });
      const data: any = await r.json();
      if (!r.ok) {
        return jsonResp({ error: `Facebook error: ${data?.error?.message || r.status}` }, 502);
      }
      if (fbTotalCount === null && data.summary && typeof data.summary.total_count === "number") {
        fbTotalCount = data.summary.total_count;
      }
      for (const c of data.data || []) {
        comments.push({
          name: c.from?.name || "অজানা",
          message: (c.message || "").replace(/\r?\n/g, " ").trim(),
          time: c.created_time || "",
        });
      }
      nextUrl = data.paging?.next || null;
    }

    const seen = new Set<string>();
    const uniqueCommenters: string[] = [];
    for (const c of comments) {
      const key = c.name.trim().toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        uniqueCommenters.push(c.name.trim());
      }
    }
    const topCounts: Record<string, number> = {};
    for (const c of comments) topCounts[c.name] = (topCounts[c.name] || 0) + 1;
    const topCommenter = Object.entries(topCounts).sort((a, b) => b[1] - a[1])[0] || null;

    const esc = (v: unknown) => `"${String(v).replace(/"/g, '""')}"`;
    const csvLines = ["name,message,time"];
    for (const c of comments) csvLines.push([esc(c.name), esc(c.message), esc(c.time)].join(","));
    const csv = csvLines.join("\n");

    return jsonResp({
      ok: true,
      post_id: postId,
      total_comments: fbTotalCount ?? comments.length,
      unique_commenters: uniqueCommenters.length,
      top_commenter: topCommenter ? { name: topCommenter[0], count: topCommenter[1] } : null,
      csv,
    });
  } catch (e: any) {
    console.error("[export-comments] error:", e.message);
    return jsonResp({ error: e.message || "অজানা সমস্যা" }, 500);
  }
}
