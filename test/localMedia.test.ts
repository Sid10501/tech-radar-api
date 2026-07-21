import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { extractLocalMedia, MAX_LOCAL_MEDIA_BYTES, resolveLocalExtractorScript } from "../src/localMedia.js";

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "local-media-"));
  directories.push(dir);
  return dir;
}

function sidecar(mediaPath: string, runId = "run-1", mimeType = "video/mp4"): void {
  fs.writeFileSync(`${mediaPath}.run.json`, JSON.stringify({ schemaVersion: 1, runId, mediaPath, mimeType }));
}

describe("local media trust boundary", () => {
  it("resolves the extractor in source and compiled Docker layouts and executes the injected path", async () => {
    const dir = tempDir();
    const script = path.join(dir, "scripts", "extract_post.py");
    fs.mkdirSync(path.dirname(script), { recursive: true });
    fs.writeFileSync(script, "# fixture");
    expect(resolveLocalExtractorScript([path.join(dir, "dist", "src")], fs.existsSync)).toBe(script);

    const media = path.join(dir, "clip.mp4");
    fs.writeFileSync(media, "x");
    sidecar(media);
    const exec = async (command: string, args: string[]) => command === "ffprobe" ? "12.4" : JSON.stringify({ url: "https://uploads.invalid/run-1", platform: "other", status: "ok", error: null, title: null, creator: null, caption: null, hashtags: [], duration_sec: null, transcript: "claim", transcript_source: "whisper", visual_text: null, visual_text_source: null, upload_date: null, raw_metadata_keys: [] });
    const result = await extractLocalMedia({ runId: "run-1", mediaPath: media, mediaDir: dir, workDir: path.join(dir, "work") }, { exec, resolveScript: () => script });
    expect(result.duration_sec).toBe(12);
  });
  it("rejects symlinks before invoking media tools", async () => {
    const dir = tempDir();
    const target = path.join(dir, "target.mp4");
    const media = path.join(dir, "link.mp4");
    fs.writeFileSync(target, "bytes");
    fs.symlinkSync(target, media);
    sidecar(media);
    await expect(extractLocalMedia({ runId: "run-1", mediaPath: media, mediaDir: dir })).rejects.toThrow(/regular files/);
  });

  it("rejects oversized and mismatched registered files before probing", async () => {
    const dir = tempDir();
    const media = path.join(dir, "large.mp4");
    fs.writeFileSync(media, "x");
    fs.truncateSync(media, MAX_LOCAL_MEDIA_BYTES + 1);
    sidecar(media);
    await expect(extractLocalMedia({ runId: "run-1", mediaPath: media, mediaDir: dir })).rejects.toThrow(/20 MB/);

    const small = path.join(dir, "small.mp4");
    fs.writeFileSync(small, "x");
    sidecar(small, "different-run");
    await expect(extractLocalMedia({ runId: "run-1", mediaPath: small, mediaDir: dir })).rejects.toThrow(/does not match/);
  });
});
