"use client";
export const runtime = "edge";

import * as React from "react";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import {
  Download,
  Scissors,
  ClipboardPaste,
  X,
  Link2,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  History,
  Share2,
  PlayCircle,
  Camera,
  Music2,
  FileVideo,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useAuth } from "@/components/providers/auth-provider";

/* ----------------------------------------------------------------------
 * Shared helpers
 * ------------------------------------------------------------------- */

// Present only inside the FB AutoReply Android app's WebView (see
// android/.../VideoSaverBridge.kt). In a normal browser this is
// undefined and callers fall back to a regular <a download> link.
declare global {
  interface Window {
    AndroidVideoSaver?: {
      saveFromUrl: (url: string, fileName: string) => void;
      saveFromBase64: (base64: string, fileName: string) => void;
    };
  }
}

const VIDEO_DOWNLOADER_API = process.env.NEXT_PUBLIC_VIDEO_DOWNLOADER_URL?.replace(/\/+$/, "");

function getDownloadUrl(sourceUrl: string): string {
  if (detectPlatform(sourceUrl) === "direct") return sourceUrl;
  if (!VIDEO_DOWNLOADER_API) throw new Error("Backend সেটআপ করা হয়নি। NEXT_PUBLIC_VIDEO_DOWNLOADER_URL configure করুন।");
  return `${VIDEO_DOWNLOADER_API}/download?url=${encodeURIComponent(sourceUrl)}`;
}

function isAndroidAppWebView(): boolean {
  return typeof window !== "undefined" && !!window.AndroidVideoSaver;
}

/** Saves a direct video URL. Inside the Android app this lands as a real
 * .mp4 in Movies/FBAutoReply via MediaStore; in a browser it's a normal
 * file download. */
function saveVideoFromUrl(url: string, fileName: string) {
  if (isAndroidAppWebView()) {
    window.AndroidVideoSaver!.saveFromUrl(url, fileName);
    return true;
  }
  return false;
}

/** Saves an in-browser-produced video (e.g. Clip Maker's trimmed blob) as
 * a real .mp4 in Movies/FBAutoReply when running inside the Android app. */
async function saveVideoFromBlob(blob: Blob, fileName: string) {
  if (!isAndroidAppWebView()) return false;
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
  window.AndroidVideoSaver!.saveFromBase64(base64, fileName);
  return true;
}

type Platform = "facebook" | "youtube" | "instagram" | "tiktok" | "direct" | "unknown";

function detectPlatform(url: string): Platform {
  const u = url.trim().toLowerCase();
  if (!u) return "unknown";
  if (/\.(mp4|webm|mov|m4v)(\?.*)?$/.test(u)) return "direct";
  if (/(facebook\.com|fb\.watch)/.test(u)) return "facebook";
  if (/(youtube\.com|youtu\.be)/.test(u)) return "youtube";
  if (/instagram\.com/.test(u)) return "instagram";
  if (/tiktok\.com/.test(u)) return "tiktok";
  return "unknown";
}

function isValidUrl(url: string) {
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

const PLATFORM_META: Record<Platform, { label: string; icon: React.ElementType; supported: boolean }> = {
  facebook: { label: "Facebook", icon: Share2, supported: false },
  youtube: { label: "YouTube", icon: PlayCircle, supported: false },
  instagram: { label: "Instagram", icon: Camera, supported: false },
  tiktok: { label: "TikTok", icon: Music2, supported: false },
  direct: { label: "Direct Video File", icon: FileVideo, supported: true },
  unknown: { label: "অজানা লিংক", icon: Link2, supported: false },
};

type HistoryItem = {
  id: string;
  name: string;
  platform: Platform;
  status: "ready" | "unsupported" | "error";
  at: number;
};

const SAVER_HISTORY_KEY = "video-saver:history";
const CLIP_HISTORY_KEY = "video-saver:clip-history";

function loadHistory(key: string): HistoryItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as HistoryItem[]) : [];
  } catch {
    return [];
  }
}

function pushHistory(key: string, item: HistoryItem) {
  const current = loadHistory(key);
  const next = [item, ...current].slice(0, 25);
  window.localStorage.setItem(key, JSON.stringify(next));
  return next;
}

/* ----------------------------------------------------------------------
 * Tabs shell
 * ------------------------------------------------------------------- */

type Tab = "saver" | "cutter";

export default function VideoSaverPage() {
  const { profile } = useAuth();
  const [tab, setTab] = React.useState<Tab>("saver");

  if (profile?.role !== "super_admin") {
    return (
      <div className="text-[13px] px-3.5 py-3 rounded-xl bg-destructive/10 text-destructive border border-destructive/20">
        এই ফিচার শুধুমাত্র অ্যাডমিনদের জন্য উপলব্ধ।
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-lg font-bold tracking-tight mb-1">Video Saver</h1>
      <p className="text-[13px] text-muted-foreground mb-4">
        সরাসরি ভিডিও ফাইল ডাউনলোড করুন অথবা নিজের ভিডিও থেকে ক্লিপ তৈরি করুন।
      </p>

      <div className="flex gap-2 mb-4 bg-muted rounded-xl p-1">
        <button
          onClick={() => setTab("saver")}
          className={`flex-1 h-9 rounded-lg text-[13px] font-semibold flex items-center justify-center gap-1.5 transition-all ${
            tab === "saver" ? "bg-card shadow-sm text-foreground" : "text-muted-foreground"
          }`}
        >
          <Download size={15} /> ভিডিও সেভার
        </button>
        <button
          onClick={() => setTab("cutter")}
          className={`flex-1 h-9 rounded-lg text-[13px] font-semibold flex items-center justify-center gap-1.5 transition-all ${
            tab === "cutter" ? "bg-card shadow-sm text-foreground" : "text-muted-foreground"
          }`}
        >
          <Scissors size={15} /> ভিডিও কাটার
        </button>
      </div>

      {tab === "saver" ? <SaverTab /> : <CutterTab />}
    </div>
  );
}

/* ----------------------------------------------------------------------
 * Tab 1: Video Saver (URL paste → validate → platform detect → download)
 * ------------------------------------------------------------------- */

type DownloaderMedia = {
  quality?: string;
  type: string;
  extension: string;
  data_size?: number;
  url: string;
};

type DownloaderResult = {
  title?: string;
  author?: string;
  thumbnail?: string;
  medias?: DownloaderMedia[];
};

function formatQuality(q?: string) {
  if (!q) return "Standard";
  return q
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function formatFileSize(bytes?: number) {
  if (!bytes) return "Unknown Size";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function getYouTubeId(url: string) {
  const m = url.match(/^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/);
  return m && m[2].length === 11 ? m[2] : null;
}

async function forceDownload(url: string, filename: string) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  } catch {
    window.open(url, "_blank");
  }
}

function SaverTab() {
  const [url, setUrl] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState("");
  const [result, setResult] = React.useState<DownloaderResult | null>(null);
  const [downloadingIdx, setDownloadingIdx] = React.useState<number | null>(null);
  const [thumbQuality, setThumbQuality] = React.useState("maxresdefault");
  const [history, setHistory] = React.useState<HistoryItem[]>([]);

  React.useEffect(() => {
    setHistory(loadHistory(SAVER_HISTORY_KEY));
  }, []);

  function clearHistory() {
    window.localStorage.removeItem(SAVER_HISTORY_KEY);
    setHistory([]);
  }

  async function handleFetch() {
    const trimmed = url.trim();
    if (!isValidUrl(trimmed)) {
      setErrorMsg("সঠিক ভিডিও URL দিন।");
      return;
    }
    setErrorMsg("");
    setResult(null);
    setLoading(true);
    try {
      const res = await fetch("/api/video-downloader", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed }),
      });
      if (!res.ok) throw new Error("Network response was not ok");
      const data = await res.json();
      if (data.error) throw new Error(data.message || "Failed to fetch video");
      setResult(data);
      const h = pushHistory(SAVER_HISTORY_KEY, {
        id: crypto.randomUUID(),
        name: data.title || trimmed,
        platform: detectPlatform(trimmed),
        status: "ready",
        at: Date.now(),
      });
      setHistory(h);
    } catch (e) {
      setErrorMsg(
        "ভিডিও ফেচ করা যায়নি — " + (e instanceof Error ? e.message : "অজানা সমস্যা হয়েছে।")
      );
      const h = pushHistory(SAVER_HISTORY_KEY, {
        id: crypto.randomUUID(),
        name: trimmed,
        platform: detectPlatform(trimmed),
        status: "error",
        at: Date.now(),
      });
      setHistory(h);
    } finally {
      setLoading(false);
    }
  }

  async function handleMediaDownload(media: DownloaderMedia, idx: number) {
    setDownloadingIdx(idx);
    try {
      await forceDownload(media.url, `${result?.title || "video"}.${media.extension}`);
    } finally {
      setDownloadingIdx(null);
    }
  }

  const ytId = getYouTubeId(url.trim());

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>All-in-One Video Downloader</CardTitle>
          <CardDescription>
            Facebook, YouTube, Instagram, TikTok সহ supported public video link পেস্ট করে ভিডিও ডাউনলোড করুন।
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleFetch()}
              placeholder="ভিডিও লিংক পেস্ট করুন..."
              className="flex-1"
            />
            <Button type="button" onClick={handleFetch} disabled={loading}>
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
              Fetch
            </Button>
          </div>

          {errorMsg && (
            <div className="flex items-start gap-2 text-[13px] text-destructive bg-destructive/10 border border-destructive/20 rounded-xl px-3.5 py-3">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader>
            <CardTitle className="truncate">{result.title || "Video Found"}</CardTitle>
            {result.author && <CardDescription>By {result.author}</CardDescription>}
          </CardHeader>
          <CardContent className="space-y-4">
            {result.thumbnail && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={result.thumbnail}
                alt="Thumbnail"
                className="w-full rounded-xl border border-border max-h-[260px] object-cover"
              />
            )}

            {ytId && (
              <div className="flex gap-2">
                <select
                  value={thumbQuality}
                  onChange={(e) => setThumbQuality(e.target.value)}
                  className="flex-1 h-9 rounded-lg border border-border bg-background text-[13px] px-2.5"
                >
                  <option value="maxresdefault">Maximum Quality</option>
                  <option value="sddefault">Standard Quality</option>
                  <option value="hqdefault">High Quality</option>
                  <option value="mqdefault">Medium Quality</option>
                  <option value="default">Default Quality</option>
                </select>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() =>
                    forceDownload(
                      `https://img.youtube.com/vi/${ytId}/${thumbQuality}.jpg`,
                      `youtube_thumbnail_${ytId}.jpg`
                    )
                  }
                >
                  থাম্বনেইল
                </Button>
              </div>
            )}

            <div className="space-y-2">
              {result.medias && result.medias.length > 0 ? (
                result.medias.map((media, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between gap-2.5 border border-border rounded-xl px-3.5 py-2.5"
                  >
                    <div className="min-w-0">
                      <div className="text-[13px] font-semibold truncate">{formatQuality(media.quality)}</div>
                      <div className="text-xs text-muted-foreground">
                        {media.type.toUpperCase()} • {media.extension.toUpperCase()} • {formatFileSize(media.data_size)}
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => handleMediaDownload(media, idx)}
                      disabled={downloadingIdx === idx}
                    >
                      {downloadingIdx === idx ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Download size={14} />
                      )}
                      Download
                    </Button>
                  </div>
                ))
              ) : (
                <p className="text-[13px] text-muted-foreground text-center py-3">
                  এই লিংকের জন্য কোনো ডাউনলোড অপশন পাওয়া যায়নি।
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex-row items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <History size={16} className="text-muted-foreground" />
            <CardTitle>Download History</CardTitle>
          </div>
          {history.length > 0 && (
            <Button type="button" variant="ghost" size="sm" onClick={clearHistory}>
              <Trash2 size={14} /> মুছুন
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">এখনো কোনো ভিডিও ফেচ করা হয়নি।</p>
          ) : (
            <ul className="space-y-2">
              {history.map((h) => {
                const meta = PLATFORM_META[h.platform];
                const Icon = meta.icon;
                return (
                  <li
                    key={h.id}
                    className="flex items-center gap-2.5 text-[13px] border-b border-border-soft last:border-0 pb-2 last:pb-0"
                  >
                    <Icon size={14} className="text-muted-foreground shrink-0" />
                    <span className="truncate flex-1">{h.name}</span>
                    <span
                      className={`text-xs font-semibold shrink-0 ${
                        h.status === "error" ? "text-destructive" : "text-success"
                      }`}
                    >
                      {h.status === "error" ? "Failed" : "Fetched"}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ----------------------------------------------------------------------
 * Tab 2: Clip Maker (ffmpeg.wasm, browser-side trim)
 * ------------------------------------------------------------------- */

function toSeconds(hms: string): number | null {
  const m = hms.trim().match(/^(\d{1,2}):([0-5]\d):([0-5]\d)$/);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

function toHMS(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map((v) => String(v).padStart(2, "0")).join(":");
}

const MAX_CLIP_SOURCE_MB = 300; // soft warning threshold for in-browser processing

function CutterTab() {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const ffmpegRef = React.useRef<import("@ffmpeg/ffmpeg").FFmpeg | null>(null);

  const [sourceUrl, setSourceUrl] = React.useState<string | null>(null);
  const [sourceFile, setSourceFile] = React.useState<File | null>(null);
  const [remoteUrl, setRemoteUrl] = React.useState("");
  const [duration, setDuration] = React.useState(0);
  const [start, setStart] = React.useState("00:00:00");
  const [end, setEnd] = React.useState("00:00:00");

  const [loadingCore, setLoadingCore] = React.useState(false);
  const [processing, setProcessing] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [cancelRequested, setCancelRequested] = React.useState(false);
  const [resultUrl, setResultUrl] = React.useState<string | null>(null);
  const [resultBlob, setResultBlob] = React.useState<Blob | null>(null);
  const [errorMsg, setErrorMsg] = React.useState("");
  const [sizeWarning, setSizeWarning] = React.useState("");
  const [history, setHistory] = React.useState<HistoryItem[]>([]);

  React.useEffect(() => {
    setHistory(loadHistory(CLIP_HISTORY_KEY));
  }, []);

  function resetForNewSource() {
    setDuration(0);
    setStart("00:00:00");
    setEnd("00:00:00");
    setResultUrl(null);
    setResultBlob(null);
    setErrorMsg("");
    setProgress(0);
  }

  function handleFile(file: File) {
    if (file.size > MAX_CLIP_SOURCE_MB * 1024 * 1024) {
      setSizeWarning(
        `ফাইলটি ${(file.size / 1024 / 1024).toFixed(0)}MB — বড় ফাইল ব্রাউজারে প্রসেস করলে মেমরি কম থাকা ডিভাইসে (বিশেষত মোবাইলে) ক্র্যাশ করতে পারে। সম্ভব হলে ছোট অংশ ব্যবহার করুন।`
      );
    } else {
      setSizeWarning("");
    }
    setSourceFile(file);
    setRemoteUrl("");
    const url = URL.createObjectURL(file);
    setSourceUrl(url);
    resetForNewSource();
  }

  async function handleLoadRemote() {
    if (!isValidUrl(remoteUrl)) {
      setErrorMsg("সঠিক ভিডিও URL দিন।");
      return;
    }
    const platform = detectPlatform(remoteUrl);
    if (!["direct", "facebook", "youtube", "instagram", "tiktok"].includes(platform)) {
      setErrorMsg("এই লিংকটি supported নয়। Facebook, YouTube, Instagram, TikTok অথবা direct MP4 URL দিন।");
      return;
    }
    setErrorMsg("");
    setSourceFile(null);
    resetForNewSource();
    setSourceUrl(platform === "direct"
      ? remoteUrl.trim()
      : `/api/video-downloader/media?url=${encodeURIComponent(remoteUrl.trim())}`);
  }

  function onLoadedMetadata() {
    const v = videoRef.current;
    if (!v) return;
    const d = v.duration || 0;
    setDuration(d);
    setStart("00:00:00");
    setEnd(toHMS(d));
  }

  async function ensureFfmpegLoaded() {
    if (ffmpegRef.current) return ffmpegRef.current;
    setLoadingCore(true);
    try {
      const ffmpeg = new FFmpeg();
      ffmpeg.on("progress", ({ progress: p }) => {
        setProgress(Math.min(100, Math.round(p * 100)));
      });
      const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm";
      // Keep FFmpeg's own worker outside the Next.js/Turbopack bundle.
      // The postinstall script copies the package worker to /public/ffmpeg/worker.js.
      const classWorkerURL = new URL("/ffmpeg/worker.js", window.location.href).href;
      await ffmpeg.load({
        classWorkerURL,
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
      });
      ffmpegRef.current = ffmpeg;
      return ffmpeg;
    } finally {
      setLoadingCore(false);
    }
  }

  async function handleCutAndSave() {
    setErrorMsg("");
    setResultUrl(null);
    setResultBlob(null);
    const startSec = toSeconds(start);
    const endSec = toSeconds(end);
    if (startSec === null || endSec === null) {
      setErrorMsg("সময় অবশ্যই HH:MM:SS ফরম্যাটে দিতে হবে।");
      return;
    }
    if (endSec <= startSec) {
      setErrorMsg("End time অবশ্যই Start time-এর পরে হতে হবে।");
      return;
    }
    if (duration && endSec > Math.ceil(duration)) {
      setErrorMsg("End time ভিডিওর দৈর্ঘ্যের বেশি হতে পারবে না।");
      return;
    }
    if (!sourceUrl) {
      setErrorMsg("আগে একটি ভিডিও আপলোড বা লোড করুন।");
      return;
    }

    setCancelRequested(false);
    setProcessing(true);
    setProgress(0);
    try {
      const ffmpeg = await ensureFfmpegLoaded();
      if (cancelRequested) return;

      const inputName = "input" + (sourceFile ? guessExt(sourceFile.name) : guessExt(sourceUrl));
      const outputName = "output.mp4";

      await ffmpeg.writeFile(inputName, await fetchFile(sourceFile ?? sourceUrl));
      if (cancelRequested) return;

      // Re-encode to a broadly compatible MP4. Stream-copy can fail on
      // social-platform sources with unusual containers/codecs or cut points.
      const clipDuration = Math.max(0.1, endSec - startSec);
      await ffmpeg.exec([
        "-i", inputName,
        "-ss", String(startSec),
        "-t", String(clipDuration),
        "-map", "0:v:0",
        "-map", "0:a?",
        "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-crf", "28",
        "-c:a", "aac",
        "-b:a", "128k",
        "-movflags", "+faststart",
        "-f", "mp4",
        outputName,
      ]);
      if (cancelRequested) return;

      const data = await ffmpeg.readFile(outputName);
      const bytes = data as Uint8Array;
      const blob = new Blob([new Uint8Array(bytes).buffer], { type: "video/mp4" });
      const url = URL.createObjectURL(blob);
      setResultUrl(url);
      setResultBlob(blob);

      const clipName = `clip-${start.replace(/:/g, "")}-${end.replace(/:/g, "")}.mp4`;
      const h = pushHistory(CLIP_HISTORY_KEY, {
        id: crypto.randomUUID(),
        name: clipName,
        platform: "direct",
        status: "ready",
        at: Date.now(),
      });
      setHistory(h);
    } catch (e) {
      if (!cancelRequested) {
        setErrorMsg(
          "ক্লিপ তৈরি করা যায়নি — ফাইল ফরম্যাট/কোডেক সাপোর্টেড নাও হতে পারে, অথবা ডিভাইসে পর্যাপ্ত মেমরি নেই। (" +
            (e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e) || "unknown error") +
            ")"
        );
      }
    } finally {
      setProcessing(false);
    }
  }

  function handleCancel() {
    setCancelRequested(true);
    setProcessing(false);
    setProgress(0);
    // ffmpeg.wasm has no clean mid-exec abort in the single-thread core;
    // terminating the instance is the reliable way to stop work in progress.
    try {
      ffmpegRef.current?.terminate();
    } catch {
      /* no-op */
    }
    ffmpegRef.current = null;
    setErrorMsg("প্রসেসিং বাতিল করা হয়েছে।");
  }

  function clearHistory() {
    window.localStorage.removeItem(CLIP_HISTORY_KEY);
    setHistory([]);
  }

  const startPct = duration ? (Math.min(toSeconds(start) ?? 0, duration) / duration) * 100 : 0;
  const endPct = duration ? (Math.min(toSeconds(end) ?? duration, duration) / duration) * 100 : 100;
  const clipSeconds = (toSeconds(end) ?? 0) - (toSeconds(start) ?? 0);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>ভিডিও লোড করুন</CardTitle>
          <CardDescription>ভিডিও ফাইল আপলোড করুন অথবা Facebook/YouTube/Instagram/TikTok/direct video link দিন</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label>ফাইল আপলোড</Label>
            <input
              type="file"
              accept="video/*"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              className="block w-full text-[13px] mt-1.5 file:mr-3 file:h-9 file:rounded-lg file:border-0 file:bg-secondary file:text-secondary-foreground file:px-3.5 file:text-[13px] file:font-semibold"
            />
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <div className="h-px bg-border flex-1" /> অথবা <div className="h-px bg-border flex-1" />
          </div>

          <div className="flex gap-2">
            <Input
              value={remoteUrl}
              onChange={(e) => setRemoteUrl(e.target.value)}
              placeholder="Facebook / YouTube / MP4 ভিডিও লিংক..."
              className="flex-1"
            />
            <Button type="button" variant="secondary" onClick={handleLoadRemote}>
              লোড করুন
            </Button>
          </div>

          {sizeWarning && (
            <div className="flex items-start gap-2 text-[13px] text-warning bg-warning/10 border border-warning/20 rounded-xl px-3.5 py-3">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>{sizeWarning}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {sourceUrl && (
        <Card>
          <CardHeader>
            <CardTitle>প্রিভিউ ও টাইমলাইন</CardTitle>
            {duration > 0 && <CardDescription>মোট দৈর্ঘ্য: {toHMS(duration)}</CardDescription>}
          </CardHeader>
          <CardContent className="space-y-4">
            <video
              ref={videoRef}
              src={sourceUrl}
              controls
              onLoadedMetadata={onLoadedMetadata}
              className="w-full rounded-xl border border-border bg-black max-h-[320px]"
            />

            {duration > 0 && (
              <div>
                <div className="relative h-2 rounded-full bg-muted mb-3">
                  <div
                    className="absolute h-2 rounded-full bg-primary"
                    style={{ left: `${startPct}%`, width: `${Math.max(0, endPct - startPct)}%` }}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Start Time (HH:MM:SS)</Label>
                    <Input value={start} onChange={(e) => setStart(e.target.value)} placeholder="00:05:00" />
                    <input
                      type="range"
                      min={0}
                      max={Math.floor(duration)}
                      value={toSeconds(start) ?? 0}
                      onChange={(e) => setStart(toHMS(Number(e.target.value)))}
                      className="w-full mt-2"
                    />
                  </div>
                  <div>
                    <Label>End Time (HH:MM:SS)</Label>
                    <Input value={end} onChange={(e) => setEnd(e.target.value)} placeholder="00:10:00" />
                    <input
                      type="range"
                      min={0}
                      max={Math.floor(duration)}
                      value={toSeconds(end) ?? Math.floor(duration)}
                      onChange={(e) => setEnd(toHMS(Number(e.target.value)))}
                      className="w-full mt-2"
                    />
                  </div>
                </div>
                <p className="text-[13px] text-muted-foreground mt-2">
                  সিলেক্টেড ক্লিপ দৈর্ঘ্য: <span className="font-semibold text-foreground">{clipSeconds > 0 ? toHMS(clipSeconds) : "00:00:00"}</span>
                </p>
              </div>
            )}

            {!processing ? (
              <Button type="button" className="w-full" onClick={handleCutAndSave} disabled={!duration}>
                <Scissors size={16} /> Cut &amp; Save
              </Button>
            ) : (
              <div className="space-y-2">
                <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                  <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
                </div>
                <div className="flex items-center justify-between text-[13px] text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <Loader2 size={14} className="animate-spin" />
                    {loadingCore ? "প্রসেসিং ইঞ্জিন লোড হচ্ছে..." : `প্রসেস হচ্ছে... ${progress}%`}
                  </span>
                  <Button type="button" variant="ghost" size="sm" onClick={handleCancel}>
                    বাতিল করুন
                  </Button>
                </div>
              </div>
            )}

            {errorMsg && (
              <div className="flex items-start gap-2 text-[13px] text-destructive bg-destructive/10 border border-destructive/20 rounded-xl px-3.5 py-3">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {resultUrl && (
              <div className="space-y-2">
                <video src={resultUrl} controls className="w-full rounded-xl border border-border bg-black max-h-[260px]" />
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full"
                  onClick={async () => {
                    const fileName = `clip-${start.replace(/:/g, "")}-${end.replace(/:/g, "")}.mp4`;
                    const savedNatively = resultBlob ? await saveVideoFromBlob(resultBlob, fileName) : false;
                    if (!savedNatively) {
                      const a = document.createElement("a");
                      a.href = resultUrl;
                      a.download = fileName;
                      a.click();
                    }
                  }}
                >
                  <Download size={16} /> ক্লিপ ডাউনলোড করুন
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex-row items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <History size={16} className="text-muted-foreground" />
            <CardTitle>Clip History</CardTitle>
          </div>
          {history.length > 0 && (
            <Button type="button" variant="ghost" size="sm" onClick={clearHistory}>
              <Trash2 size={14} /> মুছুন
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">এখনো কোনো ক্লিপ তৈরি হয়নি।</p>
          ) : (
            <ul className="space-y-2">
              {history.map((h) => (
                <li key={h.id} className="flex items-center gap-2.5 text-[13px] border-b border-border-soft last:border-0 pb-2 last:pb-0">
                  <FileVideo size={14} className="text-muted-foreground shrink-0" />
                  <span className="truncate flex-1">{h.name}</span>
                  <span className="text-success text-xs font-semibold shrink-0">Clip created</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">
        নোট: এই হিস্টোরি শুধু নামের তালিকা রাখে (ব্রাউজারের LocalStorage-এ) — ভিডিও ফাইল ব্রাউজার বন্ধ করলে মুছে যায়,
        তাই ডাউনলোড করে সরাসরি ফোনে সেভ করে রাখুন।
      </p>
    </div>
  );
}

function guessExt(nameOrUrl: string) {
  const m = nameOrUrl.toLowerCase().match(/\.(mp4|webm|mov|m4v|mkv)(\?.*)?$/);
  return m ? `.${m[1]}` : ".mp4";
}
