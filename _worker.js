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

    // --- Comment export (Random Winner CSV feed) ---
    // Dashboard calls this with the viewer's Supabase access token (so we
    // can verify they actually own the page before touching its token) plus
    // the FB post URL/ID to pull comments from. Returns commenter name +
    // comment text + time only — no FB user IDs are persisted or returned,
    // to keep the CSV itself free of anything beyond what's needed to
    // announce a winner.
    if (request.method === "POST" && url.pathname === "/api/export-comments") {
      return handleExportComments(request, env);
    }

    // --- Super-admin endpoints (customer management) ---
    if (url.pathname === "/api/admin/customers" && request.method === "GET") {
      return handleAdminListCustomers(request, env);
    }
    if (url.pathname === "/api/admin/customers" && request.method === "POST") {
      return handleAdminCreateCustomer(request, env);
    }
    if (url.pathname === "/api/admin/customers" && request.method === "PATCH") {
      return handleAdminUpdateCustomer(request, env);
    }
    if (url.pathname === "/api/admin/customers" && request.method === "DELETE") {
      return handleAdminDeleteCustomer(request, env);
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
        await tgDebugGlobal(env, `[ALERT] no pageConfig for page_id=${webhookPageId} — check fb_pages row and SUPABASE_SERVICE_ROLE_KEY env var`, webhookPageId);
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

          // One debug log per comment — accumulates steps, sent/edited as a
          // single Telegram message instead of spamming one message per step.
          const dlog = await Debug.start(env, webhookPageId, `Comment: "${message}"\nID: ${commentId}`);

          // Auto love-react on EVERY comment, regardless of keyword match
          const reactResult = await reactToComment(commentId, pageConfig.page_access_token, env);
          if (!reactResult || reactResult.error) {
            await dlog.add(`❌ Love-react FAILED\n${JSON.stringify(reactResult)}`);
          } else {
            await dlog.add(`✅ Reacted`);
          }

          const match = await matchKeyword(message, webhookPageId, env);
          if (match) {
            await dlog.add(`✅ Keyword matched: "${match.matchedKeyword || ''}"`);
            const alreadyReplied = await hasReplied(commentId, env);
            if (!alreadyReplied) {
              const replyText = fromId ? `@[${fromId}] ${match.reply}` : match.reply;
              const replyResult = await replyToComment(commentId, replyText, pageConfig.page_access_token, env);
              if (!replyResult || replyResult.error) {
                await dlog.add(`❌ Keyword-reply FAILED\n${JSON.stringify(replyResult)}`);
              } else {
                await dlog.add(`✅ Replied (keyword)`);
              }

              const privateMsg = match.private_reply || match.reply;
              const privateResult = await sendPrivateReply(commentId, privateMsg, pageConfig.page_access_token, env);
              if (!privateResult || privateResult.error) {
                const reason = privateResult?.error?.message || privateResult?.error?.error_user_msg || JSON.stringify(privateResult);
                await dlog.add(`❌ Private reply FAILED\nReason: ${reason}`);
              } else {
                await dlog.add(`✅ Private (inbox) reply sent`);
              }

              await markReplied(commentId, env);
            } else {
              await dlog.add(`⏭ Already replied — skipped (duplicate)`);
            }
          } else {
            await dlog.add(`ℹ️ No keyword match — trying AI fallback`);
            // No keyword matched — try AI fallback reply if enabled for this page.
            const alreadyReplied = await hasReplied(commentId, env);
            if (!alreadyReplied) {
              const aiReply = await generateAiReply(message, webhookPageId, env, dlog);
              if (aiReply) {
                const replyText = fromId ? `@[${fromId}] ${aiReply}` : aiReply;
                await replyToComment(commentId, replyText, pageConfig.page_access_token, env);
                await markReplied(commentId, env);
                await dlog.add(`✅ Replied (AI)`);
              } else {
                await dlog.add(`❌ AI reply FAILED — no reply generated (see reasons above)`);
              }
            } else {
              await dlog.add(`⏭ Already replied — skipped (duplicate)`);
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

// Accumulates all steps for one comment into a single Telegram message,
// sent once and then edited in place as each step completes — avoids
// spamming one message per step.
const Debug = {
  async start(env, pageId, headerText) {
    const enabled = await isDebugEnabled(pageId, env);
    if (!enabled || !env.DEBUG_BOT_TOKEN || !env.DEBUG_CHAT_ID) {
      return { add: async () => {} }; // no-op logger when debug is off
    }
    const lines = [headerText];
    let messageId = null;
    try {
      const res = await fetch(`https://api.telegram.org/bot${env.DEBUG_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: env.DEBUG_CHAT_ID, text: lines.join("\n") }),
      });
      const data = await res.json();
      messageId = data.result && data.result.message_id;
    } catch (e) {}

    return {
      async add(line) {
        lines.push(line);
        if (!messageId) return;
        try {
          await fetch(`https://api.telegram.org/bot${env.DEBUG_BOT_TOKEN}/editMessageText`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: env.DEBUG_CHAT_ID,
              message_id: messageId,
              text: lines.join("\n").slice(0, 3900),
            }),
          });
        } catch (e) {}
      },
    };
  },
};

async function tgDebugGlobal(env, text, pageId) {
  if (!env.DEBUG_BOT_TOKEN || !env.DEBUG_CHAT_ID) return;
  if (pageId) {
    const enabled = await isDebugEnabled(pageId, env);
    if (!enabled) return;
  }
  try {
    await fetch(`https://api.telegram.org/bot${env.DEBUG_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: env.DEBUG_CHAT_ID, text: text.slice(0, 3800) }),
    });
  } catch (e) {}
}

async function isDebugEnabled(pageId, env) {
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/ai_settings?page_id=eq.${encodeURIComponent(pageId)}&select=debug_alerts_enabled`,
      {
        headers: { apikey: dbKey(env), Authorization: `Bearer ${dbKey(env)}` },
        signal: AbortSignal.timeout(8000),
      }
    );
    const rows = await r.json();
    if (!r.ok) {
      console.error("[isDebugEnabled] query failed status=", r.status, JSON.stringify(rows).slice(0, 300));
      return true; // fail open on query error — don't silently hide debug
    }
    if (!Array.isArray(rows) || rows.length === 0) return false; // default OFF if no settings row yet
    return rows[0].debug_alerts_enabled === true;
  } catch (e) {
    console.error("[isDebugEnabled] exception:", e.message);
    return true; // fail open: better a stray debug message than losing real alerts
  }
}

// Query Supabase keyword_replies table directly (REST API — no DB driver,
// no Postgres TCP connection needed, works reliably from CF).
// Levenshtein edit distance — counts how many single-character edits
// (insert/delete/substitute) turn string a into string b.
function editDistance(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array(n + 1).fill(0).map((_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(
        prev[j] + 1,      // deletion
        cur[j - 1] + 1,   // insertion
        prev[j - 1] + cost // substitution
      );
    }
    prev = cur;
  }
  return prev[n];
}

// True if any word in the message is an exact or near-typo match (fuzzy)
// for the keyword. Threshold scales with keyword length so short keywords
// don't over-match (e.g. "hi" shouldn't fuzzy-match "him").
function fuzzyContains(message, keyword) {
  if (!keyword) return false;
  if (message.includes(keyword)) return true; // exact substring — cheapest check first

  const maxDist = keyword.length <= 3 ? 0 : keyword.length <= 6 ? 1 : 2;
  if (maxDist === 0) return false; // too short to safely fuzzy-match

  const words = message.split(/[^a-z0-9\u0980-\u09FF]+/i).filter(Boolean);
  for (const w of words) {
    if (Math.abs(w.length - keyword.length) > maxDist) continue; // quick skip
    if (editDistance(w, keyword) <= maxDist) return true;
  }
  return false;
}

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
      const hit = keywords.find((kw) => fuzzyContains(message, kw));
      if (hit) {
        return {
          reply: row.reply || "",
          private_reply: row.private_reply || row.reply || "",
          matchedKeyword: hit,
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

async function sendPrivateReply(commentId, message, pageAccessToken, env) {
  try {
    const token = pageAccessToken || env.PAGE_ACCESS_TOKEN;
    const res = await fetch(
      `${GRAPH}/${commentId}/private_replies?message=${encodeURIComponent(message)}&access_token=${encodeURIComponent(token)}`,
      { method: "POST", signal: AbortSignal.timeout(15000) }
    );
    const data = await res.json();
    if (!res.ok) {
      console.error("[fb-webhook] private reply failed:", JSON.stringify(data));
    }
    return data;
  } catch (e) {
    console.error("[fb-webhook] sendPrivateReply error:", e.message);
    return { error: { message: e.message } };
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

async function generateAiReply(message, pageId, env, dlog) {
  const noop = { add: async () => {} };
  const log = dlog || noop;

  const settings = await getAiSettings(pageId, env);
  if (!settings) {
    await log.add(`❌ AI not configured for this page (no ai_settings row)`);
    return null;
  }
  if (!settings.ai_enabled) {
    await log.add(`❌ AI reply is turned OFF for this page`);
    return null;
  }

  const systemPrompt = settings.system_prompt || "You are a helpful Facebook page assistant. Reply briefly and politely in the same language as the comment.";
  const geminiKeys = settings.gemini_enabled !== false ? (settings.gemini_keys || "").split(",").map(k => k.trim()).filter(Boolean) : [];
  const groqKeys = settings.groq_enabled !== false ? (settings.groq_keys || "").split(",").map(k => k.trim()).filter(Boolean) : [];

  if (geminiKeys.length === 0 && groqKeys.length === 0) {
    await log.add(`❌ No AI provider keys configured/enabled (Gemini: ${geminiKeys.length}, Groq: ${groqKeys.length})`);
    return null;
  }

  for (let i = 0; i < geminiKeys.length; i++) {
    const reply = await tryGemini(geminiKeys[i], systemPrompt, message, log, i + 1, geminiKeys.length);
    if (reply) { await log.add(`✅ Gemini key #${i + 1} succeeded`); return reply; }
  }
  for (let i = 0; i < groqKeys.length; i++) {
    const reply = await tryGroq(groqKeys[i], systemPrompt, message, log, i + 1, groqKeys.length);
    if (reply) { await log.add(`✅ Groq key #${i + 1} succeeded`); return reply; }
  }
  await log.add(`❌ All AI providers failed (Gemini: ${geminiKeys.length} tried, Groq: ${groqKeys.length} tried)`);
  return null;
}

async function tryGemini(apiKey, systemPrompt, message, log, idx, total) {
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
      if (log) await log.add(`❌ Gemini key #${idx}/${total} FAILED — HTTP ${res.status}\n${errText.slice(0,300)}`);
      return null;
    }
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text && log) await log.add(`❌ Gemini key #${idx}/${total} — got response but no text (likely blocked/empty): ${JSON.stringify(data).slice(0,300)}`);
    return text ? text.trim() : null;
  } catch (e) {
    console.error("[fb-webhook] tryGemini error:", e.message);
    if (log) await log.add(`❌ Gemini key #${idx}/${total} — exception: ${e.message}`);
    return null;
  }
}

async function tryGroq(apiKey, systemPrompt, message, log, idx, total) {
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "openai/gpt-oss-120b",
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
      if (log) await log.add(`❌ Groq key #${idx}/${total} (...${apiKey.slice(-6)}) FAILED — HTTP ${res.status}\n${errText.slice(0,300)}`);
      return null;
    }
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text && log) await log.add(`❌ Groq key #${idx}/${total} — got response but no text: ${JSON.stringify(data).slice(0,300)}`);
    return text ? text.trim() : null;
  } catch (e) {
    console.error("[fb-webhook] tryGroq error:", e.message);
    if (log) await log.add(`❌ Groq key #${idx}/${total} — exception: ${e.message}`);
    return null;
  }
}

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Tries to pull a usable FB post ID directly out of a URL's path/query
// without any network call. Returns null if the shape isn't recognized
// (e.g. opaque /share/ links, which need resolving first).
function extractPostIdSync(input) {
  const s = (input || "").trim();
  if (!s) return null;
  // Already a bare "pageid_postid" or numeric ID.
  if (/^\d+(_\d+)?$/.test(s)) return s;
  try {
    const u = new URL(s);
    // .../story.php?story_fbid=123&id=456 -> 456_123
    const storyFbid = u.searchParams.get("story_fbid");
    const idParam = u.searchParams.get("id");
    if (storyFbid && idParam) return `${idParam}_${storyFbid}`;
    // .../posts/123456  or  .../videos/123456  or  .../photos/.../123456
    const m = u.pathname.match(/\/(posts|videos|photos|reel)\/(?:[^/]+\/)?(\d+)/);
    if (m) return m[2];
    // Share links (/share/p/XXXX/ or /share/v/XXXX/ or /share/r/XXXX/) and
    // any other FB path have no numeric ID embedded — caller must resolve
    // the redirect first and re-parse.
    if (/\/share\/(p|v|r)\//.test(u.pathname)) return null;
    // Fallback: last numeric-looking path segment.
    const parts = u.pathname.split("/").filter(Boolean);
    for (let i = parts.length - 1; i >= 0; i--) {
      if (/^\d+$/.test(parts[i])) return parts[i];
    }
  } catch (e) {
    // Not a URL — give up.
  }
  return null;
}

// Pull every FB post ID out of whatever the admin pasted — full post URL,
// permalink, numeric/pageid_postid ID, or a short "share" link
// (facebook.com/share/p/XXXX/, /share/v/..., /share/r/...) — so they don't
// have to hand-extract it themselves. Share links carry no ID in the URL
// itself; FB resolves them via an HTTP redirect to the real permalink, so
// we follow that redirect (without following it all the way, since the
// Location header already has what we need) and parse the result.
async function extractPostId(input) {
  const s = (input || "").trim();
  if (!s) return null;
  const direct = extractPostIdSync(s);
  if (direct) return direct;
  let u;
  try {
    u = new URL(s);
  } catch (e) {
    return null;
  }
  if (!/\/share\/(p|v|r)\//.test(u.pathname)) return null;
  try {
    // redirect: "manual" so we read the Location header ourselves instead
    // of the runtime silently following it (and possibly landing on a
    // login/consent interstitial instead of the real permalink).
    let current = s;
    for (let hop = 0; hop < 5; hop++) {
      const res = await fetch(current, {
        method: "GET",
        redirect: "manual",
        headers: { "User-Agent": "facebookexternalhit/1.1" },
        signal: AbortSignal.timeout(10000),
      });
      const loc = res.headers.get("location");
      if (!loc) {
        // No further redirect — try to parse whatever URL we're already at.
        return extractPostIdSync(current);
      }
      const resolved = new URL(loc, current).toString();
      const got = extractPostIdSync(resolved);
      if (got) return got;
      current = resolved;
    }
    return null;
  } catch (e) {
    return null;
  }
}

// Confirms the caller's Supabase access token belongs to a profile with
// role='super_admin'. Returns the user id on success, null otherwise.
async function requireSuperAdmin(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const userRes = await fetch(`${SB_URL}/auth/v1/user`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!userRes.ok) return null;
  const user = await userRes.json();
  if (!user?.id) return null;
  const profRes = await fetch(
    `${SB_URL}/rest/v1/profiles?id=eq.${user.id}&select=role`,
    { headers: { apikey: dbKey(env), Authorization: `Bearer ${dbKey(env)}` }, signal: AbortSignal.timeout(10000) }
  );
  const profRows = await profRes.json();
  if (!profRes.ok || !Array.isArray(profRows) || profRows.length === 0) return null;
  if (profRows[0].role !== "super_admin") return null;
  return user.id;
}

// List all customers (profiles with role='customer') + their pages +
// subscription + branding, for the admin panel table.
async function handleAdminListCustomers(request, env) {
  try {
    const adminId = await requireSuperAdmin(request, env);
    if (!adminId) return jsonResp({ error: "Unauthorized" }, 403);

    const profRes = await fetch(
      `${SB_URL}/rest/v1/profiles?role=eq.customer&select=id,email,business_name,logo_url,created_at&order=created_at.desc`,
      { headers: { apikey: dbKey(env), Authorization: `Bearer ${dbKey(env)}` }, signal: AbortSignal.timeout(10000) }
    );
    const profiles = await profRes.json();
    if (!profRes.ok) return jsonResp({ error: profiles?.message || "Failed to load customers" }, 500);

    const subRes = await fetch(
      `${SB_URL}/rest/v1/subscriptions?select=*`,
      { headers: { apikey: dbKey(env), Authorization: `Bearer ${dbKey(env)}` }, signal: AbortSignal.timeout(10000) }
    );
    const subs = await subRes.json();

    const pageRes = await fetch(
      `${SB_URL}/rest/v1/fb_pages?select=page_id,page_name,owner_id`,
      { headers: { apikey: dbKey(env), Authorization: `Bearer ${dbKey(env)}` }, signal: AbortSignal.timeout(10000) }
    );
    const pages = await pageRes.json();

    const customers = (profiles || []).map((p) => ({
      ...p,
      pages: (pages || []).filter((pg) => pg.owner_id === p.id),
      subscriptions: (subs || []).filter((s) => s.owner_id === p.id),
    }));

    return jsonResp({ ok: true, customers });
  } catch (e) {
    return jsonResp({ error: e.message || "Unknown error" }, 500);
  }
}

// Creates a brand-new Supabase auth user (via service_role Admin API,
// email pre-confirmed — no verification email needed since the admin is
// provisioning manually after receiving payment) + their profile row.
async function handleAdminCreateCustomer(request, env) {
  try {
    const adminId = await requireSuperAdmin(request, env);
    if (!adminId) return jsonResp({ error: "Unauthorized" }, 403);

    const { email, password, business_name } = await request.json();
    if (!email || !password) return jsonResp({ error: "email ও password প্রয়োজন" }, 400);

    const createRes = await fetch(`${SB_URL}/auth/v1/admin/users`, {
      method: "POST",
      headers: {
        apikey: dbKey(env),
        Authorization: `Bearer ${dbKey(env)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password, email_confirm: true }),
      signal: AbortSignal.timeout(10000),
    });
    const created = await createRes.json();
    if (!createRes.ok) return jsonResp({ error: created?.msg || created?.error_description || "User তৈরি ব্যর্থ হয়েছে" }, 400);

    const profRes = await fetch(`${SB_URL}/rest/v1/profiles`, {
      method: "POST",
      headers: {
        apikey: dbKey(env),
        Authorization: `Bearer ${dbKey(env)}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        id: created.id,
        email,
        role: "customer",
        business_name: business_name || null,
      }),
      signal: AbortSignal.timeout(10000),
    });
    const prof = await profRes.json();
    if (!profRes.ok) return jsonResp({ error: prof?.message || "Profile তৈরি ব্যর্থ হয়েছে" }, 500);

    return jsonResp({ ok: true, customer: Array.isArray(prof) ? prof[0] : prof });
  } catch (e) {
    return jsonResp({ error: e.message || "Unknown error" }, 500);
  }
}

// Updates a customer's branding (business_name/logo_url) and/or their
// subscription status for a given page (active/expired + expires_at),
// upserting the subscriptions row keyed on (owner_id, page_id).
async function handleAdminUpdateCustomer(request, env) {
  try {
    const adminId = await requireSuperAdmin(request, env);
    if (!adminId) return jsonResp({ error: "Unauthorized" }, 403);

    const body = await request.json();
    const { customer_id, business_name, logo_url, page_id, status, expires_at } = body;
    if (!customer_id) return jsonResp({ error: "customer_id প্রয়োজন" }, 400);

    if (business_name !== undefined || logo_url !== undefined) {
      const patch = {};
      if (business_name !== undefined) patch.business_name = business_name;
      if (logo_url !== undefined) patch.logo_url = logo_url;
      const r = await fetch(`${SB_URL}/rest/v1/profiles?id=eq.${customer_id}`, {
        method: "PATCH",
        headers: { apikey: dbKey(env), Authorization: `Bearer ${dbKey(env)}`, "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify(patch),
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) { const e2 = await r.json(); return jsonResp({ error: e2?.message || "Branding আপডেট ব্যর্থ" }, 500); }
    }

    if (page_id && status) {
      const r = await fetch(`${SB_URL}/rest/v1/subscriptions`, {
        method: "POST",
        headers: {
          apikey: dbKey(env), Authorization: `Bearer ${dbKey(env)}`, "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify({
          owner_id: customer_id, page_id, status,
          expires_at: expires_at || null,
          updated_at: new Date().toISOString(),
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) { const e2 = await r.json(); return jsonResp({ error: e2?.message || "Subscription আপডেট ব্যর্থ" }, 500); }
    }

    return jsonResp({ ok: true });
  } catch (e) {
    return jsonResp({ error: e.message || "Unknown error" }, 500);
  }
}

// Deletes a customer entirely: auth user (cascades to profile via FK) +
// their pages/keywords/etc are left for the admin's RLS-bypassing cleanup
// (cascade handled at DB level via ON DELETE CASCADE on fb_pages.owner_id).
async function handleAdminDeleteCustomer(request, env) {
  try {
    const adminId = await requireSuperAdmin(request, env);
    if (!adminId) return jsonResp({ error: "Unauthorized" }, 403);

    const { customer_id } = await request.json();
    if (!customer_id) return jsonResp({ error: "customer_id প্রয়োজন" }, 400);

    const r = await fetch(`${SB_URL}/auth/v1/admin/users/${customer_id}`, {
      method: "DELETE",
      headers: { apikey: dbKey(env), Authorization: `Bearer ${dbKey(env)}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) { const e2 = await r.json().catch(() => ({})); return jsonResp({ error: e2?.msg || "Delete ব্যর্থ" }, 500); }

    return jsonResp({ ok: true });
  } catch (e) {
    return jsonResp({ error: e.message || "Unknown error" }, 500);
  }
}

// Verifies the caller is actually logged in (via their Supabase access
// token) and owns the page they're asking to export comments for, then
// paginates every top-level comment off the Graph API and returns it as a
// CSV download. Deliberately omits the FB user ID — the CSV only carries
// what's needed to run and announce a "Random Winner" draw (name + comment
// text + time), nothing that could be used to re-identify or contact
// someone outside Facebook.
async function handleExportComments(request, env) {
  try {
    const { post_url, page_id, access_token: userAccessToken } = await request.json();
    if (!userAccessToken) return jsonResp({ error: "লগইন প্রয়োজন" }, 401);
    if (!page_id) return jsonResp({ error: "page_id প্রয়োজন" }, 400);

    const postId = await extractPostId(post_url);
    if (!postId) return jsonResp({ error: "পোস্ট লিংক/আইডি বুঝতে পারিনি" }, 400);

    // Confirm this user actually owns the page — query as the USER (anon
    // key + their JWT), so Postgres RLS on fb_pages enforces ownership for
    // us; we never trust page_id alone from the client.
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

    // Paginate top-level comments. summary=true gives Facebook's own total
    // count, which we surface alongside the unique-commenter count (ours)
    // since the two can differ when one person comments more than once.
    const comments = [];
    let nextUrl = `${GRAPH}/${encodeURIComponent(postId)}/comments?fields=from{name},message,created_time&filter=stream&order=chronological&limit=100&summary=true&access_token=${encodeURIComponent(pageAccessToken)}`;
    let fbTotalCount = null;
    let guard = 0;
    while (nextUrl && guard < 100) {
      guard++;
      const r = await fetch(nextUrl, { signal: AbortSignal.timeout(15000) });
      const data = await r.json();
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

    // Unique commenters by name (no FB user ID kept) — so a giveaway can
    // give everyone one entry regardless of how many times they commented.
    const seen = new Set();
    const uniqueCommenters = [];
    for (const c of comments) {
      const key = c.name.trim().toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        uniqueCommenters.push(c.name.trim());
      }
    }
    const topCounts = {};
    for (const c of comments) topCounts[c.name] = (topCounts[c.name] || 0) + 1;
    const topCommenter = Object.entries(topCounts).sort((a, b) => b[1] - a[1])[0] || null;

    // CSV: name,message,time — quoted + escaped so commas/quotes in
    // comments don't break columns.
    const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
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
  } catch (e) {
    console.error("[export-comments] error:", e.message);
    return jsonResp({ error: e.message || "অজানা সমস্যা" }, 500);
  }
}
