#!/usr/bin/env python3
"""Offline comparison of the historical fps filter and current video sampler."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import statistics
import subprocess
import tempfile
import time

from extract_post import probe_video_duration, sample_video_frames


def version(command: list[str]) -> str:
    return subprocess.run(command, check=True, capture_output=True, text=True).stdout.splitlines()[0]


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def normalized(value: str) -> str:
    return "".join(value.casefold().split())


def measure(source: Path, root: Path, mode: str, run_number: int, duration: float, labels: list[str]) -> dict:
    directory = root / f"{mode}-{run_number}"
    directory.mkdir()
    start = time.perf_counter()
    if mode == "baseline":
        interval = max(0.5, min(10.0, duration / 8))
        subprocess.run(
            ["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-i", str(source),
             "-vf", f"fps=1/{interval},scale=960:-1", "-frames:v", "8", str(directory / "frame-%03d.png")],
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=30,
        )
        frames = [{"file": frame.name, "timestamp_ms": None} for frame in sorted(directory.glob("frame-*.png"))]
        frame_dir = directory
        warning = None
    else:
        frames, warning = sample_video_frames(source, directory, duration)
        frame_dir = directory / "ocr-frames"
    sampling_seconds = time.perf_counter() - start

    start = time.perf_counter()
    for frame in frames:
        try:
            result = subprocess.run(
                ["tesseract", str(frame_dir / frame["file"]), "stdout", "--psm", "6"],
                check=True, capture_output=True, text=True, timeout=20,
            )
            frame["ocr_text"] = result.stdout
        except (OSError, subprocess.SubprocessError):
            frame["ocr_text"] = None
            warning = warning or "ocr incomplete: one or more sampled frames could not be read"
        frame["matched_identifiers"] = [label for label in labels if normalized(label) in normalized(frame["ocr_text"] or "")]
    ocr_seconds = time.perf_counter() - start
    matched = [label for label in labels if any(label in frame["matched_identifiers"] for frame in frames)]
    return {
        "sampling_seconds": sampling_seconds, "ocr_seconds": ocr_seconds, "warning": warning,
        "frame_count": len(frames), "matched_identifiers": matched,
        "identifier_recall": len(matched) / len(labels), "frames": frames,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--labels", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--repeats", type=int, default=3)
    args = parser.parse_args()
    if not args.source.is_file() or not args.labels.is_file():
        parser.error("source and labels must be existing files")
    if not 1 <= args.repeats <= 10:
        parser.error("repeats must be 1–10")
    if not all(shutil.which(tool) for tool in ("ffmpeg", "ffprobe", "tesseract")):
        parser.error("ffmpeg, ffprobe, and tesseract are required")
    labels_document = json.loads(args.labels.read_text())
    labels = labels_document["identifiers"]
    if not isinstance(labels, list) or not labels or not all(isinstance(label, str) and label for label in labels):
        parser.error("labels JSON must contain a nonempty identifiers string array")
    duration = probe_video_duration(args.source)
    if duration is None or duration > 1800:
        parser.error("source must have a probed duration of at most 1800 seconds")
    os.environ["OCR_MAX_FRAMES"] = "8"
    os.environ.pop("OCR_FRAME_INTERVAL_SEC", None)
    os.environ["OCR_FFMPEG_TIMEOUT_SEC"] = "30"
    with tempfile.TemporaryDirectory(prefix="radar-real-video-") as temporary:
        modes = {}
        for mode in ("baseline", "current"):
            attempts = [measure(args.source, Path(temporary), mode, i, duration, labels) for i in range(args.repeats)]
            modes[mode] = {
                "attempts": attempts,
                "median_sampling_seconds": statistics.median(a["sampling_seconds"] for a in attempts),
                "median_ocr_seconds": statistics.median(a["ocr_seconds"] for a in attempts),
            }
    report = {
        "scope": "one local source; cached sampling and literal OCR identifier recall only",
        "source": {"filename": args.source.name, "sha256": digest(args.source), "duration_seconds": duration},
        "labels": {"filename": args.labels.name, "sha256": digest(args.labels), "status": labels_document.get("status")},
        "controls": {"frames": 8, "width": 960, "ocr_psm": 6, "repeats": args.repeats, "network": False, "paid_api_calls": 0},
        "versions": {"python": platform.python_version(), "ffmpeg": version(["ffmpeg", "-version"]),
                     "tesseract": version(["tesseract", "--version"])},
        "modes": modes,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(f"Wrote {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
