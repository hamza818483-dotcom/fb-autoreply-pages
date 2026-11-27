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
