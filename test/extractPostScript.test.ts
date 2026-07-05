import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";

function runPythonSnippet(code: string): string {
  return execFileSync("python3", ["-c", code], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, PYTHONPATH: process.cwd() },
  }).trim();
}

describe("extract_post.py media helpers", () => {
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
});
