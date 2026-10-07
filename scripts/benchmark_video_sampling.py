#!/usr/bin/env python3
"""Offline old-vs-current sampler comparison. Measures a synthetic color event, not OCR accuracy."""
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

from extract_post import sample_video_frames


def run(command: list[str], **kwargs):
    return subprocess.run(command, check=True, timeout=60, **kwargs)


def late_frame(frame: Path) -> bool:
    # Every source pixel has the same color. Red means the known final-fifth event.
    pixels = run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(frame),
                  "-vf", "scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True).stdout
    return len(pixels) == 3 and pixels[0] > 150 and pixels[2] < 80


def benchmark(root: Path, duration: int, repeats: int) -> dict:
    video = root / f"synthetic-{duration}.mp4"
    # Align to an existing 2-fps source frame, including the two-second clip.
    late_start = int(duration * 0.8 * 2) / 2
    run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
         f"color=blue:s=160x90:r=2:d={duration}", "-vf",
         f"drawbox=x=0:y=0:w=iw:h=ih:color=red:t=fill:enable='gte(t,{late_start})'",
         "-c:v", "libx264", "-preset", "ultrafast", str(video)])
    output = {"duration_seconds": duration, "late_event_start_seconds": late_start,
              "source_bytes": video.stat().st_size, "source_sha256": hashlib.sha256(video.read_bytes()).hexdigest()}
    for mode in ["old", "current"]:
        timings = []
        attempts = []
        for repeat in range(repeats):
            directory = root / f"{duration}-{mode}-{repeat}"
            directory.mkdir()
            started = time.perf_counter()
            if mode == "old":
                # Exact pre-change default filter and count: commit d4d8075.
                interval = max(0.5, min(10.0, duration / 8))
                run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(video),
                     "-vf", f"fps=1/{interval},scale=960:-1", "-frames:v", "8", str(directory / "frame-%03d.png")],
                    stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
                timestamps = None  # Old extractor did not emit source timestamps.
                warning = None
                frames = sorted(directory.glob("frame-*.png"))
            else:
                records, warning = sample_video_frames(video, directory, duration)
                timestamps = [record["timestamp_ms"] for record in records]
                frames = sorted((directory / "ocr-frames").glob("frame-*.png"))
            timings.append(round(time.perf_counter() - started, 6))
            attempts.append({"frame_count": len(frames), "late_frames": sum(late_frame(frame) for frame in frames),
                             "timestamps_ms": timestamps, "warning": warning})
        output[mode] = {"cached_sampling_seconds": timings, "median_seconds": statistics.median(timings),
                        "attempts": attempts}
    return output


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--repeats", type=int, default=3)
    args = parser.parse_args()
    if not 1 <= args.repeats <= 10:
        parser.error("repeats must be 1–10")
    if not all(shutil.which(tool) for tool in ["ffmpeg", "ffprobe"]):
        parser.error("ffmpeg and ffprobe are required")
    os.environ["OCR_MAX_FRAMES"] = "8"
    os.environ.pop("OCR_FRAME_INTERVAL_SEC", None)
    os.environ["OCR_FFMPEG_TIMEOUT_SEC"] = "30"
    version = run(["ffmpeg", "-version"], capture_output=True, text=True).stdout.splitlines()[0]
    with tempfile.TemporaryDirectory(prefix="radar-sampling-benchmark-") as temporary:
        report = {"schema_version": 1, "scope": "locally_tested synthetic color-event coverage; no semantic accuracy measurement",
                  "environment": {"platform": platform.platform(), "python": platform.python_version(), "ffmpeg": version},
                  "controls": {"max_frames": 8, "width": 960, "source_fps": 2, "ocr": False, "vision": False,
                               "network": False, "paid_api_calls": 0, "repeats": args.repeats},
                  "cases": [benchmark(Path(temporary), duration, args.repeats) for duration in [2, 24, 300, 1800]]}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
