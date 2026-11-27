# Facebook Auto Reply Pages

## Working Facebook Comment Reply Flow

This repository's verified working comment-reply setup uses two separate Graph API calls:

### 1. Public comment reply

Send the public reply to the comment:

```http
POST https://graph.facebook.com/v21.0/{COMMENT_ID}/comments
```

### 2. Private reply to the commenter

Do **not** use the old comment-level `/{COMMENT_ID}/private_replies` endpoint in this implementation.

Send the private message through the Page Send API, using the comment ID as the recipient:

```http
POST https://graph.facebook.com/v21.0/{PAGE_ID}/messages
Content-Type: application/json
```

Request body:

```json
{
  "recipient": {
    "comment_id": "COMMENT_ID"
  },
  "message": {
    "text": "YOUR_PRIVATE_REPLY"
  },
  "access_token": "PAGE_ACCESS_TOKEN"
}
```

- `PAGE_ID`: Facebook Page ID associated with the webhook event.
- `COMMENT_ID`: ID of the comment being replied to.
- `PAGE_ACCESS_TOKEN`: Page access token loaded for that Page from the application's configured storage.
- `YOUR_PRIVATE_REPLY`: The private message text.

## Important implementation notes

- Keep the public reply and private reply as separate operations.
- Use the Page ID from the webhook event and the matching Page's access token.
- The token and Page must have the required Meta messaging permissions and the comment must be eligible for a private reply.
- Test with a **new comment** after deploying changes. A previously processed comment may be skipped by the application's duplicate/reply tracking.
- Check the webhook/Graph API response logs if the private message fails.

## Verified status

The Page Send API approach above was tested successfully in this project after replacing the previous `/{COMMENT_ID}/private_replies` request. Preserve this working flow when making future changes; do not switch it back without a specific reason and a fresh end-to-end test.

## Incident log: webhook producing no reaction/reply (Nov 27, 2026)

**Timeline:**
- `2a5fae7` (Nov 27, 08:58) — this README's verified-flow section above was written. Webhook code (`web/src/app/api/fb-webhook/route.ts`) was NOT touched by this commit.
- `4d0f1b1` (Nov 27, 10:06) — "Fix Supabase REST API key rejected by gateway". Updated the **browser client** (`web/src/lib/supabase.ts`) to use a new Supabase publishable key, because the project's old legacy anon JWT had been revoked (`UNAUTHORIZED_INVALID_API_KEY`). This commit did **not** update the matching hardcoded fallback key inside the webhook route — that was missed.
- Root cause of "nothing happens on comment (no react, no reply)": the webhook's `SB_KEY` fallback constant in `fb-webhook/route.ts` still held the same revoked legacy anon JWT. Whenever `SUPABASE_SERVICE_ROLE_KEY` was unset/misconfigured in Cloudflare Pages, `dbKey()` fell back to that dead key, so every Supabase call from the webhook (`getPageConfig`, `matchKeyword`, `hasReplied`, etc.) failed silently.
- `2ca1c2a` — Fixed: replaced the dead legacy anon key fallback in `fb-webhook/route.ts` with the current publishable key (`sb_publishable_aQq0-MD_7-rw8sLgAtbJFw_x49dHVmZ`).
- User also rotated `SUPABASE_SERVICE_ROLE_KEY` in Cloudflare Pages env vars to the current value.
- `a5cd9d5` — TEMP diagnostic commit: force-enabled `isDebugEnabled()` to always return `true`, and added an unconditional `[PING]` Telegram message at the top of the per-entry loop, to confirm whether the webhook POST was even being received. **Remove/revert this commit's changes once the Telegram-alert issue below is resolved.**

**Result after `2ca1c2a` + service-role key rotation:** React, public comment reply, and private inbox reply all started working correctly again. The original "nothing happens" bug is fixed.

**Separate, still-open issue:** The Telegram debug bot is not receiving any messages — not even the unconditional `[PING]` from `a5cd9d5`, despite `DEBUG_BOT_TOKEN` and `DEBUG_CHAT_ID` both being confirmed set in Cloudflare Pages env vars. Since the main comment-reply flow is confirmed working independent of this, the Telegram alert path itself (bot token validity, chat_id, bot being blocked/removed from the chat, or the fetch call failing at Cloudflare's edge) is the current open investigation. All Telegram calls in this file are wrapped in try/catch that swallow errors silently (`// best-effort debug logging only`), so no error trace is available from the webhook side for this — it needs to be tested directly against the Telegram Bot API (e.g. `getMe` / `sendMessage`) outside this app to isolate whether the token or chat_id is the problem.
