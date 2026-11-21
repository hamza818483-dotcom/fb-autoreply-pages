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

const GRAPH = "https://graph.facebook.com/v19.0";
const SB_URL = "https://wbdyjpjbczfunyhhmtry.supabase.co";
const SB_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndiZHlqcGpiY3pmdW55aGhtdHJ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA2OTI5ODAsImV4cCI6MjA5NjI2ODk4MH0.0WR1sgVsl_1XWZfSd0Pwoe6Uxp-2GMTksfseMn5aWjg";

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

          const reactResult = await reactToComment(commentId, pageConfig.page_access_token);
          if (!reactResult || reactResult.error) {
            await dlog.add(`❌ Love-react FAILED\n${JSON.stringify(reactResult)}`);
          } else {
            await dlog.add(`✅ Reacted`);
          }

          const match = await matchKeyword(message, webhookPageId);
          if (match) {
            await dlog.add(`✅ Keyword matched: "${match.matchedKeyword || ""}"`);
            const alreadyReplied = await hasReplied(commentId);
            if (!alreadyReplied) {
              const replyText = fromId ? `@[${fromId}] ${match.reply}` : match.reply;
              const replyResult = await replyToComment(commentId, replyText, pageConfig.page_access_token);
              if (!replyResult || replyResult.error) {
                await dlog.add(`❌ Keyword-reply FAILED\n${JSON.stringify(replyResult)}`);
              } else {
                await dlog.add(`✅ Replied (keyword)`);
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
    if (!Array.isArray(rows) || rows.length === 0) return false;
    return rows[0].debug_alerts_enabled === true;
  } catch {
    return true; // fail open: better a stray debug message than losing real alerts
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
): Promise<{ reply: string; private_reply: string; matchedKeyword: string } | null> {
  try {
    const url = `${SB_URL}/rest/v1/keyword_replies?page_id=eq.${encodeURIComponent(pageId)}&select=keyword,reply,private_reply`;
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

async function reactToComment(commentId: string, pageAccessToken: string): Promise<any> {
  try {
    const token = pageAccessToken || process.env.PAGE_ACCESS_TOKEN;
    // Try LOVE reaction first via the reactions edge (supports type=LOVE).
    // Falls back to a plain like if LOVE is rejected for any reason, so
    // auto-react never silently stops working.
    const res = await fetch(
      `${GRAPH}/${commentId}/reactions?type=LOVE&access_token=${encodeURIComponent(token || "")}`,
      { method: "POST", signal: AbortSignal.timeout(15000) }
    );
    const data = await res.json();
    if (!res.ok) {
      console.error("[fb-webhook] LOVE react failed, falling back to like:", JSON.stringify(data));
      const fallback = await fetch(`${GRAPH}/${commentId}/likes?access_token=${encodeURIComponent(token || "")}`, {
        method: "POST",
        signal: AbortSignal.timeout(15000),
      });
      const fbData = await fallback.json();
      if (!fallback.ok) console.error("[fb-webhook] like fallback also failed:", JSON.stringify(fbData));
      return fbData;
    }
    return data;
  } catch (e: any) {
    console.error("[fb-webhook] reactToComment error:", e.message);
  }
}

async function replyToComment(commentId: string, message: string, pageAccessToken: string): Promise<any> {
  try {
    const token = pageAccessToken || process.env.PAGE_ACCESS_TOKEN;
    const res = await fetch(`${GRAPH}/${commentId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, access_token: token }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    if (!res.ok) console.error("[fb-webhook] reply failed:", JSON.stringify(data));
    return data;
  } catch (e: any) {
    console.error("[fb-webhook] replyToComment error:", e.message);
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

async function tryGemini(
  apiKey: string,
  systemPrompt: string,
  message: string,
  log: { add: (line: string) => Promise<void> },
  idx: number,
  total: number
): Promise<string | null> {
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${encodeURIComponent(apiKey)}`, {
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
      console.error("[fb-webhook] Gemini failed:", res.status, errText);
      if (log) await log.add(`❌ Gemini key #${idx}/${total} FAILED — HTTP ${res.status}\n${errText.slice(0, 300)}`);
      return null;
    }
    const data: any = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text && log) await log.add(`❌ Gemini key #${idx}/${total} — got response but no text (likely blocked/empty): ${JSON.stringify(data).slice(0, 300)}`);
    return text ? text.trim() : null;
  } catch (e: any) {
    console.error("[fb-webhook] tryGemini error:", e.message);
    if (log) await log.add(`❌ Gemini key #${idx}/${total} — exception: ${e.message}`);
    return null;
  }
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
