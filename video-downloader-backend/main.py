import gc
import hmac
import os
import shutil
import threading
from urllib.parse import urlparse

import yt_dlp
from fastapi import FastAPI, Header, HTTPException, Query
from yt_dlp.utils import DownloadError

app = FastAPI(title="Self-hosted Video Extractor", version="1.1.0")
API_KEY = os.environ.get("API_KEY", "")
EXTRACTION_LOCK = threading.BoundedSemaphore(1)

ALLOWED_DOMAINS = {
    "youtube.com", "youtu.be",
    "facebook.com", "fb.watch",
    "instagram.com",
    "tiktok.com",
    "twitter.com", "x.com",
    "pinterest.com", "pin.it",
}


def validate_source(raw_url: str) -> str:
    if len(raw_url) > 4096:
        raise HTTPException(status_code=400, detail="URL is too long.")
    try:
        parsed = urlparse(raw_url)
        host = (parsed.hostname or "").lower().rstrip(".")
        port = parsed.port
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid URL.")

    if parsed.scheme not in ("http", "https") or not host:
        raise HTTPException(status_code=400, detail="Only HTTP(S) video links are supported.")
    if parsed.username or parsed.password or port not in (None, 80, 443):
        raise HTTPException(status_code=400, detail="This URL is not supported.")
    if not any(host == domain or host.endswith("." + domain) for domain in ALLOWED_DOMAINS):
        raise HTTPException(status_code=400, detail="This platform is not supported.")
    return raw_url


def safe_media_url(value):
    if not isinstance(value, str) or not value.startswith("https://"):
        return None
    return value


def describe_format(fmt):
    media_url = safe_media_url(fmt.get("url"))
    if not media_url:
        return None
    ext = str(fmt.get("ext") or "mp4").lower()
    if not ext.isalnum():
        ext = "mp4"
    height = fmt.get("height")
    width = fmt.get("width")
    resolution = fmt.get("resolution")
    if not resolution and height:
        resolution = f"{height}p"
    return {
        "format_id": str(fmt.get("format_id") or ""),
        "url": media_url,
        "ext": ext,
        "quality": str(fmt.get("format_note") or resolution or "Standard"),
        "resolution": str(resolution or "Audio"),
        "height": height,
        "width": width,
        "filesize": fmt.get("filesize") or fmt.get("filesize_approx"),
        "vcodec": fmt.get("vcodec"),
        "acodec": fmt.get("acodec"),
    }


def extract_video_info(source_url: str):
    # yt-dlp automatically uses Deno when installed. yt-dlp[default] supplies
    # the matching yt-dlp-ejs challenge solver package required by YouTube.
    options = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "skip_download": True,
        "cachedir": False,
        "socket_timeout": 25,
        "retries": 2,
        "extractor_retries": 2,
        "fragment_retries": 2,
        "ignoreerrors": False,
    }
    with yt_dlp.YoutubeDL(options) as ydl:
        info = ydl.extract_info(source_url, download=False)

    if not info:
        raise DownloadError("No video information was returned.")
    if isinstance(info, dict) and info.get("_type") == "playlist":
        raise HTTPException(status_code=400, detail="Playlists are not supported. Use a single video link.")

    formats = info.get("formats") or []
    progressive = []
    audio_only = []
    seen = set()

    for fmt in formats:
        protocol = str(fmt.get("protocol") or "").lower()
        if protocol not in ("http", "https"):
            continue
        video_codec = fmt.get("vcodec")
        audio_codec = fmt.get("acodec")
        item = describe_format(fmt)
        if not item or not item["format_id"] or item["format_id"] in seen:
            continue

        if video_codec and video_codec != "none" and audio_codec and audio_codec != "none":
            progressive.append(item)
            seen.add(item["format_id"])
        elif (not video_codec or video_codec == "none") and audio_codec and audio_codec != "none":
            audio_only.append(item)
            seen.add(item["format_id"])

    progressive.sort(key=lambda item: (item.get("height") or 0, item.get("filesize") or 0), reverse=True)
    audio_only.sort(key=lambda item: item.get("filesize") or 0, reverse=True)

    if not progressive and not audio_only:
        raise HTTPException(
            status_code=422,
            detail="The platform returned no directly downloadable video/audio formats for this link.",
        )

    return {
        "title": str(info.get("title") or "Video")[:300],
        "author": info.get("uploader") or info.get("channel"),
        "thumbnail": info.get("thumbnail"),
        "duration": info.get("duration"),
        "platform": info.get("extractor_key") or info.get("extractor"),
        "medias": progressive + audio_only,
    }


@app.get("/health")
def health():
    return {
        "ok": True,
        "service": "video-extractor",
        "yt_dlp_version": yt_dlp.version.__version__,
        "javascript_runtime": "deno" if shutil.which("deno") else None,
        "youtube_js_challenge_support": bool(shutil.which("deno")),
    }


@app.get("/extract")
def extract(
    url: str = Query(..., min_length=8, max_length=4096),
    x_api_key: str | None = Header(default=None),
):
    if not API_KEY:
        raise HTTPException(status_code=503, detail="Backend API key is not configured.")
    if not x_api_key or not hmac.compare_digest(x_api_key, API_KEY):
        raise HTTPException(status_code=401, detail="Invalid API key.")

    source_url = validate_source(url)
    if not EXTRACTION_LOCK.acquire(blocking=False):
        raise HTTPException(status_code=429, detail="The extractor is busy. Please retry shortly.")

    try:
        try:
            return extract_video_info(source_url)
        except HTTPException:
            raise
        except DownloadError as exc:
            message = str(exc).lower()
            if "private" in message or "login" in message or "sign in" in message:
                raise HTTPException(status_code=403, detail="This video is private or requires sign-in.")
            if "javascript" in message or "js runtime" in message or "challenge" in message:
                raise HTTPException(
                    status_code=422,
                    detail="YouTube could not complete its player verification. Please retry later or try another public video.",
                )
            raise HTTPException(status_code=422, detail="Could not extract this video. It may be unavailable or unsupported.")
        except Exception:
            raise HTTPException(status_code=502, detail="The video platform could not be reached. Please retry.")
    finally:
        gc.collect()
        EXTRACTION_LOCK.release()
