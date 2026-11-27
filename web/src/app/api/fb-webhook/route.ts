export const runtime = "edge";

// Ported verbatim (logic-for-logic) from the repo root's _worker.js, which
// stopped being deployed once Cloudflare Pages' Root Directory was pointed
// at web/ to serve this dashboard — that silently killed the webhook,
// keyword replies, AI fallback and auto-react, since root _worker.js was no
// longer part of any deployment. Hosting it here instead keeps everything
// (dashboard + webhook) on the one domain/deployment, as needed.
//
// env.X (Cloudflare Pages Functions env) -> process.env.X (Next.js) is the
// only mechanical change; set the same env var names in this Next.js
// project's Cloudflare Pages settings that were set on the old root
// project: FB_VERIFY_TOKEN, PAGE_ACCESS_TOKEN, SUPABASE_SERVICE_ROLE_KEY,
// DEBUG_BOT_TOKEN, DEBUG_CHAT_ID.

const GRAPH = "https://graph.facebook.com/v21.0";
const SB_URL = "https://wbdyjpjbczfunyhhmtry.supabase.co";
// Legacy anon JWT is revoked (UNAUTHORIZED_INVALID_API_KEY) — see
// web/src/lib/supabase.ts commit 4d0f1b1. Use the current publishable key as
// the fallback instead so the webhook doesn't silently fail when
// SUPABASE_SERVICE_ROLE_KEY is unset/misconfigured in Cloudflare Pages env.
const SB_KEY = "sb_publishable_aQq0-MD_7-rw8sLgAtbJFw_x49dHVmZ";

// The webhook has no user session, so RLS-protected tables (fb_pages,
// keyword_replies) require the service_role key to bypass RLS. Falls back
// to the anon key (which RLS will reject) until SUPABASE_SERVICE_ROLE_KEY
// is configured in Cloudflare Pages env vars.
function dbKey(): string {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || SB_KEY;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  const VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN || "atlastoken";
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return new Response(challenge || "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

export async function POST(request: Request) {
  const bodyText = await request.text();
  // IMPORTANT: must await this, not fire-and-forget. A fire-and-forget
  // promise here (started but not awaited before returning the Response)
  // was getting cut off mid-flight on Cloudflare's Edge runtime — no
  // ctx.waitUntil() equivalent keeps it alive the way Workers does, so
  // react/keyword-reply/AI calls inside it were silently never completing
  // once the response went out. Facebook allows up to ~20s before it
  // considers the webhook delivery timed out, which comfortably covers the
  // Graph API + Supabase calls below, so awaiting here is safe.
  try {
    await handleFbEvent(bodyText);
  } catch (e: any) {
    console.error("[fb-webhook] unhandled:", e?.message);
  }
  return new Response("EVENT_RECEIVED", { status: 200 });
}

async function handleFbEvent(bodyText: string) {
  try {
    const body = JSON.parse(bodyText);
    if (body.object && body.object !== "page") return;
    if (!body.entry) return;

    for (const entry of body.entry || []) {
      const webhookPageId = entry.id;
      // TEMP diagnostic ping: confirms the webhook POST actually arrives and
      // parses, independent of pageConfig/Supabase. Remove once confirmed.
      await tgDebugGlobal(`[PING] webhook POST received for page_id=${webhookPageId}, changes=${JSON.stringify(entry.changes || []).slice(0, 500)}`);
      const pageConfig = await getPageConfig(webhookPageId);
      if (!pageConfig) {
        await tgDebugGlobal(
          `[ALERT] no pageConfig for page_id=${webhookPageId} — check fb_pages row and SUPABASE_SERVICE_ROLE_KEY env var`,
          webhookPageId
        );
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

          if (fromId && fromId === webhookPageId) continue;

          const dlog = await Debug.start(webhookPageId, `Comment: "${message}"\nID: ${commentId}`);

          const reactResult = await reactToComment(commentId, pageConfig.page_access_token, dlog);
          if (!reactResult || reactResult.error) {
            await dlog.add(`❌ React FAILED\n${JSON.stringify(reactResult)}`);
          }

          const match = await matchKeyword(message, webhookPageId);
          if (match) {
            await dlog.add(`✅ Keyword matched: "${match.matchedKeyword || ""}"`);
            const alreadyReplied = await hasReplied(commentId);
            if (!alreadyReplied) {
              const replyText = fromId ? `@[${fromId}] ${match.reply}` : match.reply;
              const replyResult = await replyToComment(commentId, replyText, pageConfig.page_access_token, match.reply_image_url);
              if (!replyResult || replyResult.error) {
                await dlog.add(`❌ Keyword-reply FAILED\n${JSON.stringify(replyResult)}`);
              } else {
                await dlog.add(`✅ Replied (keyword)${match.reply_image_url ? " + image" : ""}`);
              }

              const privateMsg = match.private_reply || match.reply;
              const privateResult = await sendPrivateReply(webhookPageId, commentId, privateMsg, pageConfig.page_access_token, match.private_reply_image_url);
              if (!privateResult || privateResult.error) {
                const reason = privateResult?.error?.message || privateResult?.error?.error_user_msg || JSON.stringify(privateResult);
                await dlog.add(`❌ Private reply FAILED\nReason: ${reason}`);
              } else {
                await dlog.add(`✅ Private (inbox) reply sent${match.private_reply_image_url ? " (image)" : ""}`);
              }

              await markReplied(commentId);
            } else {
              await dlog.add(`⏭ Already replied — skipped (duplicate)`);
            }
          } else {
            await dlog.add(`ℹ️ No keyword match — trying AI fallback`);
            const alreadyReplied = await hasReplied(commentId);
            if (!alreadyReplied) {
              const aiReply = await generateAiReply(message, webhookPageId, dlog);
              if (aiReply) {
                const replyText = fromId ? `@[${fromId}] ${aiReply}` : aiReply;
                await replyToComment(commentId, replyText, pageConfig.page_access_token);
                await markReplied(commentId);
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
  } catch (e: any) {
    console.error("[fb-webhook] processing error:", e.message);
  }
}

async function getPageConfig(pageId: string): Promise<{ page_id: string; page_access_token: string } | null> {
  if (!pageId) return null;
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/fb_pages?page_id=eq.${encodeURIComponent(pageId)}&select=page_id,page_access_token`,
      {
        headers: { apikey: dbKey(), Authorization: `Bearer ${dbKey()}` },
        signal: AbortSignal.timeout(10000),
      }
    );
    const rows = await r.json();
    if (!r.ok) {
      await tgDebugGlobal(
        `[ALERT] Supabase fb_pages query failed status=${r.status} — likely bad SUPABASE_SERVICE_ROLE_KEY. ${JSON.stringify(rows).slice(0, 300)}`
      );
      return null;
    }
    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  } catch (e: any) {
    await tgDebugGlobal(`[ALERT] getPageConfig exception: ${e.message}`);
    console.error("[fb-webhook] getPageConfig failed:", e.message);
    return null;
  }
}

const Debug = {
  async start(pageId: string, headerText: string) {
    const enabled = await isDebugEnabled(pageId);
    if (!enabled || !process.env.DEBUG_BOT_TOKEN || !process.env.DEBUG_CHAT_ID) {
      return { add: async (_line: string) => {} };
    }
    const lines = [headerText];
    let messageId: number | null = null;
    try {
      const res = await fetch(`https://api.telegram.org/bot${process.env.DEBUG_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: process.env.DEBUG_CHAT_ID, text: lines.join("\n") }),
      });
      const data: any = await res.json();
      messageId = data.result && data.result.message_id;
    } catch {
      // best-effort debug logging only
    }

    return {
      async add(line: string) {
        lines.push(line);
        if (!messageId) return;
        try {
          await fetch(`https://api.telegram.org/bot${process.env.DEBUG_BOT_TOKEN}/editMessageText`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: process.env.DEBUG_CHAT_ID,
              message_id: messageId,
              text: lines.join("\n").slice(0, 3900),
            }),
          });
        } catch {
          // best-effort debug logging only
        }
      },
    };
  },
};

async function tgDebugGlobal(text: string, pageId?: string) {
  if (!process.env.DEBUG_BOT_TOKEN || !process.env.DEBUG_CHAT_ID) return;
  if (pageId) {
    const enabled = await isDebugEnabled(pageId);
    if (!enabled) return;
  }
  try {
    await fetch(`https://api.telegram.org/bot${process.env.DEBUG_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: process.env.DEBUG_CHAT_ID, text: text.slice(0, 3800) }),
    });
  } catch {
    // best-effort debug logging only
  }
}

async function isDebugEnabled(pageId: string): Promise<boolean> {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/ai_settings?page_id=eq.${encodeURIComponent(pageId)}&select=debug_alerts_enabled`, {
      headers: { apikey: dbKey(), Authorization: `Bearer ${dbKey()}` },
      signal: AbortSignal.timeout(8000),
    });
    const rows: any = await r.json();
    if (!r.ok) {
      console.error("[isDebugEnabled] query failed status=", r.status, JSON.stringify(rows).slice(0, 300));
      return false;
    }
    if (!Array.isArray(rows) || rows.length === 0) return false;
    return rows[0].debug_alerts_enabled === true;
  } catch (e: any) {
    console.error("[isDebugEnabled] exception:", e.message);
    return false;
  }
}

function editDistance(a: string, b: string): number {
  const m = a.length,
    n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array(n + 1)
    .fill(0)
    .map((_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}

function fuzzyContains(message: string, keyword: string): boolean {
  if (!keyword) return false;
  if (message.includes(keyword)) return true;

  const maxDist = keyword.length <= 3 ? 0 : keyword.length <= 6 ? 1 : 2;
  if (maxDist === 0) return false;

  const words = message.split(/[^a-z0-9ঀ-৿]+/i).filter(Boolean);
  for (const w of words) {
    if (Math.abs(w.length - keyword.length) > maxDist) continue;
    if (editDistance(w, keyword) <= maxDist) return true;
  }
  return false;
}

async function matchKeyword(
  message: string,
  pageId: string
): Promise<{ reply: string; private_reply: string; matchedKeyword: string; reply_image_url: string | null; private_reply_image_url: string | null } | null> {
  try {
    const url = `${SB_URL}/rest/v1/keyword_replies?page_id=eq.${encodeURIComponent(pageId)}&select=keyword,reply,private_reply,reply_image_url,private_reply_image_url`;
    const r = await fetch(url, {
      headers: { apikey: dbKey(), Authorization: `Bearer ${dbKey()}` },
      signal: AbortSignal.timeout(10000),
    });
    const rows: any = await r.json();
    if (!r.ok || !Array.isArray(rows)) {
      await tgDebugGlobal(`[ALERT] Supabase keyword_replies query failed status=${r.status} — ${JSON.stringify(rows).slice(0, 300)}`);
      return null;
    }

    for (const row of rows) {
      const keywordsRaw = row.keyword || "";
      const keywords = keywordsRaw
        .split(",")
        .map((k: string) => k.trim().toLowerCase())
        .filter(Boolean);
      const hit = keywords.find((kw: string) => fuzzyContains(message, kw));
      if (hit) {
        return {
          reply: row.reply || "",
          private_reply: row.private_reply || row.reply || "",
          matchedKeyword: hit,
          reply_image_url: row.reply_image_url || null,
          private_reply_image_url: row.private_reply_image_url || row.reply_image_url || null,
        };
      }
    }
  } catch (e: any) {
    await tgDebugGlobal(`[ALERT] matchKeyword exception: ${e.message}`);
    console.error("[fb-webhook] Supabase keyword lookup failed:", e.message);
  }
  return null;
}

async function hasReplied(commentId: string): Promise<boolean> {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/replied_comments?comment_id=eq.${encodeURIComponent(commentId)}&select=comment_id`, {
      headers: { apikey: dbKey(), Authorization: `Bearer ${dbKey()}` },
      signal: AbortSignal.timeout(10000),
    });
    const rows = await r.json();
    return Array.isArray(rows) && rows.length > 0;
  } catch (e: any) {
    console.error("[fb-webhook] hasReplied check failed:", e.message);
    return false; // fail open: better a rare duplicate than silently never replying
  }
}

async function markReplied(commentId: string) {
  try {
    await fetch(`${SB_URL}/rest/v1/replied_comments`, {
      method: "POST",
      headers: {
        apikey: dbKey(),
        Authorization: `Bearer ${dbKey()}`,
        "Content-Type": "application/json",
        Prefer: "resolution=ignore-duplicates",
      },
      body: JSON.stringify({ comment_id: commentId }),
      signal: AbortSignal.timeout(10000),
    });
  } catch (e: any) {
    console.error("[fb-webhook] markReplied failed:", e.message);
  }
}

async function reactToComment(
  commentId: string,
  pageAccessToken: string,
  dlog?: { add: (line: string) => Promise<void> }
): Promise<any> {
  const log = dlog || { add: async () => {} };
  try {
    const token = pageAccessToken || process.env.PAGE_ACCESS_TOKEN;
    // LOVE via the /reactions edge requires an app capability this app
    // doesn't have (Graph error #3: "Application does not have the
    // capability to make this API call") — that's an app-level Facebook
    // restriction, not fixable via token/permissions. Reverted to the
    // plain /likes endpoint, which works without that capability.
    const res = await fetch(`${GRAPH}/${commentId}/likes?access_token=${encodeURIComponent(token || "")}`, {
      method: "POST",
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    if (!res.ok) {
      await log.add(`❌ Like react failed (HTTP ${res.status}): ${JSON.stringify(data).slice(0, 300)}`);
      console.error("[fb-webhook] react failed:", JSON.stringify(data));
    } else {
      await log.add(`✅ Reacted`);
    }
    return data;
  } catch (e: any) {
    await log.add(`❌ reactToComment exception: ${e.message}`);
    console.error("[fb-webhook] reactToComment error:", e.message);
  }
}

async function replyToComment(commentId: string, message: string, pageAccessToken: string, imageUrl?: string | null): Promise<any> {
  try {
    const token = pageAccessToken || process.env.PAGE_ACCESS_TOKEN;
    // Comment replies on Facebook can carry attachment_url (an image URL)
    // alongside or instead of message text — the Graph API accepts both.
    const body: any = { access_token: token };
    if (message) body.message = message;
    if (imageUrl) body.attachment_url = imageUrl;
    const res = await fetch(`${GRAPH}/${commentId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    if (!res.ok) console.error("[fb-webhook] reply failed:", JSON.stringify(data));
    return data;
  } catch (e: any) {
    console.error("[fb-webhook] replyToComment error:", e.message);
  }
}

async function sendPrivateReply(pageId: string, commentId: string, message: string, pageAccessToken: string, imageUrl?: string | null): Promise<any> {
  try {
    const token = pageAccessToken || process.env.PAGE_ACCESS_TOKEN;
    // Send a private reply through the Page Send API, addressing the
    // original comment as the recipient. The legacy /private_replies edge
    // is no longer a reliable supported path. If an image URL is set,
    // send it as an image attachment message instead of plain text —
    // Messenger Send API only allows one message type per call, so when
    // both text and an image are present we send the image (the keyword's
    // reply text was already posted as the public comment reply).
    const msg: any = imageUrl
      ? { attachment: { type: "image", payload: { url: imageUrl, is_reusable: true } } }
      : { text: message };
    const res = await fetch(`${GRAPH}/${pageId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: { comment_id: commentId },
        message: msg,
        access_token: token || "",
      }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    if (!res.ok) console.error("[fb-webhook] private reply failed:", JSON.stringify(data));
    return data;
  } catch (e: any) {
    console.error("[fb-webhook] sendPrivateReply error:", e.message);
    return { error: { message: e.message } };
  }
}

// ============================================================
// AI fallback reply — used when no keyword matches a comment.
// Tries Gemini keys first (comma-separated, tried in order),
// then Groq keys, same pattern as QuizBot's provider fallback.
// ============================================================

async function getAiSettings(pageId: string): Promise<any | null> {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/ai_settings?page_id=eq.${encodeURIComponent(pageId)}&select=*`, {
      headers: { apikey: dbKey(), Authorization: `Bearer ${dbKey()}` },
      signal: AbortSignal.timeout(10000),
    });
    const rows = await r.json();
    if (!r.ok) {
      await tgDebugGlobal(`[AI-DEBUG] getAiSettings query failed status=${r.status} ${JSON.stringify(rows).slice(0, 300)}`);
      return null;
    }
    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  } catch (e: any) {
    await tgDebugGlobal(`[AI-DEBUG] getAiSettings exception: ${e.message}`);
    console.error("[fb-webhook] getAiSettings failed:", e.message);
    return null;
  }
}

async function generateAiReply(message: string, pageId: string, dlog: { add: (line: string) => Promise<void> }): Promise<string | null> {
  const log = dlog || { add: async () => {} };

  const settings = await getAiSettings(pageId);
  if (!settings) {
    await log.add(`❌ AI not configured for this page (no ai_settings row)`);
    return null;
  }
  if (!settings.ai_enabled) {
    await log.add(`❌ AI reply is turned OFF for this page`);
    return null;
  }

  const systemPrompt =
    settings.system_prompt || "You are a helpful Facebook page assistant. Reply briefly and politely in the same language as the comment.";
  const geminiKeys =
    settings.gemini_enabled !== false
      ? (settings.gemini_keys || "")
          .split(",")
          .map((k: string) => k.trim())
          .filter(Boolean)
      : [];
  const groqKeys =
    settings.groq_enabled !== false
      ? (settings.groq_keys || "")
          .split(",")
          .map((k: string) => k.trim())
          .filter(Boolean)
      : [];

  if (geminiKeys.length === 0 && groqKeys.length === 0) {
    await log.add(`❌ No AI provider keys configured/enabled (Gemini: ${geminiKeys.length}, Groq: ${groqKeys.length})`);
    return null;
  }

  for (let i = 0; i < geminiKeys.length; i++) {
    const reply = await tryGemini(geminiKeys[i], systemPrompt, message, log, i + 1, geminiKeys.length);
    if (reply) {
      await log.add(`✅ Gemini key #${i + 1} succeeded`);
      return reply;
    }
  }
  for (let i = 0; i < groqKeys.length; i++) {
    const reply = await tryGroq(groqKeys[i], systemPrompt, message, log, i + 1, groqKeys.length);
    if (reply) {
      await log.add(`✅ Groq key #${i + 1} succeeded`);
      return reply;
    }
  }
  await log.add(`❌ All AI providers failed (Gemini: ${geminiKeys.length} tried, Groq: ${groqKeys.length} tried)`);
  return null;
}

// Model fallback chain: main model first, then older/newer flash variants
// if the main model name is invalid or temporarily unavailable for a key.
const GEMINI_MODELS = ["gemini-3.6-flash", "gemini-3.1-flash", "gemini-3.5-flash"];

async function tryGemini(
  apiKey: string,
  systemPrompt: string,
  message: string,
  log: { add: (line: string) => Promise<void> },
  idx: number,
  total: number
): Promise<string | null> {
  for (let m = 0; m < GEMINI_MODELS.length; m++) {
    const model = GEMINI_MODELS[m];
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: "user", parts: [{ text: message }] }],
          generationConfig: { maxOutputTokens: 400, thinkingConfig: { thinkingBudget: 0 } },
        }),
        signal: AbortSignal.timeout(25000),
      });
      if (!res.ok) {
        const errText = await res.text();
        console.error("[fb-webhook] Gemini failed:", model, res.status, errText);
        if (log) await log.add(`❌ Gemini key #${idx}/${total} model=${model} FAILED — HTTP ${res.status}\n${errText.slice(0, 300)}`);
        continue; // try next model in the chain
      }
      const data: any = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        if (log) await log.add(`❌ Gemini key #${idx}/${total} model=${model} — got response but no text (likely blocked/empty): ${JSON.stringify(data).slice(0, 300)}`);
        continue;
      }
      if (log && model !== GEMINI_MODELS[0]) await log.add(`ℹ️ Gemini key #${idx}/${total} succeeded on fallback model=${model}`);
      return text.trim();
    } catch (e: any) {
      console.error("[fb-webhook] tryGemini error:", model, e.message);
      if (log) await log.add(`❌ Gemini key #${idx}/${total} model=${model} — exception: ${e.message}`);
    }
  }
  return null;
}

async function tryGroq(
  apiKey: string,
  systemPrompt: string,
  message: string,
  log: { add: (line: string) => Promise<void> },
  idx: number,
  total: number
): Promise<string | null> {
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
      if (log) await log.add(`❌ Groq key #${idx}/${total} (...${apiKey.slice(-6)}) FAILED — HTTP ${res.status}\n${errText.slice(0, 300)}`);
      return null;
    }
    const data: any = await res.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text && log) await log.add(`❌ Groq key #${idx}/${total} — got response but no text: ${JSON.stringify(data).slice(0, 300)}`);
    return text ? text.trim() : null;
  } catch (e: any) {
    console.error("[fb-webhook] tryGroq error:", e.message);
    if (log) await log.add(`❌ Groq key #${idx}/${total} — exception: ${e.message}`);
    return null;
  }
}
