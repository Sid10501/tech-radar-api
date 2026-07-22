import { describe, it, expect, vi, beforeEach } from "vitest";
import * as childProcess from "node:child_process";
import * as dns from "node:dns/promises";

vi.mock("node:child_process");
vi.mock("node:dns/promises");

describe("extract()", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(dns.lookup).mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as any);
  });

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

  it("expands extracted shortlinks before returning evidence", async () => {
    vi.resetModules();
    const fetcher = vi.fn(async (url: string) => {
      if (url === "https://t.co/abc123") {
        return new Response(null, { status: 302, headers: { location: "https://github.com/acme/tool" } });
      }
      return new Response(null, { status: 200 });
    });
    const { extract } = await import("../src/extract.js");
    vi.mocked(childProcess.execFile).mockImplementation(
      (_file, _args, _opts, callback: any) => {
        callback(null, JSON.stringify({
          url: "https://x.com/example/status/123",
          platform: "other",
          status: "ok",
          error: null,
          title: "A linked tool",
          creator: "example",
          caption: "Project: https://t.co/abc123",
          hashtags: [],
          duration_sec: null,
          transcript: null,
          transcript_source: null,
          visual_text: null,
          visual_text_source: null,
          upload_date: "20260720",
          raw_metadata_keys: [],
        }), "");
        return {} as any;
      },
    );

    const result = await extract("https://x.com/example/status/123", { fetcher });
    expect(result.source_links).toContain("https://github.com/acme/tool");
    expect(result.shortlink_expansions).toContainEqual(expect.objectContaining({
      sourceUrl: "https://t.co/abc123",
      finalHost: "github.com",
      status: "resolved",
    }));
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

  it("rejects localhost and private-network URLs before invoking the extractor script", async () => {
    vi.resetModules();
    const { extract } = await import("../src/extract.js");

    await expect(extract("http://127.0.0.1:8080/admin")).rejects.toThrow("blocked submitted URL");
    await expect(extract("http://169.254.169.254/latest/meta-data")).rejects.toThrow("blocked submitted URL");
    await expect(extract("http://[::ffff:127.0.0.1]/admin")).rejects.toThrow("blocked submitted URL");
    await expect(extract("http://100.64.0.1/internal")).rejects.toThrow("blocked submitted URL");
    expect(childProcess.execFile).not.toHaveBeenCalled();
  });

  it("rejects hostnames that resolve to private or metadata addresses before invoking the extractor script", async () => {
    vi.resetModules();
    vi.mocked(dns.lookup).mockResolvedValue([{ address: "169.254.169.254", family: 4 }] as any);
    const { extract } = await import("../src/extract.js");

    await expect(extract("http://metadata.google.internal/latest/meta-data")).rejects.toThrow("blocked submitted URL");

    expect(dns.lookup).toHaveBeenCalledWith("metadata.google.internal", { all: true, verbatim: false });
    expect(childProcess.execFile).not.toHaveBeenCalled();
  });
});
