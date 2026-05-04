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
  "upload_date": str | null,
  "raw_metadata_keys": [str]
}
"""
from __future__ import annotations

import argparse
import json
import re
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

def run_ytdlp(url: str, out_dir: Path, want_audio: bool) -> tuple[dict | None, Path | None, str | None]:
    """Return (info_dict, audio_path, error). Any of those may be None."""
    try:
        import yt_dlp  # type: ignore
    except ImportError as e:
        return None, None, f"yt-dlp not installed: {e}"

    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": not want_audio,
        "outtmpl": str(out_dir / "%(id)s.%(ext)s"),
        "format": "bestaudio/best",
        "postprocessors": [] if not want_audio else [
            {"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "64"},
        ],
        "extractor_args": {},
    }

    audio_path: Path | None = None
    info: dict | None = None
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=want_audio)
            if want_audio and info:
                base = Path(ydl.prepare_filename(info))
                mp3 = base.with_suffix(".mp3")
                if mp3.exists():
                    audio_path = mp3
                elif base.exists():
                    audio_path = base
        return info, audio_path, None
    except Exception as e:
        return info, audio_path, f"yt-dlp error: {e.__class__.__name__}: {e}"


# --- Whisper transcription ---------------------------------------------------

def transcribe(audio_path: Path) -> tuple[str | None, str | None]:
    """Return (transcript, error). Uses faster-whisper with the 'tiny' model."""
    try:
        from faster_whisper import WhisperModel  # type: ignore
    except ImportError as e:
        return None, f"faster-whisper not installed: {e}"
    try:
        model = WhisperModel("tiny", device="cpu", compute_type="int8")
        segments, _info = model.transcribe(str(audio_path), language=None, vad_filter=True)
        text = " ".join(seg.text.strip() for seg in segments).strip()
        return text or None, None
    except Exception as e:
        return None, f"whisper error: {e.__class__.__name__}: {e}"


# --- Main --------------------------------------------------------------------

def extract(url: str, out_dir: Path, do_transcribe: bool) -> dict:
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
        "upload_date": None,
        "raw_metadata_keys": [],
    }

    info, audio_path, yt_err = run_ytdlp(url, out_dir, want_audio=do_transcribe)
    errors: list[str] = []
    if yt_err:
        errors.append(yt_err)

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
        meta = try_html_meta(url)
        if meta:
            result["title"] = result["title"] or meta.get("og:title") or meta.get("twitter:title")
            cap = meta.get("og:description") or meta.get("twitter:description") or meta.get("description")
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

    if result["caption"] or result["transcript"]:
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
    args = ap.parse_args()

    out_dir = Path(args.out_dir) if args.out_dir else Path(tempfile.mkdtemp(prefix="tech-radar-"))
    result = extract(args.url, out_dir, do_transcribe=not args.no_transcribe)
    json.dump(result, sys.stdout, indent=2, ensure_ascii=False)
    sys.stdout.write("\n")
    return 0 if result["status"] != "failed" else 2


if __name__ == "__main__":
    sys.exit(main())
