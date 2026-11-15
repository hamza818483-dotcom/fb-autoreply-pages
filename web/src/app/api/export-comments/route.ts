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

// Covers every FB post-link shape seen in practice. The one rule that
// matters for correctness (not just parsing): whenever a page/profile id is
// known from the URL, the result MUST be the composite "<pageId>_<postId>"
// id, never the bare postId alone — a bare numeric id is a legacy "status"
// object, and Graph API v2.4+ deprecated looking those up directly (error
// #12 "singular statuses API is deprecated for versions v2.4 and higher").
// Only genuinely page-less shapes (plain numeric id/pair pasted in, or a
// pathless query-string id) fall back to a bare id.
function extractPostIdSync(input: string | null | undefined): string | null {
  const s = (input || "").trim();
  if (!s) return null;

  // Already an id or composite id, pasted directly (no URL at all).
  if (/^\d+(_\d+)?$/.test(s)) return s;

  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }

  const path = u.pathname;
  const parts = path.split("/").filter(Boolean);

  // ?story_fbid=<postId>&id=<pageId>  (old permalink.php / mobile links)
  const storyFbid = u.searchParams.get("story_fbid");
  const idParam = u.searchParams.get("id");
  if (storyFbid && idParam) return `${idParam}_${storyFbid}`;

  // fbid=<id> alone (sharer.php, some photo/video links) with no page
  // context in the query — composite not knowable from the URL alone.
  const fbidParam = u.searchParams.get("fbid");

  // .../<pageId>/posts/<postId>/...   (also covers /pfbid.../ slug variants,
  // and groups: /groups/<groupId>/posts/<postId>/... — group id plays the
  // same role as page id here)
  let m = path.match(/^\/groups\/([^/]+)\/(?:permalink|posts)\/(\d+)/);
  if (m) return `${m[1]}_${m[2]}`;

  m = path.match(/^\/(\d+)\/posts\/(?:[^/]+\/)?(\d+)/);
  if (m) return `${m[1]}_${m[2]}`;

  // .../<pageUsername-or-id>/videos/<postId>/...
  // .../<pageUsername-or-id>/photos/.../<postId>/...
  // .../<pageUsername-or-id>/reel/<postId>/...
  // .../<pageUsername-or-id>/activity/<postId>/...
  // Username-form page ids (e.g. "atlas.edu.page") aren't usable as a Graph
  // object id component on their own, but the numeric id form is — and
  // that's the common case for pasted dashboard/page-admin links.
  m = path.match(/^\/([^/]+)\/(?:posts|videos|photos(?:\.php)?|reel|activity|notes)\/(?:[^/]+\/)?(\d+)/);
  if (m) {
    const owner = m[1];
    return /^\d+$/.test(owner) ? `${owner}_${m[2]}` : m[2];
  }

  // photo.php?fbid=<id>&id=<pageId>  / video.php?v=<id>&...
  if (fbidParam && idParam) return `${idParam}_${fbidParam}`;
  if (fbidParam) {
    const vParam = u.searchParams.get("v");
    void vParam;
    return fbidParam;
  }
  const vParam = u.searchParams.get("v");
  if (vParam && /^\d+$/.test(vParam)) {
    return idParam ? `${idParam}_${vParam}` : vParam;
  }

  // watch/?v=<videoId>  (fb.watch and facebook.com/watch)
  if (/^\/watch\/?$/.test(path)) {
    const v = u.searchParams.get("v");
    if (v) return v;
  }

  // Share links resolve via redirect-follow in extractPostId(), not here.
  if (/^\/share\/(p|v|r)\//.test(path)) return null;

  // story.php?story_fbid=...&id=...  already handled above via params.
  // permalink.php?story_fbid=...&id=...  same.

  // Generic .../<pageId>/<numericId> with no known keyword in between
  // (some older/odd permalink shapes) — still prefer composite form when
  // the leading segment is numeric.
  if (parts.length >= 2 && /^\d+$/.test(parts[0])) {
    const last = parts[parts.length - 1];
    if (/^\d+$/.test(last) && last !== parts[0]) return `${parts[0]}_${last}`;
  }

  // Last resort: any bare numeric path segment (no usable page context
  // found). This can hit the deprecated singular-status endpoint if that
  // segment really is a status id with no page prefix available — but it's
  // better than refusing the link outright, and most remaining shapes here
  // are pfbid-style single-token slugs FB already resolves without a page
  // prefix.
  for (let i = parts.length - 1; i >= 0; i--) {
    if (/^\d+$/.test(parts[i])) return parts[i];
    if (/^pfbid[0-9A-Za-z]+$/.test(parts[i])) return parts[i];
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
    const pageFbId = page_id; // this page's own FB page id — used to drop its auto-replies below

    const comments: { id: string; fromId: string | null; name: string | null; message: string; time: string }[] = [];
    let nextUrl: string | null =
      `${GRAPH}/${encodeURIComponent(postId)}/comments?fields=id,from{id,name},message,created_time&filter=stream&order=chronological&limit=100&summary=true&access_token=${encodeURIComponent(pageAccessToken)}`;
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
          id: c.id || "",
          fromId: c.from?.id || null,
          name: c.from?.name || null,
          message: (c.message || "").replace(/\r?\n/g, " ").trim(),
          time: c.created_time || "",
        });
      }
      nextUrl = data.paging?.next || null;
    }

    // Drop the page's own comments (its auto-replies to commenters, posted
    // back as top-level "stream" comments by Graph API) — these aren't real
    // audience commenters and shouldn't count toward anyone's entry/total.
    // Also drop anything with no identifiable commenter (from missing
    // entirely — e.g. a deleted/restricted account) rather than labeling it
    // "অজানা" and mixing it into a real person's row.
    const realComments = comments.filter((c) => {
      if (!c.name) return false;
      if (pageFbId && c.fromId === String(pageFbId)) return false;
      return true;
    });

    // Group by commenter name -> total count + every comment they made,
    // in original (chronological) order.
    const byName = new Map<string, { name: string; messages: string[] }>();
    for (const c of realComments) {
      const key = c.name!.trim().toLowerCase();
      if (!byName.has(key)) byName.set(key, { name: c.name!.trim(), messages: [] });
      byName.get(key)!.messages.push(c.message);
    }
    const grouped = Array.from(byName.values());
    // Most-active commenter first, so the giveaway's winner candidates are
    // easy to scan at the top of the CSV too.
    grouped.sort((a, b) => b.messages.length - a.messages.length);

    const topCommenter = grouped[0] ? { name: grouped[0].name, count: grouped[0].messages.length } : null;

    const esc = (v: unknown) => `"${String(v).replace(/"/g, '""')}"`;
    const csvLines = ["name,total_comments,all_comments"];
    for (const g of grouped) {
      csvLines.push(
        [esc(g.name), esc(g.messages.length), esc(g.messages.join(" | "))].join(",")
      );
    }
    const csv = csvLines.join("\n");

    return jsonResp({
      ok: true,
      post_id: postId,
      total_comments: realComments.length,
      unique_commenters: grouped.length,
      top_commenter: topCommenter,
      csv,
    });
  } catch (e: any) {
    console.error("[export-comments] error:", e.message);
    return jsonResp({ error: e.message || "অজানা সমস্যা" }, 500);
  }
}
