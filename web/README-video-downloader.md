# All-in-One Video Downloader (Cloudflare Pages)

The supplied HTML interface is available at `/video-downloader.html`. It calls the same-origin Edge API route `/api/video-downloader`, which forwards requests to RapidAPI without exposing the key in browser JavaScript.

## Configure the secret

In Cloudflare Pages, open **Settings → Variables and Secrets → Add**:
- Name: `RAPIDAPI_KEY`
- Value: a newly generated key for `social-download-all-in-one`
- Store as a secret/encrypted value.

Set it for Production (and Preview if required), then redeploy. Never use a `NEXT_PUBLIC_` variable or commit the key.

## Important
- The old key embedded in the uploaded HTML is considered exposed. Revoke it and use a fresh key.
- A valid RapidAPI subscription and quota are required. Provider availability and supported platforms can change; live behavior has not yet been tested against your account.
- Use links you own or are authorized to download.
- Returned media URLs may be hosted elsewhere. Browser downloads depend on the host's CORS and Content-Disposition behavior. Android browser downloads normally go to Downloads; a website cannot silently force-save into Gallery.
