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
    // Meta's payload doesn't always include a top-level "object" field —
    // only reject if it's explicitly present and wrong. Presence of "entry"
    // is what actually matters.
    if (body.object && body.object !== "page") return;
    if (!body.entry) return;

    for (const entry of body.entry || []) {
      const webhookPageId = entry.id; // the FB Page this event belongs to
      const pageConfig = await getPageConfig(webhookPageId, env);
      if (!pageConfig) {
        // Permanent (lightweight) alert: this is a real operational failure —
        // either the page isn't configured or SUPABASE_SERVICE_ROLE_KEY is bad.
        await tgDebugGlobal(env, `[ALERT] no pageConfig for page_id=${webhookPageId} — check fb_pages row and SUPABASE_SERVICE_ROLE_KEY env var`);
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
          const reactResult = await reactToComment(commentId, pageConfig.page_access_token, env);
          if (!reactResult || reactResult.error) {
            await tgDebugGlobal(env, `[REACT-DEBUG] love-react FAILED comment=${commentId}\n${JSON.stringify(reactResult)}`);
          }

          const match = await matchKeyword(message, webhookPageId, env);
          if (match) {
            const alreadyReplied = await hasReplied(commentId, env);
            if (!alreadyReplied) {
              const replyText = fromId ? `@[${fromId}] ${match.reply}` : match.reply;
              const replyResult = await replyToComment(commentId, replyText, pageConfig.page_access_token, env);
              if (!replyResult || replyResult.error) {
                await tgDebugGlobal(env, `[REPLY-DEBUG] keyword-reply FAILED comment=${commentId}\n${JSON.stringify(replyResult)}`);
              }
              await markReplied(commentId, env);
            }
            // Private reply disabled: requires Meta Business Verification
            // (no business documents available). Public reply only for now.
          } else {
            // No keyword matched — try AI fallback reply if enabled for this page.
            const alreadyReplied = await hasReplied(commentId, env);
            if (!alreadyReplied) {
              const aiReply = await generateAiReply(message, webhookPageId, env);
              if (aiReply) {
                const replyText = fromId ? `@[${fromId}] ${aiReply}` : aiReply;
                await replyToComment(commentId, replyText, pageConfig.page_access_token, env);
                await markReplied(commentId, env);
              } else {
                await tgDebugGlobal(env, `[AI-DEBUG] generateAiReply returned null for message="${message}" page=${webhookPageId}`);
              }
            }
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
    if (!r.ok) {
      // Permanent safeguard: Supabase auth/key failures fail silently otherwise
      // (this exact bug cost hours of debugging once — SUPABASE_SERVICE_ROLE_KEY
      // was invalid and getPageConfig just returned null with no visible reason).
      await tgDebugGlobal(env, `[ALERT] Supabase fb_pages query failed status=${r.status} — likely bad SUPABASE_SERVICE_ROLE_KEY. ${JSON.stringify(rows).slice(0,300)}`);
      return null;
    }
    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  } catch (e) {
    await tgDebugGlobal(env, `[ALERT] getPageConfig exception: ${e.message}`);
    console.error("[fb-webhook] getPageConfig failed:", e.message);
    return null;
  }
}

async function tgDebugGlobal(env, text) {
  if (env.DEBUG_BOT_TOKEN && env.DEBUG_CHAT_ID) {
    try {
      await fetch(`https://api.telegram.org/bot${env.DEBUG_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: env.DEBUG_CHAT_ID, text: text.slice(0, 3800) }),
      });
    } catch (e) {}
  }
}

// Query Supabase keyword_replies table directly (REST API — no DB driver,
// no Postgres TCP connection needed, works reliably from CF).
async function matchKeyword(message, pageId, env) {
  try {
    const url = `${SB_URL}/rest/v1/keyword_replies?page_id=eq.${encodeURIComponent(pageId)}&select=keyword,reply,private_reply`;
    const r = await fetch(url, {
      headers: { apikey: dbKey(env), Authorization: `Bearer ${dbKey(env)}` },
      signal: AbortSignal.timeout(10000),
    });
    const rows = await r.json();
    if (!r.ok || !Array.isArray(rows)) {
      await tgDebugGlobal(env, `[ALERT] Supabase keyword_replies query failed status=${r.status} — ${JSON.stringify(rows).slice(0,300)}`);
      return null;
    }

    for (const row of rows) {
      const keywordsRaw = row.keyword || "";
      const keywords = keywordsRaw
        .split(",")
        .map((k) => k.trim().toLowerCase())
        .filter(Boolean);
      const hit = keywords.some((kw) => kw && message.includes(kw));
      if (hit) {
        return {
          reply: row.reply || "",
          private_reply: row.private_reply || row.reply || "",
        };
      }
    }
  } catch (e) {
    await tgDebugGlobal(env, `[ALERT] matchKeyword exception: ${e.message}`);
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

// ============================================================
// AI fallback reply — used when no keyword matches a comment.
// Tries Gemini keys first (comma-separated, tried in order),
// then Groq keys, same pattern as QuizBot's provider fallback.
// ============================================================

async function getAiSettings(pageId, env) {
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/ai_settings?page_id=eq.${encodeURIComponent(pageId)}&select=*`,
      {
        headers: { apikey: dbKey(env), Authorization: `Bearer ${dbKey(env)}` },
        signal: AbortSignal.timeout(10000),
      }
    );
    const rows = await r.json();
    if (!r.ok) {
      await tgDebugGlobal(env, `[AI-DEBUG] getAiSettings query failed status=${r.status} ${JSON.stringify(rows).slice(0,300)}`);
      return null;
    }
    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  } catch (e) {
    await tgDebugGlobal(env, `[AI-DEBUG] getAiSettings exception: ${e.message}`);
    console.error("[fb-webhook] getAiSettings failed:", e.message);
    return null;
  }
}

async function generateAiReply(message, pageId, env) {
  const settings = await getAiSettings(pageId, env);
  if (!settings) {
    await tgDebugGlobal(env, `[AI-DEBUG] no ai_settings row for page=${pageId} — AI reply not configured`);
    return null;
  }
  if (!settings.ai_enabled) {
    await tgDebugGlobal(env, `[AI-DEBUG] ai_settings found for page=${pageId} but ai_enabled=false`);
    return null;
  }

  const systemPrompt = settings.system_prompt || "You are a helpful Facebook page assistant. Reply briefly and politely in the same language as the comment.";
  const geminiKeys = settings.gemini_enabled !== false ? (settings.gemini_keys || "").split(",").map(k => k.trim()).filter(Boolean) : [];
  const groqKeys = settings.groq_enabled !== false ? (settings.groq_keys || "").split(",").map(k => k.trim()).filter(Boolean) : [];
  await tgDebugGlobal(env, `[AI-DEBUG] ai_enabled=true geminiKeys=${geminiKeys.length}(enabled=${settings.gemini_enabled !== false}) groqKeys=${groqKeys.length}(enabled=${settings.groq_enabled !== false})`);

  for (const key of geminiKeys) {
    const reply = await tryGemini(key, systemPrompt, message, env);
    if (reply) return reply;
  }
  for (const key of groqKeys) {
    const reply = await tryGroq(key, systemPrompt, message, env);
    if (reply) return reply;
  }
  return null;
}

async function tryGemini(apiKey, systemPrompt, message, env) {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: "user", parts: [{ text: message }] }],
          generationConfig: { maxOutputTokens: 400, thinkingConfig: { thinkingBudget: 0 } },
        }),
        signal: AbortSignal.timeout(25000),
      }
    );
    if (!res.ok) {
      const errText = await res.text();
      console.error("[fb-webhook] Gemini failed:", res.status, errText);
      if (env) await tgDebugGlobal(env, `[AI-DEBUG] Gemini call FAILED status=${res.status}\n${errText.slice(0,400)}`);
      return null;
    }
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text && env) await tgDebugGlobal(env, `[AI-DEBUG] Gemini responded but no text found: ${JSON.stringify(data).slice(0,400)}`);
    return text ? text.trim() : null;
  } catch (e) {
    console.error("[fb-webhook] tryGemini error:", e.message);
    if (env) await tgDebugGlobal(env, `[AI-DEBUG] Gemini exception: ${e.message}`);
    return null;
  }
}

async function tryGroq(apiKey, systemPrompt, message, env) {
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message },
        ],
        max_tokens: 400,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error("[fb-webhook] Groq failed:", res.status, errText);
      if (env) await tgDebugGlobal(env, `[AI-DEBUG] Groq call FAILED status=${res.status} key=...${apiKey.slice(-6)}\n${errText.slice(0,400)}`);
      return null;
    }
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text && env) await tgDebugGlobal(env, `[AI-DEBUG] Groq responded but no text found: ${JSON.stringify(data).slice(0,400)}`);
    return text ? text.trim() : null;
  } catch (e) {
    console.error("[fb-webhook] tryGroq error:", e.message);
    if (env) await tgDebugGlobal(env, `[AI-DEBUG] Groq exception: ${e.message}`);
    return null;
  }
}

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
