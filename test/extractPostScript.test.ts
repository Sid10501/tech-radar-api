import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

function runPythonSnippet(code: string): string {
  return execFileSync("python3", ["-c", code], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, PYTHONPATH: process.cwd() },
  }).trim();
}

describe("extract_post.py media helpers", () => {
  it('invalidates old frame assets before every early sampling failure', () => {
    const output = runPythonSnippet(`
import json, tempfile
from pathlib import Path
from unittest.mock import patch
from scripts.extract_post import sample_video_frames, ocr_frame_assets
with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    frames = root / 'ocr-frames'
    frames.mkdir()
    video = root / 'video.mp4'
    video.write_bytes(b'video')
    results = []
    for reason in ('ffmpeg', 'file', 'duration'):
        (frames / 'frame-001.png').write_bytes(b'old')
        (frames / 'index.json').write_text('[{"file":"frame-001.png","ocr_text":"old"}]')
        with patch('scripts.extract_post.shutil.which', return_value=None if reason == 'ffmpeg' else '/usr/bin/ffmpeg'), patch('scripts.extract_post.probe_video_duration', return_value=1801 if reason == 'duration' else 5):
            sample_video_frames(root / 'missing.mp4' if reason == 'file' else video, root)
        results.append(ocr_frame_assets(root))
    print(json.dumps(results))
`);
    expect(JSON.parse(output)).toEqual([[], [], []]);
  });
  it("configures yt-dlp to reject known media over 30 minutes before download", () => {
    const source = fs.readFileSync("scripts/extract_post.py", "utf8");
    expect(source).toContain("match_filter");
    expect(source).toMatch(/duration[^\n]+1800|1800[^\n]+duration/);
  });
  it("preserves subtitle cue timestamps as transcript segments", () => {
    const output = runPythonSnippet(`
import json, tempfile
from pathlib import Path
from scripts.extract_post import parse_vtt_segments
with tempfile.TemporaryDirectory() as directory:
    cue = Path(directory) / "captions.vtt"
    cue.write_text("WEBVTT\\n\\n00:00:01.000 --> 00:00:03.500\\nFirst claim\\n\\n00:29:00.000 --> 00:29:04.000\\nLate claim\\n")
    print(json.dumps(parse_vtt_segments(cue)))
`);
    expect(JSON.parse(output)).toEqual([{ start_ms: 1_000, end_ms: 3_500, text: "First claim" }, { start_ms: 1_740_000, end_ms: 1_744_000, text: "Late claim" }]);
  });
  it("blocks localhost and private-network fetch URLs", () => {
    const output = runPythonSnippet(`
import json, socket
from scripts.extract_post import is_allowed_fetch_url
socket.getaddrinfo = lambda *args, **kwargs: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 443))]

print(json.dumps({
  "public": is_allowed_fetch_url("https://example.com/image.jpg"),
  "localhost": is_allowed_fetch_url("http://localhost:8000/admin"),
  "loopback": is_allowed_fetch_url("http://127.0.0.1:8000/admin"),
  "mappedLoopback": is_allowed_fetch_url("http://[::ffff:127.0.0.1]/admin"),
  "metadata": is_allowed_fetch_url("http://169.254.169.254/latest/meta-data"),
  "cgnat": is_allowed_fetch_url("http://100.64.0.1/internal"),
  "private": is_allowed_fetch_url("http://10.0.0.5/internal"),
  "file": is_allowed_fetch_url("file:///etc/passwd"),
}))
`);

    expect(JSON.parse(output)).toEqual({
      public: true,
      localhost: false,
      loopback: false,
      mappedLoopback: false,
      metadata: false,
      cgnat: false,
      private: false,
      file: false,
    });
  });

  it("caps image response reads before writing OCR assets", () => {
    const output = runPythonSnippet(`
from scripts.extract_post import DownloadLimitExceeded, _read_limited_response

class FakeResponse:
    headers = {}
    def read(self, size=-1):
        return b"x" * size if size >= 0 else b"x" * 20

try:
    _read_limited_response(FakeResponse(), 8)
    print("missing-limit")
except DownloadLimitExceeded:
    print("limited")
`);

    expect(output).toBe("limited");
  });

  it("collects carousel image URLs from yt-dlp info and HTML metadata", () => {
    const output = runPythonSnippet(`
import json
from scripts.extract_post import collect_image_urls

info = {
  "thumbnail": "https://cdn.example.com/cover.jpg",
  "entries": [
    {"url": "https://cdn.example.com/slide-1.jpg", "ext": "jpg"},
    {"display_url": "https://cdn.example.com/slide-2.webp"},
    {"thumbnails": [{"url": "https://cdn.example.com/thumb.png"}]},
    {"url": "https://cdn.example.com/video.mp4", "ext": "mp4"}
  ]
}
meta = {"og:image": "https://cdn.example.com/og.jpg?a=1&amp;b=2"}
print(json.dumps(collect_image_urls(info, meta)))
`);

    expect(JSON.parse(output)).toEqual([
      "https://cdn.example.com/cover.jpg",
      "https://cdn.example.com/slide-1.jpg",
      "https://cdn.example.com/slide-2.webp",
      "https://cdn.example.com/thumb.png",
      "https://cdn.example.com/og.jpg?a=1&b=2",
    ]);
  });

  it("dedupes OCR text blocks while preserving first-seen order", () => {
    const output = runPythonSnippet(`
from scripts.extract_post import merge_text_blocks
print(merge_text_blocks(["Repo: github.com/a/b\\nAI Editor", "repo: github.com/a/b\\nDocs: example.dev"]))
`);

    expect(output).toBe("Repo: github.com/a/b\nAI Editor\nDocs: example.dev");
  });

  it("exposes sampled video frames as ordered screenshot assets for vision OCR", () => {
    const output = runPythonSnippet(`
import json, tempfile
from pathlib import Path
from scripts.extract_post import ocr_frame_assets

with tempfile.TemporaryDirectory() as directory:
    frames = Path(directory) / "ocr-frames"
    frames.mkdir()
    (frames / "frame-002.png").write_bytes(b"second")
    (frames / "frame-001.png").write_bytes(b"first")
    (frames / "ignore.txt").write_text("ignored")
    print(json.dumps(ocr_frame_assets(Path(directory))))
`);

    const assets = JSON.parse(output);
    expect(assets.map((asset: { type: string; source: string; path: string }) => ({
      type: asset.type,
      source: asset.source,
      name: asset.path.split("/").at(-1),
    }))).toEqual([
      { type: "screenshot", source: "video-frame", name: "frame-001.png" },
      { type: "screenshot", source: "video-frame", name: "frame-002.png" },
    ]);
  });

  it("spreads a bounded frame budget across long videos as well as short reels", () => {
    const output = runPythonSnippet(`
import json, os
from scripts.extract_post import frame_sample_interval

os.environ.pop("OCR_FRAME_INTERVAL_SEC", None)
values = {
  "reel": frame_sample_interval(24.0, 8),
  "short": frame_sample_interval(2.0, 8),
  "bounded": frame_sample_interval(300.0, 8),
  "unknown": frame_sample_interval(None, 8),
}
os.environ["OCR_FRAME_INTERVAL_SEC"] = ""
values["blank"] = frame_sample_interval(24.0, 8)
print(json.dumps(values))
`);

    expect(JSON.parse(output)).toEqual({ reel: 3, short: 0.5, bounded: 37.5, unknown: 2, blank: 3 });
  });

  it("retains per-frame text and presentation timestamps in screenshot assets", () => {
    const output = runPythonSnippet(`
import json, tempfile
from pathlib import Path
from scripts.extract_post import ocr_frame_assets
with tempfile.TemporaryDirectory() as directory:
    frames = Path(directory) / "ocr-frames"
    frames.mkdir()
    (frames / "frame-001.png").write_bytes(b"first")
    (frames / "frame-002.png").write_bytes(b"late")
    (frames / "index.json").write_text(json.dumps([
        {"file": "frame-001.png", "timestamp_ms": 1500, "ocr_text": "First repo"},
        {"file": "frame-002.png", "timestamp_ms": 281500, "ocr_text": "Late repo"},
    ]))
    print(json.dumps(ocr_frame_assets(Path(directory))))
`);
    expect(JSON.parse(output)).toEqual([
      expect.objectContaining({ timestamp_ms: 1500, ocr_text: "First repo" }),
      expect.objectContaining({ timestamp_ms: 281500, ocr_text: "Late repo" }),
    ]);
  });

  it.skipIf(!["ffmpeg", "ffprobe", "tesseract"].every((tool) => {
    try { execFileSync(tool, [tool === "tesseract" ? "--version" : "-version"], { stdio: "ignore" }); return true; } catch { return false; }
  }))("extracts actual late frames with source timestamps from a synthetic five-minute clip", () => {
    const output = runPythonSnippet(`
import json, os, subprocess, tempfile
from pathlib import Path
from scripts.extract_post import extract_visual_text, ocr_frame_assets
os.environ.pop("OCR_FRAME_INTERVAL_SEC", None)
os.environ["OCR_MAX_FRAMES"] = "8"
with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    video = root / "long.mp4"
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=blue:s=64x64:r=2:d=300", "-c:v", "libx264", str(video)], check=True)
    text, error = extract_visual_text(video, root, 300)
    assets = ocr_frame_assets(root)
    print(json.dumps({"error": error, "times": [a.get("timestamp_ms") for a in assets]}))
`);
    const result = JSON.parse(output);
    expect(result.error).toBeNull();
    expect(result.times).toHaveLength(8);
    expect(result.times[0]).toBe(19000);
    expect(result.times.at(-1)).toBe(281500);
  }, 20000);

  it("downloads YouTube video only when visual acquisition is explicitly enabled", () => {
    const output = runPythonSnippet(`
import json, os, socket, tempfile
from pathlib import Path
import scripts.extract_post as extractor
socket.getaddrinfo = lambda *args, **kwargs: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 443))]
requests = []
def download(url, directory, **options):
    requests.append(options)
    return {"title": "Tutorial", "duration": 300}, None, None, None
extractor.run_ytdlp = download
extractor.download_image_assets = lambda *args: ([], [], [])
with tempfile.TemporaryDirectory() as directory:
    for setting, ocr in [(None, True), ("1", True), ("1", False)]:
        os.environ.pop("YOUTUBE_VISUAL_ENABLED", None)
        if setting: os.environ["YOUTUBE_VISUAL_ENABLED"] = setting
        extractor.extract("https://www.youtube.com/watch?v=abc", Path(directory), False, ocr)
print(json.dumps([request["want_video"] for request in requests]))
`);
    expect(JSON.parse(output)).toEqual([false, true, false]);
  });

  it("reports a failed opt-in visual download even when YouTube metadata succeeds", () => {
    const output = runPythonSnippet(`
import json, os, socket, tempfile
from pathlib import Path
import scripts.extract_post as extractor
socket.getaddrinfo = lambda *args, **kwargs: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 443))]
os.environ["YOUTUBE_VISUAL_ENABLED"] = "1"
extractor.run_ytdlp = lambda *args, **kwargs: ({"title": "Tutorial", "duration": 300}, None, None, "yt-dlp download exceeded 52428800 bytes")
extractor.download_image_assets = lambda *args: ([], [], [])
with tempfile.TemporaryDirectory() as directory:
    result = extractor.extract("https://www.youtube.com/watch?v=abc", Path(directory), False, True)
    print(json.dumps(result["extraction_warnings"]))
`);
    expect(JSON.parse(output)).toContain("yt-dlp download exceeded 52428800 bytes");
  });

  it("attaches sampled frame assets to local video extraction", () => {
    const output = runPythonSnippet(`
import json, tempfile
from pathlib import Path
import scripts.extract_post as extractor

def fake_visual_text(_video_path, out_dir, _duration_sec=None):
    frames = out_dir / "ocr-frames"
    frames.mkdir(parents=True)
    (frames / "frame-001.png").write_bytes(b"frame")
    return "ETFs\\n1. VOO", None

extractor.extract_visual_text = fake_visual_text
with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    video = root / "upload.mp4"
    video.write_bytes(b"video")
    result = extractor.extract_local_file(video, root / "work", "source", False, True)
    print(json.dumps(result["media_assets"]))
`);

    expect(JSON.parse(output)).toEqual([expect.objectContaining({
      type: "screenshot",
      source: "video-frame",
      confidence: "medium",
    })]);
  });
});
