#!/usr/bin/env python3
"""
extract_post.py — URL → JSON with caption, creator, hashtags, transcript.

Usage:
    python3 extract_post.py <url> [--out-dir /tmp/tech-radar] [--no-transcribe]

Design goals:
- Graceful degradation. TikTok/IG sometimes block sandbox IPs; the script
  should still return whatever it could extract (URL + platform at minimum)
  rather than crash.
- Single source of truth for the schema: the JSON keys below are what the
  research agent and the INBOX writer both depend on.
- Best-effort transcription with faster-whisper. Skipped automatically when
  no audio was downloaded or when faster-whisper isn't installed.

JSON schema:
{
  "url": str,
  "platform": "tiktok" | "instagram" | "youtube" | "other",
  "status": "ok" | "partial" | "failed",
  "error": str | null,
  "title": str | null,
  "creator": str | null,
  "caption": str | null,
  "hashtags": [str],
  "duration_sec": int | null,
  "transcript": str | null,
  "transcript_source": "whisper" | "subs" | null,
  "visual_text": str | null,
  "visual_text_source": "ocr" | null,
  "upload_date": str | null,
  "raw_metadata_keys": [str]
}
"""
from __future__ import annotations

import argparse
import html
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlparse, quote

# stdlib only on purpose — the fallback has to work even when pip is useless.
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError


# --- Platform detection ------------------------------------------------------

def detect_platform(url: str) -> str:
    host = (urlparse(url).netloc or "").lower()
    if "tiktok.com" in host:
        return "tiktok"
    if "instagram.com" in host:
        return "instagram"
    if "youtube.com" in host or "youtu.be" in host:
        return "youtube"
    return "other"


# --- Hashtag extraction ------------------------------------------------------

HASHTAG_RE = re.compile(r"#(\w[\w-]{0,49})")


def pull_hashtags(text: str | None) -> list[str]:
    if not text:
        return []
    seen = []
    for m in HASHTAG_RE.findall(text):
        tag = m.lower()
        if tag not in seen:
            seen.append(tag)
    return seen


# --- oEmbed / HTML fallback --------------------------------------------------

OEMBED_ENDPOINTS = {
    "tiktok":    "https://www.tiktok.com/oembed?url={url}",
    "instagram": "https://graph.facebook.com/v17.0/instagram_oembed?url={url}&access_token=",
    "youtube":   "https://www.youtube.com/oembed?url={url}&format=json",
}

_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15"


def _http_get(url: str, timeout: int = 10) -> str | None:
    try:
        req = Request(url, headers={"User-Agent": _UA, "Accept": "application/json,text/html;q=0.9,*/*;q=0.5"})
        with urlopen(req, timeout=timeout) as r:
            return r.read().decode("utf-8", errors="replace")
    except (URLError, HTTPError, TimeoutError, OSError):
        return None


def try_oembed(url: str, platform: str) -> dict | None:
    endpoint = OEMBED_ENDPOINTS.get(platform)
    if not endpoint:
        return None
    body = _http_get(endpoint.format(url=quote(url, safe=":/?&=@")))
    if not body:
        return None
    try:
        return json.loads(body)
    except json.JSONDecodeError:
        return None


META_RE = re.compile(
    r'<meta[^>]+(?:property|name)=["\'](?P<prop>og:title|og:description|og:image|twitter:title|twitter:description|description)["\'][^>]+content=["\'](?P<val>[^"\']+)["\']',
    re.IGNORECASE,
)


def try_html_meta(url: str) -> dict | None:
    body = _http_get(url, timeout=12)
    if not body:
        return None
    meta: dict[str, str] = {}
    for m in META_RE.finditer(body):
        meta.setdefault(m.group("prop").lower(), m.group("val"))
    return meta or None


# --- yt-dlp extraction -------------------------------------------------------

def run_ytdlp(url: str, out_dir: Path, want_audio: bool, want_video: bool) -> tuple[dict | None, Path | None, Path | None, str | None]:
    """Return (info_dict, audio_path, video_path, error). Any of those may be None."""
    try:
        import yt_dlp  # type: ignore
    except ImportError as e:
        return None, None, None, f"yt-dlp not installed: {e}"

    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "skip_download": not (want_audio or want_video),
        "outtmpl": str(out_dir / "%(id)s.%(ext)s"),
        "format": "best[height<=720]/best" if want_video else "bestaudio/best",
        "keepvideo": want_video,
        "postprocessors": [] if (not want_audio or want_video) else [
            {"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "64"},
        ],
        "extractor_args": {},
    }

    audio_path: Path | None = None
    video_path: Path | None = None
    info: dict | None = None
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=want_audio or want_video)
            if (want_audio or want_video) and info:
                base = Path(ydl.prepare_filename(info))
                if want_video:
                    candidates = [
                        base,
                        base.with_suffix(".mp4"),
                        base.with_suffix(".webm"),
                        base.with_suffix(".mkv"),
                        base.with_suffix(".mov"),
                    ]
                    video_path = next((p for p in candidates if p.exists()), None)
                    if want_audio and video_path:
                        audio_path = video_path
                mp3 = base.with_suffix(".mp3")
                if mp3.exists():
                    audio_path = mp3
                elif not audio_path and base.exists():
                    audio_path = base
        return info, audio_path, video_path, None
    except Exception as e:
        return info, audio_path, video_path, f"yt-dlp error: {e.__class__.__name__}: {e}"


# --- Whisper transcription ---------------------------------------------------

def transcribe(audio_path: Path) -> tuple[str | None, str | None]:
    """Return (transcript, error). Uses faster-whisper with the model from WHISPER_MODEL env var (default: 'tiny')."""
    try:
        from faster_whisper import WhisperModel  # type: ignore
    except ImportError as e:
        return None, f"faster-whisper not installed: {e}"
    try:
        whisper_model = os.environ.get("WHISPER_MODEL", "tiny")
        model = WhisperModel(whisper_model, device="cpu", compute_type="int8")
        segments, _info = model.transcribe(str(audio_path), language=None, vad_filter=True)
        text = " ".join(seg.text.strip() for seg in segments).strip()
        return text or None, None
    except Exception as e:
        return None, f"whisper error: {e.__class__.__name__}: {e}"


# --- On-screen text OCR ------------------------------------------------------

IMAGE_EXTENSIONS = {"jpg", "jpeg", "png", "webp", "avif"}

def _int_env(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.environ.get(name, str(default)))
    except ValueError:
        return default
    return max(minimum, min(maximum, value))


def _float_env(name: str, default: float, minimum: float, maximum: float) -> float:
    try:
        value = float(os.environ.get(name, str(default)))
    except ValueError:
        return default
    return max(minimum, min(maximum, value))


def clean_ocr_line(line: str) -> str:
    return re.sub(r"\s+", " ", line).strip()


def merge_text_blocks(blocks: list[str | None]) -> str:
    seen: set[str] = set()
    lines: list[str] = []
    for block in blocks:
        if not block:
            continue
        for line in block.splitlines():
            clean = clean_ocr_line(line)
            if len(clean) < 3:
                continue
            key = clean.lower()
            if key in seen:
                continue
            seen.add(key)
            lines.append(clean)
    return "\n".join(lines).strip()


def collect_image_urls(info: dict | None, meta: dict | None = None) -> list[str]:
    urls: list[str] = []
    seen: set[str] = set()

    def add(value: object) -> None:
        if not isinstance(value, str) or not value.startswith("http"):
            return
        clean = html.unescape(value).rstrip("),.;")
        if clean in seen:
            return
        lowered = clean.split("?", 1)[0].rsplit(".", 1)[-1].lower()
        if lowered not in IMAGE_EXTENSIONS:
            return
        seen.add(clean)
        urls.append(clean)

    def walk(node: object) -> None:
        if isinstance(node, list):
            for item in node:
                walk(item)
            return
        if not isinstance(node, dict):
            return
        add(node.get("thumbnail"))
        add(node.get("display_url"))
        ext = str(node.get("ext") or "").lower()
        if ext in IMAGE_EXTENSIONS:
            add(node.get("url"))
        for thumb in node.get("thumbnails") or []:
            if isinstance(thumb, dict):
                add(thumb.get("url"))
        walk(node.get("entries") or [])
        walk(node.get("requested_downloads") or [])

    walk(info or {})
    if meta:
        add(meta.get("og:image") or meta.get("twitter:image"))
    return urls


def download_image_assets(urls: list[str], out_dir: Path) -> tuple[list[Path], list[dict], list[str]]:
    max_images = _int_env("OCR_MAX_IMAGES", 8, 1, 20)
    images_dir = out_dir / "ocr-images"
    images_dir.mkdir(parents=True, exist_ok=True)
    paths: list[Path] = []
    assets: list[dict] = []
    warnings: list[str] = []

    for index, url in enumerate(urls[:max_images], start=1):
        ext = url.split("?", 1)[0].rsplit(".", 1)[-1].lower()
        if ext not in IMAGE_EXTENSIONS:
            ext = "jpg"
        path = images_dir / f"image-{index:03d}.{ext}"
        body = _http_get_bytes(url, timeout=15)
        if body is None:
            warnings.append(f"image download failed: {url}")
            continue
        try:
            path.write_bytes(body)
        except OSError as e:
            warnings.append(f"image write failed: {e}")
            continue
        paths.append(path)
        assets.append({
            "type": "image",
            "source": "metadata",
            "url": url,
            "path": str(path),
            "ocr_text": None,
            "confidence": "medium",
        })

    return paths, assets, warnings


def _http_get_bytes(url: str, timeout: int = 10) -> bytes | None:
    try:
        req = Request(url, headers={"User-Agent": _UA, "Accept": "image/avif,image/webp,image/png,image/jpeg,*/*;q=0.5"})
        with urlopen(req, timeout=timeout) as r:
            return r.read()
    except (URLError, HTTPError, TimeoutError, OSError):
        return None


def extract_image_text(image_paths: list[Path]) -> tuple[str | None, str | None]:
    if not shutil.which("tesseract"):
        return None, "ocr skipped: tesseract not installed"
    blocks: list[str] = []
    for image_path in image_paths:
        if not image_path.exists():
            continue
        try:
            result = subprocess.run(
                ["tesseract", str(image_path), "stdout", "--psm", "6"],
                check=False,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                text=True,
            )
        except Exception:
            continue
        blocks.append(result.stdout)
    text = merge_text_blocks(blocks)
    return text or None, None


def extract_visual_text(video_path: Path, out_dir: Path) -> tuple[str | None, str | None]:
    """Sample a few video frames and OCR visible text with tesseract."""
    if not shutil.which("ffmpeg"):
        return None, "ocr skipped: ffmpeg not installed"
    if not shutil.which("tesseract"):
        return None, "ocr skipped: tesseract not installed"
    if not video_path.exists():
        return None, "ocr skipped: video file missing"

    max_frames = _int_env("OCR_MAX_FRAMES", 6, 1, 20)
    interval = _float_env("OCR_FRAME_INTERVAL_SEC", 2.0, 0.5, 10.0)
    frames_dir = out_dir / "ocr-frames"
    frames_dir.mkdir(parents=True, exist_ok=True)

    try:
        subprocess.run(
            [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                str(video_path),
                "-vf",
                f"fps=1/{interval},scale=960:-1",
                "-frames:v",
                str(max_frames),
                str(frames_dir / "frame-%03d.png"),
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
        )
    except Exception as e:
        return None, f"ocr frame extraction error: {e.__class__.__name__}: {e}"

    blocks: list[str] = []
    for frame in sorted(frames_dir.glob("frame-*.png")):
        try:
            result = subprocess.run(
                ["tesseract", str(frame), "stdout", "--psm", "6"],
                check=False,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                text=True,
            )
        except Exception:
            continue
        blocks.append(result.stdout)

    text = merge_text_blocks(blocks)
    return text or None, None


# --- Main --------------------------------------------------------------------

def extract(url: str, out_dir: Path, do_transcribe: bool, do_ocr: bool) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    platform = detect_platform(url)

    result: dict = {
        "url": url,
        "platform": platform,
        "status": "failed",
        "error": None,
        "title": None,
        "creator": None,
        "caption": None,
        "hashtags": [],
        "duration_sec": None,
        "transcript": None,
        "transcript_source": None,
        "visual_text": None,
        "visual_text_source": None,
        "upload_date": None,
        "raw_metadata_keys": [],
        "media_assets": [],
        "extraction_warnings": [],
    }

    info, audio_path, video_path, yt_err = run_ytdlp(
        url,
        out_dir,
        want_audio=do_transcribe,
        want_video=do_ocr,
    )
    errors: list[str] = []
    if yt_err:
        errors.append(yt_err)

    html_meta: dict | None = None

    if info:
        result["raw_metadata_keys"] = sorted(info.keys())
        result["title"] = info.get("title") or info.get("fulltitle")
        result["creator"] = info.get("uploader") or info.get("channel") or info.get("uploader_id")
        caption = info.get("description") or info.get("title")
        result["caption"] = caption
        result["hashtags"] = pull_hashtags(caption)
        result["duration_sec"] = info.get("duration")
        result["upload_date"] = info.get("upload_date")

    if not result["caption"] and not result["title"]:
        oembed = try_oembed(url, platform)
        if oembed:
            result["title"] = result["title"] or oembed.get("title")
            result["creator"] = result["creator"] or oembed.get("author_name")
            result["caption"] = result["caption"] or oembed.get("title")
            result["hashtags"] = result["hashtags"] or pull_hashtags(oembed.get("title"))
        html_meta = try_html_meta(url)
        if html_meta:
            result["title"] = result["title"] or html_meta.get("og:title") or html_meta.get("twitter:title")
            cap = html_meta.get("og:description") or html_meta.get("twitter:description") or html_meta.get("description")
            if cap and not result["caption"]:
                result["caption"] = cap
                result["hashtags"] = result["hashtags"] or pull_hashtags(cap)

    if do_transcribe and audio_path and audio_path.exists():
        transcript, w_err = transcribe(audio_path)
        if transcript:
            result["transcript"] = transcript
            result["transcript_source"] = "whisper"
        elif w_err:
            errors.append(w_err)

    visual_blocks: list[str] = []
    if do_ocr and video_path and video_path.exists():
        visual_text, ocr_err = extract_visual_text(video_path, out_dir)
        if visual_text:
            visual_blocks.append(visual_text)
            result["media_assets"].append({
                "type": "video",
                "source": "yt-dlp",
                "path": str(video_path),
                "url": None,
                "ocr_text": visual_text,
                "confidence": "medium",
            })
        elif ocr_err:
            errors.append(ocr_err)

    if do_ocr:
        image_urls = collect_image_urls(info, html_meta)
        image_paths, image_assets, image_warnings = download_image_assets(image_urls, out_dir)
        result["media_assets"].extend(image_assets)
        errors.extend(image_warnings)
        if image_paths:
            image_text, image_ocr_err = extract_image_text(image_paths)
            if image_text:
                visual_blocks.append(image_text)
                for asset in result["media_assets"]:
                    if asset.get("type") == "image" and not asset.get("ocr_text"):
                        asset["ocr_text"] = image_text
            elif image_ocr_err:
                errors.append(image_ocr_err)

    merged_visual_text = merge_text_blocks(visual_blocks)
    if merged_visual_text:
        result["visual_text"] = merged_visual_text
        result["visual_text_source"] = "ocr"

    if result["caption"] or result["transcript"] or result["visual_text"]:
        result["status"] = "ok"
    elif info:
        result["status"] = "partial"
    else:
        result["status"] = "failed"

    if errors:
        result["error"] = " | ".join(errors)
        result["extraction_warnings"] = errors

    return result


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("url")
    ap.add_argument("--out-dir", default=None)
    ap.add_argument("--no-transcribe", action="store_true")
    ap.add_argument("--no-ocr", action="store_true")
    args = ap.parse_args()

    out_dir = Path(args.out_dir) if args.out_dir else Path(tempfile.mkdtemp(prefix="tech-radar-"))
    result = extract(args.url, out_dir, do_transcribe=not args.no_transcribe, do_ocr=not args.no_ocr)
    json.dump(result, sys.stdout, indent=2, ensure_ascii=False)
    sys.stdout.write("\n")
    return 0 if result["status"] != "failed" else 2


if __name__ == "__main__":
    sys.exit(main())
