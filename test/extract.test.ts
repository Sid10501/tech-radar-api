import { describe, it, expect, vi, beforeEach } from "vitest";
import * as childProcess from "node:child_process";

vi.mock("node:child_process");

describe("extract()", () => {
  beforeEach(() => vi.resetAllMocks());

  it("parses a successful JSON result from the pipeline script", async () => {
    const { extract } = await import("../src/extract.js");

    const fakeResult = {
      url: "https://www.youtube.com/shorts/abc123",
      platform: "youtube",
      status: "ok",
      error: null,
      title: "Cool tool demo",
      creator: "devguy",
      caption: "Check out this tool #ai #dev",
      hashtags: ["ai", "dev"],
      duration_sec: 42,
      transcript: "This is a transcript",
      transcript_source: "whisper",
      upload_date: "20240101",
      raw_metadata_keys: ["title", "description"],
    };

    vi.mocked(childProcess.execFile).mockImplementation(
      (_file, _args, _opts, callback: any) => {
        callback(null, JSON.stringify(fakeResult), "");
        return {} as any;
      }
    );

    const result = await extract("https://www.youtube.com/shorts/abc123");
    expect(result.status).toBe("ok");
    expect(result.platform).toBe("youtube");
    expect(result.title).toBe("Cool tool demo");
    expect(result.hashtags).toEqual(["ai", "dev"]);
  });

  it("throws an ExtractError when the script exits non-zero", async () => {
    vi.resetModules();
    const { extract } = await import("../src/extract.js");

    vi.mocked(childProcess.execFile).mockImplementation(
      (_file, _args, _opts, callback: any) => {
        const err = Object.assign(new Error("exit 2"), { code: 2 });
        callback(err, "", "some stderr");
        return {} as any;
      }
    );

    await expect(
      extract("https://www.tiktok.com/@x/video/9999")
    ).rejects.toThrow("extract failed");
  });

  it("throws an ExtractError when the script returns invalid JSON", async () => {
    vi.resetModules();
    const { extract } = await import("../src/extract.js");

    vi.mocked(childProcess.execFile).mockImplementation(
      (_file, _args, _opts, callback: any) => {
        callback(null, "not json", "");
        return {} as any;
      }
    );

    await expect(
      extract("https://www.tiktok.com/@x/video/9999")
    ).rejects.toThrow("extract failed");
  });
});
