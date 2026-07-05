#!/usr/bin/env bash
# run_pipeline.sh — bootstraps deps (once) and runs extract_post.py for a URL.
# Prints JSON to stdout; everything else goes to stderr.
#
# Usage:
#   bash run_pipeline.sh <url>
#
# Idempotent: re-running is cheap. pip quietly skips already-installed packages.

set -euo pipefail

URL="${1:-}"
if [[ -z "$URL" ]]; then
  echo "usage: $0 <url>" >&2
  exit 64
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STAMP_DIR="${TMPDIR:-/tmp}/tech-radar-deps"
STAMP_FILE="$STAMP_DIR/installed.v2"

deps_available() {
  python3 - <<'PY' >/dev/null 2>&1
import curl_cffi
import faster_whisper
import pypdf
import youtube_transcript_api
import yt_dlp
PY
}

# --- Dependency bootstrap (idempotent, quiet) -------------------------------
if [[ ! -f "$STAMP_FILE" ]] || ! deps_available; then
  mkdir -p "$STAMP_DIR"
  {
    if deps_available; then
      echo "[tech-radar] python dependencies already available" >&2
    else
      echo "[tech-radar] installing dependencies (first run)" >&2
      PIP_FLAGS=(--quiet --disable-pip-version-check --no-cache-dir)
      # --break-system-packages is required on modern Debian/Ubuntu pips; it's
      # rejected by some macOS/system pips, so only pass it when supported.
      if python3 -m pip install --help 2>/dev/null | grep -q -- "--break-system-packages"; then
        PIP_FLAGS+=(--break-system-packages)
      fi
      python3 -m pip install "${PIP_FLAGS[@]}" \
        "yt-dlp>=2025.1.1" \
        "youtube-transcript-api>=1.2.4" \
        "pypdf>=5.0.0" \
        "faster-whisper>=1.0" \
        "curl_cffi>=0.7" >&2 || {
          echo "[tech-radar] WARNING: dependency install failed; extraction may be limited" >&2
        }
    fi
    command -v ffmpeg >/dev/null 2>&1 || {
      echo "[tech-radar] WARNING: ffmpeg not on PATH — transcription will be skipped" >&2
    }
    command -v tesseract >/dev/null 2>&1 || {
      echo "[tech-radar] WARNING: tesseract not on PATH — OCR will be skipped" >&2
    }
    if deps_available; then
      touch "$STAMP_FILE"
    else
      rm -f "$STAMP_FILE"
    fi
  }
fi

# --- Run extraction ---------------------------------------------------------
# If ffmpeg is missing, transcription can't work; skip it rather than erroring.
TRANSCRIBE_FLAG=""
if ! command -v ffmpeg >/dev/null 2>&1; then
  TRANSCRIBE_FLAG="--no-transcribe"
fi

OCR_FLAG=""
if ! command -v ffmpeg >/dev/null 2>&1 || ! command -v tesseract >/dev/null 2>&1; then
  OCR_FLAG="--no-ocr"
fi

exec python3 "$SCRIPT_DIR/extract_post.py" "$URL" ${TRANSCRIBE_FLAG:+$TRANSCRIBE_FLAG} ${OCR_FLAG:+$OCR_FLAG}
