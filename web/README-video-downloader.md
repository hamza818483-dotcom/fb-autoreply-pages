# Self-hosted Video Saver (Cloudflare Pages + Render)

The existing Video Saver page remains at `/video-downloader.html`. Its same-origin API route `/api/video-downloader` now forwards extraction requests to the self-hosted FastAPI + yt-dlp service on Render. RapidAPI is no longer used by these routes.

## 1. Deploy the Render backend

1. In Render, create a new **Blueprint** and connect this repository.
2. Set the Blueprint file path to `video-downloader-backend/render.yaml` if Render asks for it.
3. Render creates `fb-video-downloader-api`. During setup, provide a strong random value for `API_KEY`.
4. Generate a key locally with `openssl rand -hex 32`. Keep it private.
5. After deployment, check `https://YOUR-RENDER-SERVICE.onrender.com/health`.

The backend uses one extraction slot at a time to protect the 512 MB free instance. Free services sleep after inactivity and may take time to wake. yt-dlp direct progressive formats are returned; separate video-only and manifest formats are intentionally not offered because this service does not merge them with FFmpeg.

## 2. Configure Cloudflare Pages

In the Cloudflare Pages project, open **Settings → Variables and Secrets** and add these for Production (and Preview if you use it):

- `RENDER_API_URL`: the Render service base URL, e.g. `https://fb-video-downloader-api.onrender.com` (no trailing slash).
- `SELF_API_KEY`: the exact same secret value as Render's `API_KEY`, stored as an encrypted secret.
- `ATLAS_ALLOWED_ORIGINS`: optional comma-separated exact Atlas origins, e.g. `https://atlas.example.com`. Do not use `*`.

Redeploy Pages after setting variables. The browser only calls the same-origin Next.js Edge API route (deployed through the existing Cloudflare Pages adapter); it never receives the Render URL or API key. Allow enough time for Render Free cold starts; the proxy waits up to 110 seconds for extraction.

## 3. Protect the public proxy\n\nThe API key protects the Render service, but the same-origin Pages proxy is publicly callable. Before sharing the site, add Cloudflare WAF rate-limiting rules for `/api/video-downloader` and `/api/video-downloader/media` (for example, a modest per-IP request threshold) and monitor Render usage. For stronger abuse protection, add Cloudflare Turnstile verification to the fetch form and validate its token server-side. CORS is not authentication.\n\n## 4. Remove old RapidAPI secrets

After verifying the self-hosted service, remove `RAPIDAPI_KEY` and `RAPIDAPI_HOSTS` from Cloudflare Pages if no other feature uses them. Revoke any previously exposed RapidAPI key in the provider dashboard.

## Supported behavior and limits

- Supported source domains are restricted in the backend to YouTube, Facebook, Instagram, TikTok, X/Twitter, and Pinterest.
- Only public links that can be accessed without bypassing sign-in, private-account, DRM, or other access restrictions should be used.
- The extractor returns progressive combined audio/video formats and audio-only formats. Many sources do not provide progressive formats, so some links or qualities will not be available.
- Direct media URLs are temporary and may expire. The media host may also impose its own download/CORS rules.
- Render Free is not unlimited: cold starts, monthly instance-hour limits, memory limits, and provider-side throttling apply. This is a best-effort personal project backend, not a high-volume production service.
- YouTube extraction can change as the platform changes; yt-dlp may need updates or an additional JavaScript runtime for some formats.

## Atlas integration

The existing `/api/video-downloader/media` endpoint remains available for Atlas cross-origin use. It resolves the original public source URL through the self-hosted backend, then streams the selected progressive video while forwarding byte-range requests. Set `ATLAS_ALLOWED_ORIGINS` to Atlas's exact production origin. In Atlas, `VITE_VIDEO_DOWNLOADER_API_BASE` should point to this site's origin.
