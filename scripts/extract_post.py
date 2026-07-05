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
  "platform": "tiktok" | "instagram" | "youtube" | "google_drive" | "other",
  "status": "ok" | "partial" | "failed",
  "error": str | null,
  "title": str | null,
  "creator": str | null,
  "caption": str | null,
  "hashtags": [str],
  "duration_sec": int | null,
  "transcript": str | null,
  "transcript_source": "whisper" | "subs" | "document" | null,
  "visual_text": str | null,
  "visual_text_source": "ocr" | null,
  "upload_date": str | null,
  "raw_metadata_keys": [str],
  "source_links": [str],
  "extraction_methods": [str],
  "chapters": [{"title": str, "start_time": number, "end_time": number | null}],
  "top_comments": [{"author": str | null, "text": str, "like_count": int | null, "timestamp": int | str | null}]
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
from urllib.parse import parse_qs, unquote, urlencode, urlparse, quote

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
    if host in {"drive.google.com", "drive.usercontent.google.com"}:
        return "google_drive"
    return "other"


# --- Hashtag extraction ------------------------------------------------------

HASHTAG_RE = re.compile(r"#(\w[\w-]{0,49})")
URL_RE = re.compile(r"https?://[^\s<>)\]]+")


def pull_hashtags(text: str | None) -> list[str]:
    if not text:
        return []
    seen = []
    for m in HASHTAG_RE.findall(text):
        tag = m.lower()
        if tag not in seen:
            seen.append(tag)
    return seen


def pull_links(text: str | None) -> list[str]:
    if not text:
        return []
    seen = []
    for raw in URL_RE.findall(text):
        link = raw.rstrip(".,;:!?\"'")
        if link not in seen:
            seen.append(link)
    return seen


def extract_youtube_video_id(url: str) -> str | None:
    parsed = urlparse(url)
    host = (parsed.netloc or "").lower()
    if "youtu.be" in host:
        video_id = parsed.path.strip("/").split("/")[0]
        return video_id or None
    if "youtube.com" in host:
        if parsed.path == "/watch":
            return parse_qs(parsed.query).get("v", [None])[0]
        parts = [part for part in parsed.path.split("/") if part]
        if len(parts) >= 2 and parts[0] in {"shorts", "embed", "live"}:
            return parts[1]
    return None


def extract_google_drive_file_id(url: str) -> str | None:
    parsed = urlparse(url)
    host = (parsed.netloc or "").lower()
    if host not in {"drive.google.com", "drive.usercontent.google.com"}:
        return None
    parts = [part for part in parsed.path.split("/") if part]
    if len(parts) >= 3 and parts[0] == "file" and parts[1] == "d":
        return parts[2]
    query_id = parse_qs(parsed.query).get("id", [None])[0]
    return query_id or None


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

def run_ytdlp(
    url: str,
    out_dir: Path,
    want_audio: bool,
    want_video: bool,
    want_subtitles: bool,
    max_comments: int,
) -> tuple[dict | None, Path | None, Path | None, str | None]:
    """Return (info_dict, audio_path, video_path, error). Any of those may be None."""
    try:
        import yt_dlp  # type: ignore
    except ImportError as e:
        return None, None, None, f"yt-dlp not installed: {e}"

    want_comments = max_comments > 0
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
        "writesubtitles": want_subtitles,
        "writeautomaticsub": want_subtitles,
        "subtitleslangs": ["en", "en.*"],
        "subtitlesformat": "vtt/best",
        "getcomments": want_comments,
        "extractor_args": {
            "youtube": {
                "comment_sort": ["top"],
                "max_comments": [str(max_comments)],
            },
        } if want_comments else {},
    }

    audio_path: Path | None = None
    video_path: Path | None = None
    info: dict | None = None
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=want_audio or want_video or want_subtitles)
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


def parse_vtt_text(path: Path) -> str | None:
    try:
        body = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None

    lines: list[str] = []
    seen: set[str] = set()
    for raw in body.splitlines():
        line = raw.strip()
        if (
            not line
            or line == "WEBVTT"
            or line.startswith("Kind:")
            or line.startswith("Language:")
            or line.startswith("NOTE")
            or "-->" in line
            or re.match(r"^\d+$", line)
        ):
            continue
        clean = html.unescape(re.sub(r"<[^>]+>", "", line))
        clean = re.sub(r"\s+", " ", clean).strip()
        if not clean:
            continue
        key = clean.lower()
        if key not in seen:
            seen.add(key)
            lines.append(clean)
    text = " ".join(lines).strip()
    return text or None


def find_subtitle_text(out_dir: Path, video_id: str | None) -> str | None:
    patterns = [f"{video_id}*.vtt"] if video_id else ["*.vtt"]
    for pattern in patterns:
        for path in sorted(out_dir.glob(pattern), key=lambda p: p.stat().st_size):
            text = parse_vtt_text(path)
            if text:
                return text
    return None


def download_subtitles_cli(url: str, out_dir: Path) -> str | None:
    if not shutil.which("yt-dlp"):
        return "subtitle fallback skipped: yt-dlp CLI not installed"
    try:
        subprocess.run(
            [
                "yt-dlp",
                "--skip-download",
                "--write-subs",
                "--write-auto-subs",
                "--sub-langs",
                "en.*",
                "--sub-format",
                "vtt/srv3/best",
                "-o",
                str(out_dir / "%(id)s.%(ext)s"),
                url,
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
            timeout=45,
        )
        return None
    except Exception as e:
        return f"subtitle fallback error: {e.__class__.__name__}: {e}"


def run_ytdlp_json_cli(url: str, max_comments: int) -> tuple[dict | None, str | None]:
    if not shutil.which("yt-dlp"):
        return None, "metadata fallback skipped: yt-dlp CLI not installed"
    args = ["yt-dlp", "--skip-download", "--dump-json"]
    if max_comments > 0:
        args.extend([
            "--write-comments",
            "--extractor-args",
            f"youtube:comment_sort=top;max_comments={max_comments}",
        ])
    args.append(url)
    try:
        result = subprocess.run(
            args,
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=45,
        )
        return json.loads(result.stdout), None
    except Exception as e:
        return None, f"metadata fallback error: {e.__class__.__name__}: {e}"


def merge_cli_info(info: dict | None, cli_info: dict | None) -> dict | None:
    if not cli_info:
        return info
    if not info:
        return cli_info
    for key in ("description", "title", "fulltitle", "uploader", "channel", "duration", "upload_date", "id"):
        if not info.get(key) and cli_info.get(key):
            info[key] = cli_info[key]
    if cli_info.get("comments"):
        info["comments"] = cli_info["comments"]
    return info


def transcript_snippets_to_text(snippets) -> str | None:
    lines: list[str] = []
    seen: set[str] = set()
    for snippet in snippets or []:
        raw = None
        if isinstance(snippet, dict):
            raw = snippet.get("text")
        else:
            raw = getattr(snippet, "text", None)
        clean = html.unescape(str(raw or ""))
        clean = re.sub(r"\s+", " ", clean).strip()
        if not clean:
            continue
        key = clean.lower()
        if key not in seen:
            seen.add(key)
            lines.append(clean)
    text = " ".join(lines).strip()
    return text or None


def fetch_youtube_transcript_api(video_id: str | None) -> tuple[str | None, str | None]:
    if not video_id:
        return None, "youtube-transcript-api skipped: missing video id"
    try:
        from youtube_transcript_api import YouTubeTranscriptApi  # type: ignore
    except ImportError as e:
        return None, f"youtube-transcript-api not installed: {e}"
    try:
        fetched = YouTubeTranscriptApi().fetch(video_id, languages=["en", "en-US", "en-GB"])
        raw = fetched.to_raw_data() if hasattr(fetched, "to_raw_data") else fetched
        return transcript_snippets_to_text(raw), None
    except Exception as e:
        return None, f"youtube-transcript-api error: {e.__class__.__name__}: {e}"


def collect_chapters(info: dict | None) -> list[dict]:
    if not info:
        return []
    out = []
    for chapter in info.get("chapters") or []:
        title = str(chapter.get("title") or "").strip()
        start_time = chapter.get("start_time")
        if not title or not isinstance(start_time, (int, float)):
            continue
        end_time = chapter.get("end_time")
        out.append({
            "title": title,
            "start_time": start_time,
            "end_time": end_time if isinstance(end_time, (int, float)) else None,
        })
    return out


def collect_top_comments(info: dict | None, max_comments: int) -> list[dict]:
    if not info or max_comments <= 0:
        return []
    comments = info.get("comments") or []
    out = []
    for comment in comments[:max_comments]:
        text = str(comment.get("text") or "").strip()
        if not text:
            continue
        out.append({
            "author": comment.get("author"),
            "text": text,
            "like_count": comment.get("like_count"),
            "timestamp": comment.get("timestamp"),
        })
    return out


def parse_youtube_api_comments(payload: dict, max_comments: int) -> list[dict]:
    out = []
    for item in (payload.get("items") or [])[:max_comments]:
        snippet = (
            item.get("snippet", {})
            .get("topLevelComment", {})
            .get("snippet", {})
        )
        text = html.unescape(str(snippet.get("textDisplay") or snippet.get("textOriginal") or "")).strip()
        if not text:
            continue
        out.append({
            "author": snippet.get("authorDisplayName"),
            "text": text,
            "like_count": snippet.get("likeCount"),
            "timestamp": snippet.get("publishedAt"),
        })
    return out


def fetch_youtube_api_comments(video_id: str | None, max_comments: int) -> tuple[list[dict], str | None]:
    api_key = os.environ.get("YOUTUBE_API_KEY", "").strip()
    if not api_key or not video_id or max_comments <= 0:
        return [], None
    params = urlencode({
        "part": "snippet",
        "videoId": video_id,
        "maxResults": min(max_comments, 100),
        "order": "relevance",
        "textFormat": "plainText",
        "key": api_key,
    })
    body = _http_get(f"https://www.googleapis.com/youtube/v3/commentThreads?{params}", timeout=12)
    if not body:
        return [], "youtube-data-api comments error: empty response"
    try:
        payload = json.loads(body)
    except json.JSONDecodeError as e:
        return [], f"youtube-data-api comments error: invalid JSON: {e}"
    if payload.get("error"):
        message = payload.get("error", {}).get("message") or "unknown API error"
        return [], f"youtube-data-api comments error: {message}"
    return parse_youtube_api_comments(payload, max_comments), None


# --- Google Drive documents --------------------------------------------------

def filename_from_content_disposition(value: str | None) -> str | None:
    if not value:
        return None
    star_match = re.search(r"filename\*=UTF-8''([^;]+)", value, re.IGNORECASE)
    if star_match:
        return unquote(star_match.group(1).strip())
    match = re.search(r'filename="?(?P<name>[^";]+)"?', value, re.IGNORECASE)
    if match:
        return match.group("name").strip()
    return None


def safe_download_name(filename: str | None, fallback: str) -> str:
    raw = filename or fallback
    clean = re.sub(r"[/\\:\0]+", "-", raw).strip().strip(".")
    return clean or fallback


def download_google_drive_file(url: str, out_dir: Path) -> tuple[Path | None, str | None, str | None]:
    file_id = extract_google_drive_file_id(url)
    if not file_id:
        return None, None, "google-drive: missing file id"

    max_bytes = _int_env("GOOGLE_DRIVE_MAX_BYTES", 25 * 1024 * 1024, 1024, 100 * 1024 * 1024)
    download_url = f"https://drive.google.com/uc?export=download&id={quote(file_id)}"
    try:
        req = Request(download_url, headers={"User-Agent": _UA, "Accept": "*/*"})
        with urlopen(req, timeout=30) as r:
            filename = filename_from_content_disposition(r.headers.get("content-disposition"))
            body = r.read(max_bytes + 1)
    except (URLError, HTTPError, TimeoutError, OSError) as e:
        return None, None, f"google-drive download error: {e.__class__.__name__}: {e}"

    if len(body) > max_bytes:
        return None, filename, f"google-drive download skipped: file exceeds {max_bytes} bytes"
    if body.lstrip().startswith(b"<"):
        return None, filename, "google-drive download error: received HTML instead of file bytes"

    name = safe_download_name(filename, f"{file_id}.bin")
    path = out_dir / name
    try:
        path.write_bytes(body)
    except OSError as e:
        return None, filename, f"google-drive write error: {e.__class__.__name__}: {e}"
    return path, filename or name, None


def extract_pdf_text(path: Path) -> tuple[str | None, str | None]:
    try:
        from pypdf import PdfReader  # type: ignore
    except ImportError as e:
        return None, f"pypdf not installed: {e}"

    max_pages = _int_env("PDF_MAX_PAGES", 20, 1, 200)
    max_chars = _int_env("PDF_MAX_CHARS", 20000, 1000, 100000)
    try:
        reader = PdfReader(str(path))
        parts: list[str] = []
        for page in reader.pages[:max_pages]:
            text = page.extract_text() or ""
            clean = re.sub(r"\s+", " ", text).strip()
            if clean:
                parts.append(clean)
            if sum(len(part) for part in parts) >= max_chars:
                break
        body = "\n\n".join(parts).strip()
        return (body[:max_chars] or None), None
    except Exception as e:
        return None, f"pdf extraction error: {e.__class__.__name__}: {e}"


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

    seen: set[str] = set()
    lines: list[str] = []
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
        for line in result.stdout.splitlines():
            clean = re.sub(r"\s+", " ", line).strip()
            if len(clean) < 3:
                continue
            key = clean.lower()
            if key not in seen:
                seen.add(key)
                lines.append(clean)

    text = "\n".join(lines).strip()
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
        "source_links": [],
        "extraction_methods": [],
        "chapters": [],
        "top_comments": [],
    }

    if platform == "google_drive":
        file_path, filename, drive_err = download_google_drive_file(url, out_dir)
        errors: list[str] = []
        if filename:
            result["title"] = filename
            result["caption"] = filename
        if file_path:
            result["extraction_methods"].append("google-drive:download")
            if file_path.suffix.lower() == ".pdf":
                text, pdf_err = extract_pdf_text(file_path)
                if text:
                    result["transcript"] = text
                    result["transcript_source"] = "document"
                    result["source_links"] = pull_links(text)
                    result["extraction_methods"].append("pypdf")
                elif pdf_err:
                    errors.append(pdf_err)
        if drive_err:
            errors.append(drive_err)

        if not result["caption"] and not result["title"]:
            meta = try_html_meta(url)
            if meta:
                result["title"] = meta.get("og:title") or meta.get("twitter:title")
                result["caption"] = result["title"]
                result["extraction_methods"].append("html-meta")

        if result["caption"] or result["transcript"]:
            result["status"] = "ok"
        else:
            result["status"] = "failed"
        if errors:
            result["error"] = " | ".join(errors)
        return result

    video_id = extract_youtube_video_id(url) if platform == "youtube" else None
    max_comments = _int_env("YOUTUBE_MAX_COMMENTS", 0, 0, 50) if platform == "youtube" else 0
    use_api_comments = platform == "youtube" and max_comments > 0 and bool(os.environ.get("YOUTUBE_API_KEY", "").strip())
    prefer_subtitles = platform == "youtube" and do_transcribe
    info, audio_path, video_path, yt_err = run_ytdlp(
        url,
        out_dir,
        want_audio=do_transcribe and not prefer_subtitles,
        want_video=do_ocr and platform != "youtube",
        want_subtitles=False,
        max_comments=0,
    )
    errors: list[str] = []
    metadata_from_cli = False

    if platform == "youtube" and not info:
        cli_info, cli_err = run_ytdlp_json_cli(url, 0)
        info = merge_cli_info(info, cli_info)
        metadata_from_cli = bool(cli_info)
        if cli_err and not info:
            errors.append(cli_err)

    if yt_err and not info:
        errors.append(yt_err)

    if info:
        result["extraction_methods"].append("yt-dlp-cli:metadata" if metadata_from_cli else "yt-dlp:metadata")
        result["raw_metadata_keys"] = sorted(info.keys())
        result["title"] = info.get("title") or info.get("fulltitle")
        result["creator"] = info.get("uploader") or info.get("channel") or info.get("uploader_id")
        caption = info.get("description") or info.get("title")
        result["caption"] = caption
        result["hashtags"] = pull_hashtags(caption)
        result["source_links"] = pull_links(caption)
        result["duration_sec"] = info.get("duration")
        result["upload_date"] = info.get("upload_date")
        result["chapters"] = collect_chapters(info)

        if max_comments > 0 and platform == "youtube":
            api_comments, api_comments_err = fetch_youtube_api_comments(video_id or info.get("id"), max_comments)
            if api_comments:
                result["top_comments"] = api_comments
                result["extraction_methods"].append("youtube-data-api:comments")
            elif api_comments_err and use_api_comments:
                errors.append(api_comments_err)

            if not result["top_comments"]:
                result["top_comments"] = collect_top_comments(info, max_comments)
                if result["top_comments"]:
                    result["extraction_methods"].append("yt-dlp:comments")

            if not result["top_comments"]:
                cli_info, cli_err = run_ytdlp_json_cli(url, max_comments)
                info = merge_cli_info(info, cli_info)
                result["top_comments"] = collect_top_comments(info, max_comments)
                if result["top_comments"]:
                    result["extraction_methods"].append("yt-dlp-cli:comments")
                elif cli_err:
                    errors.append(cli_err)

        if prefer_subtitles and not result["transcript"]:
            transcript_api_text, transcript_api_err = fetch_youtube_transcript_api(video_id or info.get("id"))
            if transcript_api_text:
                result["transcript"] = transcript_api_text
                result["transcript_source"] = "subs"
                result["extraction_methods"].append("youtube-transcript-api")
            elif transcript_api_err:
                errors.append(transcript_api_err)

        if prefer_subtitles and not result["transcript"]:
            subtitle_text = find_subtitle_text(out_dir, info.get("id"))
            if subtitle_text:
                result["transcript"] = subtitle_text
                result["transcript_source"] = "subs"
                result["extraction_methods"].append("yt-dlp:subtitles")

    if prefer_subtitles and not result["transcript"]:
        sub_err = download_subtitles_cli(url, out_dir)
        subtitle_text = find_subtitle_text(out_dir, info.get("id") if info else video_id)
        if subtitle_text:
            result["transcript"] = subtitle_text
            result["transcript_source"] = "subs"
            result["extraction_methods"].append("yt-dlp-cli:subtitles")
        elif sub_err:
            errors.append(sub_err)

    if do_transcribe and not result["transcript"] and platform == "youtube":
        retry_info, retry_audio, _retry_video, retry_err = run_ytdlp(
            url,
            out_dir,
            want_audio=True,
            want_video=False,
            want_subtitles=False,
            max_comments=0,
        )
        if retry_info and not info:
            info = retry_info
        if retry_audio:
            audio_path = retry_audio
        if retry_err:
            errors.append(retry_err)

    if not result["caption"] and not result["title"]:
        oembed = try_oembed(url, platform)
        if oembed:
            result["title"] = result["title"] or oembed.get("title")
            result["creator"] = result["creator"] or oembed.get("author_name")
            result["caption"] = result["caption"] or oembed.get("title")
            result["hashtags"] = result["hashtags"] or pull_hashtags(oembed.get("title"))
            result["extraction_methods"].append("oembed")
        meta = try_html_meta(url)
        if meta:
            result["title"] = result["title"] or meta.get("og:title") or meta.get("twitter:title")
            cap = meta.get("og:description") or meta.get("twitter:description") or meta.get("description")
            if cap and not result["caption"]:
                result["caption"] = cap
                result["hashtags"] = result["hashtags"] or pull_hashtags(cap)
                result["source_links"] = result["source_links"] or pull_links(cap)
                result["extraction_methods"].append("html-meta")

    if do_transcribe and not result["transcript"] and audio_path and audio_path.exists():
        transcript, w_err = transcribe(audio_path)
        if transcript:
            result["transcript"] = transcript
            result["transcript_source"] = "whisper"
            result["extraction_methods"].append("faster-whisper")
        elif w_err:
            errors.append(w_err)

    if do_ocr and video_path and video_path.exists():
        visual_text, ocr_err = extract_visual_text(video_path, out_dir)
        if visual_text:
            result["visual_text"] = visual_text
            result["visual_text_source"] = "ocr"
            result["extraction_methods"].append("tesseract:ocr")
        elif ocr_err:
            errors.append(ocr_err)

    if result["caption"] or result["transcript"] or result["visual_text"]:
        result["status"] = "ok"
    elif info:
        result["status"] = "partial"
    else:
        result["status"] = "failed"

    if errors:
        result["error"] = " | ".join(errors)

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
