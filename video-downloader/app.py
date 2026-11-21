from __future__ import annotations

import os
import tempfile
from pathlib import Path
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from yt_dlp import YoutubeDL

app = FastAPI(title="Authorized Public Video Downloader")

ALLOWED_HOSTS = {
    "facebook.com", "www.facebook.com", "fb.watch", "m.facebook.com",
    "youtube.com", "www.youtube.com", "youtu.be", "m.youtube.com",
    "instagram.com", "www.instagram.com", "tiktok.com", "www.tiktok.com",
}
MAX_FILE_MB = int(os.getenv("MAX_FILE_MB", "500"))
DOWNLOAD_DIR = Path(os.getenv("DOWNLOAD_DIR", "/tmp/video-downloads"))
DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)


def validate_url(url: str) -> None:
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    if parsed.scheme not in ("http", "https") or not host:
        raise HTTPException(400, "Provide a valid HTTP(S) video URL.")
    if host not in ALLOWED_HOSTS:
        raise HTTPException(400, "This source is not supported.")
    if parsed.username or parsed.password:
        raise HTTPException(400, "URLs with embedded credentials are not accepted.")


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/download")
def download(url: str = Query(..., min_length=8, max_length=2048)):
    validate_url(url)
    # No cookies, credentials, private links, DRM handling, or access-control bypass.
    workdir = Path(tempfile.mkdtemp(prefix="video-", dir=DOWNLOAD_DIR))
    outtmpl = str(workdir / "%(title).100s-%(id)s.%(ext)s")
    opts = {
        "format": "best[ext=mp4]/best",
        "outtmpl": outtmpl,
        "merge_output_format": "mp4",
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "socket_timeout": 20,
        "retries": 1,
        "max_filesize": MAX_FILE_MB * 1024 * 1024,
        "extractor_args": {},
    }
    try:
        with YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=True)
            filename = Path(ydl.prepare_filename(info))
            if not filename.exists():
                mp4 = filename.with_suffix(".mp4")
                if mp4.exists():
                    filename = mp4
            if not filename.exists():
                raise RuntimeError("Downloader did not produce a file.")
            if filename.stat().st_size > MAX_FILE_MB * 1024 * 1024:
                raise HTTPException(413, f"Video exceeds {MAX_FILE_MB} MB limit.")
            safe_name = (info.get("title") or "video").replace("/", "_").replace("\\", "_")[:80]
            return FileResponse(
                filename,
                media_type="video/mp4",
                filename=f"{safe_name}.mp4",
                background=None,
            )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(422, f"Unable to download this public video: {str(exc)[:250]}") from exc
