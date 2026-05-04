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
STAMP_FILE="$STAMP_DIR/installed.v1"

# --- Dependency bootstrap (idempotent, quiet) -------------------------------
if [[ ! -f "$STAMP_FILE" ]]; then
  mkdir -p "$STAMP_DIR"
  {
    echo "[tech-radar] installing dependencies (first run)" >&2
    PIP_FLAGS=(--quiet --disable-pip-version-check)
    # --break-system-packages is required on modern Debian/Ubuntu pips; it's
    # accepted-but-ignored on older ones, so passing it unconditionally is safe.
    PIP_FLAGS+=(--break-system-packages)
    python3 -m pip install "${PIP_FLAGS[@]}" \
      "yt-dlp>=2025.1.1" \
      "faster-whisper>=1.0" \
      "curl_cffi>=0.7" >&2 || true
    command -v ffmpeg >/dev/null 2>&1 || {
      echo "[tech-radar] WARNING: ffmpeg not on PATH — transcription will be skipped" >&2
    }
    touch "$STAMP_FILE"
  }
fi

# --- Run extraction ---------------------------------------------------------
# If ffmpeg is missing, transcription can't work; skip it rather than erroring.
TRANSCRIBE_FLAG=""
if ! command -v ffmpeg >/dev/null 2>&1; then
  TRANSCRIBE_FLAG="--no-transcribe"
fi

exec python3 "$SCRIPT_DIR/extract_post.py" "$URL" ${TRANSCRIBE_FLAG:+$TRANSCRIBE_FLAG}
