import gc
import hmac
import logging
import os
import re
import shutil
import threading
from urllib.parse import urlparse

import yt_dlp
from fastapi import FastAPI, Header, HTTPException, Query
from yt_dlp.utils import DownloadError

logger = logging.getLogger("video_extractor")

class YtDlpDiagnosticLogger:
    """Keep only actionable yt-dlp diagnostics and redact request secrets."""

    _MARKERS = (
        "[debug] [youtube]", "po token", "pot ", "javascript", "js challenge",
        "player response", "innertube", "extractor args", "http error",
        "yt-dlp version", "js runtimes", "deno",
    )

    @staticmethod
    def _safe(message):
        message = str(message)
        # Do not put signed media URLs, video URLs, or request query strings in logs.
        message = re.sub(r"https?://[^\s'\"<>]+", "[redacted URL]", message)
        message = re.sub(
            r"(?i)\b(cookie|authorization|po_token|visitor_data|signature|sig|lsig|key)\s*[:=]\s*([^\s,;]+)",
            r"\1=[redacted]",
            message,
        )
        return message[:900]

    def debug(self, message):
        value = str(message)
        if any(marker in value.lower() for marker in self._MARKERS):
            logger.info("yt-dlp diagnostic: %s", self._safe(value))

    def warning(self, message):
        value = str(message)
        if any(marker in value.lower() for marker in self._MARKERS):
            logger.warning("yt-dlp diagnostic: %s", self._safe(value))

    def error(self, message):
        logger.error("yt-dlp diagnostic: %s", self._safe(message))


YTDLP_DIAGNOSTICS = YtDlpDiagnosticLogger()

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
        # Verbose mode is routed through a redacting, allow-listed logger so
        # YouTube client/PO-token/JS-challenge diagnostics reach Render logs
        # without exposing signed media URLs, cookies, or request tokens.
        "verbose": True,
        "logger": YTDLP_DIAGNOSTICS,
        "noplaylist": True,
        "skip_download": True,
        "cachedir": False,
        "socket_timeout": 25,
        "retries": 2,
        "extractor_retries": 2,
        "fragment_retries": 2,
        "ignoreerrors": False,
    }
    logger.info(
        "Starting extraction: yt-dlp=%s, youtube_player_client=default",
        yt_dlp.version.__version__,
    )
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
        "youtube_player_client": "yt-dlp default (not forced)",
        "youtube_diagnostics": "redacted verbose diagnostics enabled",
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
            raw = str(exc)
            message = raw.lower()
            # Keep the actionable extractor reason, but never return full URLs/tokens.
            safe_reason = re.sub(r"https?://\S+", "[source URL]", raw)
            safe_reason = re.sub(
                r"(?i)\b(cookie|authorization|po_token|visitor_data|signature|sig|lsig|key)\s*[:=]\s*([^\s,;]+)",
                r"\1=[redacted]",
                safe_reason,
            )
            safe_reason = safe_reason.strip()[-700:] or "yt-dlp returned an empty extraction error."
            if any(term in message for term in ("private", "login", "sign in", "authentication", "cookies")):
                code, status, hint = "VIDEO_REQUIRES_LOGIN", 403, "Try a public video link that does not require an account."
            elif "429" in message or "too many requests" in message:
                code, status, hint = "SOURCE_RATE_LIMITED", 429, "The source platform is rate-limiting requests from this server. Wait before retrying and avoid repeated rapid fetches."
            elif "403" in message or "forbidden" in message:
                code, status, hint = "SOURCE_ACCESS_DENIED", 502, "The source platform refused the extractor request from this server. This may be an IP-based restriction or a platform-side challenge; it does not by itself mean the video is private. Avoid repeated retries and try again later."
            elif "failed to extract any player response" in message:
                code, status, hint = "YOUTUBE_PLAYER_RESPONSE_MISSING", 422, "YouTube did not return a usable player response to yt-dlp. This can happen because of server-IP anti-bot checks or YouTube player changes; it is not proof that the video is private. Wait and retry later, or test a different public YouTube video."
            elif any(term in message for term in ("javascript", "js runtime", "challenge", "player response", "po token")):
                code, status, hint = "PLATFORM_CHALLENGE_FAILED", 422, "The platform's anti-bot/player verification blocked extraction. Retry later or try another public video."
            elif any(term in message for term in ("not available", "unavailable", "removed", "private video")):
                code, status, hint = "VIDEO_UNAVAILABLE", 422, "Check that the video is still public and the link is correct."
            elif any(term in message for term in ("unsupported url", "no suitable extractor")):
                code, status, hint = "UNSUPPORTED_SOURCE", 400, "This URL format is not supported by the current extractor."
            elif any(term in message for term in ("timed out", "timeout", "connection", "network", "http error 5")):
                code, status, hint = "SOURCE_NETWORK_ERROR", 502, "The source platform did not respond reliably. Retry in a moment."
            else:
                code, status, hint = "EXTRACTION_FAILED", 422, "The extractor failed; use the diagnostic reason below to identify the platform-side issue."
            logger.exception("Extraction failed [%s]: %s", code, safe_reason)
            raise HTTPException(status_code=status, detail={
                "message": "Video extraction failed.",
                "code": code,
                "stage": "yt-dlp extraction",
                "cause": safe_reason,
                "hint": hint,
            })
        except Exception as exc:
            logger.exception("Unexpected extraction failure")
            cause = re.sub(r"https?://\S+", "[source URL]", str(exc))[-500:] or type(exc).__name__
            raise HTTPException(status_code=502, detail={
                "message": "The video platform could not be reached.",
                "code": "BACKEND_UNEXPECTED_ERROR",
                "stage": "backend extraction",
                "cause": f"{type(exc).__name__}: {cause}",
                "hint": "Check Render application logs using the timestamp of this request.",
            })
    finally:
        gc.collect()
        EXTRACTION_LOCK.release()
