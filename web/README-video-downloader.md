# Self-hosted Video Saver (Cloudflare Pages + Render)

The Video Saver page remains at `/video-downloader.html`. The browser calls same-origin Cloudflare Pages API routes; the Pages routes proxy authenticated requests to the FastAPI + yt-dlp service on Render. No RapidAPI key is used by this workflow.

## Download workflow

1. The student pastes a supported public video URL and selects Fetch.
2. The Render API uses yt-dlp to return metadata (title, uploader, thumbnail, duration) and available progressive, video-only, and audio-only formats.
3. The page lists available qualities and lets the student choose an output container:
   - Video: MP4, WebM, MKV
   - Audio: MP3, M4A, WAV, FLAC
4. The student selects Download. Cloudflare creates a job through the authenticated Render API.
5. A background thread downloads the chosen stream. If the selected video stream has no audio, yt-dlp selects and merges a compatible audio stream.
6. FFmpeg remuxes the video into the chosen container or extracts/converts audio into the chosen audio format.
7. The page polls the job endpoint for progress. A random job ID plus high-entropy token protects status and file access.
8. The student receives a same-origin attachment URL. Files remain in Render's ephemeral `/tmp/video-downloader-jobs` directory for up to one hour, then are deleted automatically. A successful download does not immediately delete the file, allowing a retry before expiry.

## Render configuration

The Render Blueprint is `video-downloader-backend/render.yaml`. It installs FFmpeg and starts one Uvicorn worker. Configure:

- `API_KEY`: a strong random secret. Keep it private.
- `VIDEO_JOB_TTL_SECONDS`: temporary-file lifetime; default 3600 seconds.
- `VIDEO_JOB_MAX_BYTES`: maximum resulting file size; default 524288000 bytes (500 MB).

The backend allows one active processing job at a time to protect the Render Free instance. Jobs are held in process memory and files are stored on ephemeral disk; a service restart cancels in-memory jobs and removes access to files. This is not persistent storage or a durable queue.

## Cloudflare Pages configuration

Set these Production (and Preview, if needed) variables/secrets:

- `RENDER_API_URL`: Render service base URL, without a trailing slash.
- `SELF_API_KEY`: encrypted secret matching Render's `API_KEY`.
- `ATLAS_ALLOWED_ORIGINS`: optional comma-separated exact origins for Atlas cross-origin access.

The browser never receives the Render URL or API key. The new job proxy is `/api/video-downloader/jobs`; extraction remains `/api/video-downloader`. The older direct-stream route `/api/video-downloader/media` remains for existing integrations.

## Source and platform restrictions

- Allowed source domains are validated on both Render and Cloudflare.
- YouTube direct file extraction is intentionally not enabled. Public visibility does not grant a general download right, and this system does not bypass YouTube sign-in, anti-bot, private-video, DRM, or other access restrictions. For your own channel videos, use YouTube Studio or Google Takeout.
- Use other source links only when you have the rights and the platform permits downloading them.
- Cookie-upload / browser-cookie bypass functionality from the WordPress reference plugin is intentionally not ported.

## Operational limits

- Render Free has cold starts, limited memory/CPU/disk, and service-hour limits. One job at a time is intentional.
- Files are temporary and may be lost on service restart or redeploy.
- The job progress is based on yt-dlp download hooks; FFmpeg finalization may appear as a short preparation phase.
- A download link is available only while its job token and temporary file remain valid.
- The Cloudflare proxy is publicly callable unless you add user authentication / rate limiting. Before sharing with students, protect the endpoints with Cloudflare WAF rate limits or Turnstile and add the site's paid-student authorization check if required.

## Atlas integration

The existing `/api/video-downloader/media` endpoint remains available for Atlas cross-origin use. Set `ATLAS_ALLOWED_ORIGINS` to the exact Atlas production origin. In Atlas, `VITE_VIDEO_DOWNLOADER_API_BASE` should point to this site's origin.
