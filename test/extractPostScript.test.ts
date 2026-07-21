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
import json
from scripts.extract_post import is_allowed_fetch_url

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

  it("samples frames uniformly across short-form video duration by default", () => {
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

    expect(JSON.parse(output)).toEqual({ reel: 3, short: 0.5, bounded: 10, unknown: 2, blank: 3 });
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
