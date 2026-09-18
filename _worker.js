// ============================================================
// ATLAS FB Comment Auto-Reply — Cloudflare Pages Function
// Facebook webhook lands directly here (inbound to CF, always
// reliable — same pattern as QuizBot's Telegram proxy). No HF/n8n
// hop involved, so the outbound-from-HF connection-reset issue
// that broke the old n8n -> Worker -> Facebook path never occurs.
// ============================================================

const GRAPH = "https://graph.facebook.com/v19.0";
const SB_URL = "https://wbdyjpjbczfunyhhmtry.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndiZHlqcGpiY3pmdW55aGhtdHJ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA2OTI5ODAsImV4cCI6MjA5NjI2ODk4MH0.0WR1sgVsl_1XWZfSd0Pwoe6Uxp-2GMTksfseMn5aWjg";

// The webhook has no user session, so RLS-protected tables (fb_pages,
// keyword_replies) require the service_role key to bypass RLS. Falls back
// to the anon key (which RLS will reject) until SUPABASE_SERVICE_ROLE_KEY
// is configured in Cloudflare Pages env vars.
function dbKey(env) {
  return env.SUPABASE_SERVICE_ROLE_KEY || SB_KEY;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // --- Facebook webhook verification (GET) ---
    if (request.method === "GET" && url.pathname === "/fb-webhook") {
      const mode = url.searchParams.get("hub.mode");
      const token = url.searchParams.get("hub.verify_token");
      const challenge = url.searchParams.get("hub.challenge");
      const VERIFY_TOKEN = env.FB_VERIFY_TOKEN || "atlastoken";
      if (mode === "subscribe" && token === VERIFY_TOKEN) {
        return new Response(challenge, { status: 200 });
      }
      return new Response("Forbidden", { status: 403 });
    }

    // --- Facebook comment event receiver (POST) ---
    if (request.method === "POST" && url.pathname === "/fb-webhook") {
      const bodyText = await request.text();
      // Ack Meta INSTANTLY, do the matching/reply work in the background —
      // mirrors QuizBot's ctx.waitUntil pattern for Telegram webhooks.
      ctx.waitUntil(handleFbEvent(bodyText, env));
      return new Response("EVENT_RECEIVED", { status: 200 });
    }

    if (url.pathname === "/health") {
      return jsonResp({ ok: true, service: "FB Auto-Reply Pages Proxy" });
    }

    // --- Direct synchronous test: /debug-post-info?comment_id=XXX ---
    if (url.pathname === "/debug-post-info") {
      const commentId = url.searchParams.get("comment_id");
      if (!commentId) return jsonResp({ error: "pass ?comment_id=" }, 400);
      const token = env.PAGE_ACCESS_TOKEN;
      try {
        const res = await fetch(
          `${GRAPH}/${commentId}?fields=id,parent,attachment,comment_count,is_hidden,object{id,from}&access_token=${encodeURIComponent(token)}`,
          { signal: AbortSignal.timeout(15000) }
        );
        const data = await res.json();
        return jsonResp({ status: res.status, ok: res.ok, data });
      } catch (e) {
        return jsonResp({ error: e.message }, 500);
      }
    }

    // --- Direct synchronous test: /debug-me ---
    if (url.pathname === "/debug-me") {
      const token = env.PAGE_ACCESS_TOKEN;
      try {
        const res = await fetch(
          `${GRAPH}/me?fields=id,name,access_token&access_token=${encodeURIComponent(token)}`,
          { signal: AbortSignal.timeout(15000) }
        );
        const data = await res.json();
        return jsonResp({ status: res.status, ok: res.ok, data });
      } catch (e) {
        return jsonResp({ error: e.message }, 500);
      }
    }

    // --- Direct synchronous test: /debug-get-comment?comment_id=XXX ---
    if (url.pathname === "/debug-get-comment") {
      const commentId = url.searchParams.get("comment_id");
      if (!commentId) return jsonResp({ error: "pass ?comment_id=" }, 400);
      const token = env.PAGE_ACCESS_TOKEN;
      try {
        const res = await fetch(
          `${GRAPH}/${commentId}?fields=id,from,message,can_reply_privately,created_time&access_token=${token}`,
          { signal: AbortSignal.timeout(15000) }
        );
        const data = await res.json();
        return jsonResp({ status: res.status, ok: res.ok, data });
      } catch (e) {
        return jsonResp({ error: e.message }, 500);
      }
    }

    // --- Direct synchronous test: /debug-private-reply?comment_id=XXX ---
    if (url.pathname === "/debug-private-reply") {
      const commentId = url.searchParams.get("comment_id");
      if (!commentId) return jsonResp({ error: "pass ?comment_id=" }, 400);
      const token = env.PAGE_ACCESS_TOKEN;
      const ver = url.searchParams.get("v") || "v19.0";
      try {
    const res = await fetch(
      `https://graph.facebook.com/${ver}/${commentId}/private_replies?message=${encodeURIComponent("Debug test")}&access_token=${encodeURIComponent(token)}`,
      { method: "POST", signal: AbortSignal.timeout(15000) }
    );
        const data = await res.json();
        return jsonResp({ status: res.status, ok: res.ok, version: ver, data });
      } catch (e) {
        return jsonResp({ error: e.message, stack: e.stack }, 500);
      }
    }

    // Everything else: serve the static dashboard (index.html, etc.)
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return jsonResp({ ok: true, service: "ATLAS FB Auto-Reply Proxy", version: "1.0" });
  },
};

async function handleFbEvent(bodyText, env) {
  try {
    const body = JSON.parse(bodyText);
    if (body.object !== "page") return;

    for (const entry of body.entry || []) {
      const webhookPageId = entry.id; // the FB Page this event belongs to
      const pageConfig = await getPageConfig(webhookPageId, env);
      if (!pageConfig) {
        console.error("[fb-webhook] no fb_pages row for page_id:", webhookPageId);
        continue;
      }

      for (const change of entry.changes || []) {
        const value = change.value || {};
        if (value.item === "comment" && value.verb === "add") {
          const commentId = value.comment_id;
          const message = (value.message || "").toLowerCase();
          const fromId = value.from && value.from.id;
          if (!commentId || !message) continue;

          // Skip the page's own comments/replies (avoids reacting/replying to itself)
          if (fromId && fromId === webhookPageId) continue;

          // Auto love-react on EVERY comment, regardless of keyword match
          await reactToComment(commentId, pageConfig.page_access_token, env);

          const match = await matchKeyword(message, webhookPageId, env);
          if (match) {
            const alreadyReplied = await hasReplied(commentId, env);
            if (!alreadyReplied) {
              const replyText = fromId ? `@[${fromId}] ${match.reply}` : match.reply;
              await replyToComment(commentId, replyText, pageConfig.page_access_token, env);
              await markReplied(commentId, env);
            }
            // Private reply disabled: requires Meta Business Verification
            // (no business documents available). Public reply only for now.
          }
        }
      }
    }
  } catch (e) {
    console.error("[fb-webhook] processing error:", e.message);
  }
}

// Look up a connected page's config (access token etc) by its Facebook page_id.
async function getPageConfig(pageId, env) {
  if (!pageId) return null;
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/fb_pages?page_id=eq.${encodeURIComponent(pageId)}&select=page_id,page_access_token`,
      {
        headers: { apikey: dbKey(env), Authorization: `Bearer ${dbKey(env)}` },
        signal: AbortSignal.timeout(10000),
      }
    );
    const rows = await r.json();
    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  } catch (e) {
    console.error("[fb-webhook] getPageConfig failed:", e.message);
    return null;
  }
}

// Query Supabase keyword_replies table directly (REST API — no DB driver,
// no Postgres TCP connection needed, works reliably from CF).
async function matchKeyword(message, pageId, env) {
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/keyword_replies?page_id=eq.${encodeURIComponent(pageId)}&select=keyword,reply,private_reply`,
      {
        headers: { apikey: dbKey(env), Authorization: `Bearer ${dbKey(env)}` },
        signal: AbortSignal.timeout(10000),
      }
    );
    const rows = await r.json();
    if (!Array.isArray(rows)) return null;

    for (const row of rows) {
      const keywordsRaw = row.keyword || "";
      const keywords = keywordsRaw
        .split(",")
        .map((k) => k.trim().toLowerCase())
        .filter(Boolean);
      if (keywords.some((kw) => kw && message.includes(kw))) {
        return {
          reply: row.reply || "",
          private_reply: row.private_reply || row.reply || "",
        };
      }
    }
  } catch (e) {
    console.error("[fb-webhook] Supabase keyword lookup failed:", e.message);
  }
  return null;
}

// Check if we've already replied to this comment (prevents duplicate replies
// when Facebook retries/re-delivers the same webhook event).
async function hasReplied(commentId, env) {
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/replied_comments?comment_id=eq.${encodeURIComponent(commentId)}&select=comment_id`,
      {
        headers: { apikey: dbKey(env), Authorization: `Bearer ${dbKey(env)}` },
        signal: AbortSignal.timeout(10000),
      }
    );
    const rows = await r.json();
    return Array.isArray(rows) && rows.length > 0;
  } catch (e) {
    console.error("[fb-webhook] hasReplied check failed:", e.message);
    return false; // fail open: better a rare duplicate than silently never replying
  }
}

async function markReplied(commentId, env) {
  try {
    await fetch(`${SB_URL}/rest/v1/replied_comments`, {
      method: "POST",
      headers: {
        apikey: dbKey(env),
        Authorization: `Bearer ${dbKey(env)}`,
        "Content-Type": "application/json",
        Prefer: "resolution=ignore-duplicates",
      },
      body: JSON.stringify({ comment_id: commentId }),
      signal: AbortSignal.timeout(10000),
    });
  } catch (e) {
    console.error("[fb-webhook] markReplied failed:", e.message);
  }
}

async function reactToComment(commentId, pageAccessToken, env) {
  try {
    const token = pageAccessToken || env.PAGE_ACCESS_TOKEN;
    const res = await fetch(
      `${GRAPH}/${commentId}/likes?access_token=${encodeURIComponent(token)}`,
      { method: "POST", signal: AbortSignal.timeout(15000) }
    );
    const data = await res.json();
    if (!res.ok) console.error("[fb-webhook] react failed:", JSON.stringify(data));
    return data;
  } catch (e) {
    console.error("[fb-webhook] reactToComment error:", e.message);
  }
}

async function replyToComment(commentId, message, pageAccessToken, env) {
  try {
    const token = pageAccessToken || env.PAGE_ACCESS_TOKEN;
    const res = await fetch(`${GRAPH}/${commentId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, access_token: token }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    if (!res.ok) console.error("[fb-webhook] reply failed:", JSON.stringify(data));
    return data;
  } catch (e) {
    console.error("[fb-webhook] replyToComment error:", e.message);
  }
}

async function sendPrivateReply(commentId, message, env) {
  const tgDebug = async (text) => {
    if (env.DEBUG_BOT_TOKEN && env.DEBUG_CHAT_ID) {
      try {
        await fetch(`https://api.telegram.org/bot${env.DEBUG_BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: env.DEBUG_CHAT_ID, text: text.slice(0, 3800) }),
        });
      } catch (e) {}
    }
  };
  try {
    const token = env.PAGE_ACCESS_TOKEN;
    await tgDebug(`Attempting private reply\ncommentId: ${commentId}\nmsg: ${message}`);
    const res = await fetch(
      `${GRAPH}/${commentId}/private_replies?message=${encodeURIComponent(message)}&access_token=${encodeURIComponent(token)}`,
      { method: "POST", signal: AbortSignal.timeout(15000) }
    );
    const data = await res.json();
    if (!res.ok) {
      console.error("[fb-webhook] private reply failed:", JSON.stringify(data));
      await tgDebug("Private reply FAILED:\n" + JSON.stringify(data));
    } else {
      await tgDebug("Private reply SUCCESS:\n" + JSON.stringify(data));
    }
    return data;
  } catch (e) {
    console.error("[fb-webhook] sendPrivateReply error:", e.message);
    await tgDebug("Private reply THREW ERROR:\n" + e.message);
  }
}

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
