# Video Downloader Backend

A self-hosted backend for downloading **publicly accessible videos** from supported social URLs, without cookies or account credentials. It does not handle private videos, DRM, or access-control bypasses.

## Deploy
Build and run this container on a server with Docker:
```bash
docker build -t video-downloader .
docker run --rm -p 8080:8080 -e MAX_FILE_MB=500 video-downloader
```
Health check: `GET /health`

Download: `GET /download?url=<encoded-video-url>`. The response is a video file. Use HTTPS and place authentication/rate limiting in front of it before exposing publicly. This service should not be deployed as an unrestricted public proxy.

## Web app
Set `NEXT_PUBLIC_VIDEO_DOWNLOADER_URL` to the backend origin (for example, `https://your-service.example`) and redeploy the web app.

**Limitations:** source platforms can change or block extraction; some videos will fail. Respect platform terms, copyright, and creator permissions. No cookies/login, private content, DRM, or circumvention is supported.
