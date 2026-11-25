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


## Allow Atlas LMS to use this backend

To let the Atlas LMS call the resolver and media proxy from its own origin, add a Cloudflare Pages variable:

- Name: `ATLAS_ALLOWED_ORIGINS`
- Value: the exact Atlas production origin, for example `https://atlas.example.com` (no path and no trailing slash).

For multiple trusted Atlas origins, use a comma-separated list. The API only sends CORS permission to the exact configured origin; the existing same-origin Video Saver continues to work. Set the variable for Production and redeploy. Do not use `*`.

In Atlas, configure the build-time variable `VITE_VIDEO_DOWNLOADER_API_BASE` to this Video Saver site's origin (for example `https://your-video-saver-domain.example`), without a trailing slash. This is a public API base URL, not a secret. Keep `RAPIDAPI_KEY` only in this backend's server-side secrets.

The Atlas integration uses the resolver to confirm downloadable media, then the existing media proxy to stream the video into the student's device-local IndexedDB library. Only content the user owns or is authorized to download should be saved.
