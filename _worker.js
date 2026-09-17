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

    return jsonResp({ ok: true, service: "ATLAS FB Auto-Reply Proxy", version: "1.0" });
  },
};

async function handleFbEvent(bodyText, env) {
  try {
    const body = JSON.parse(bodyText);
    if (body.object !== "page") return;

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value || {};
        if (value.item === "comment" && value.verb === "add") {
          const commentId = value.comment_id;
          const message = (value.message || "").toLowerCase();
          if (!commentId || !message) continue;

          const match = await matchKeyword(message, env);
          if (env.DEBUG_BOT_TOKEN && env.DEBUG_CHAT_ID) {
            try {
              await fetch(`https://api.telegram.org/bot${env.DEBUG_BOT_TOKEN}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  chat_id: env.DEBUG_CHAT_ID,
                  text: `Comment event\nmsg: ${message}\nmatch: ${JSON.stringify(match)}`,
                }),
              });
            } catch (e) {}
          }
          if (match) {
            await replyToComment(commentId, match.reply, env);
            if (match.private_reply) {
              await sendPrivateReply(commentId, match.private_reply, env);
            }
          }
        }
      }
    }
  } catch (e) {
    console.error("[fb-webhook] processing error:", e.message);
  }
}

// Query Supabase keyword_replies table directly (REST API — no DB driver,
// no Postgres TCP connection needed, works reliably from CF).
async function matchKeyword(message, env) {
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/keyword_replies?select=keyword,reply,private_reply`,
      {
        headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
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

async function replyToComment(commentId, message, env) {
  try {
    const token = env.PAGE_ACCESS_TOKEN;
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
    const res = await fetch(`${GRAPH}/${commentId}/private_replies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, access_token: token }),
      signal: AbortSignal.timeout(15000),
    });
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
