import { beforeEach, describe, expect, it, vi } from "vitest";
import * as dns from "node:dns/promises";
import type { ExtractResult } from "../src/extract.js";

vi.mock("node:dns/promises");

const baseExtract: ExtractResult = {
  url: "https://x.com/example/status/123",
  platform: "other",
  status: "ok",
  error: null,
  title: null,
  creator: "example",
  caption: "Project link: https://t.co/abc123",
  hashtags: [],
  duration_sec: null,
  transcript: null,
  transcript_source: null,
  visual_text: null,
  visual_text_source: null,
  upload_date: "20260720",
  raw_metadata_keys: [],
};

describe("shortlink expansion", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(dns.lookup).mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as any);
  });

  it("resolves a bounded redirect and records its final host", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(null, {
        status: 302,
        headers: { location: "https://github.com/acme/tool" },
      }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const { resolveShortlink } = await import("../src/shortlinks.js");

    const expansion = await resolveShortlink("https://t.co/abc123", { fetcher });

    expect(expansion).toEqual({
      sourceUrl: "https://t.co/abc123",
      expandedUrl: "https://github.com/acme/tool",
      finalHost: "github.com",
      status: "resolved",
      reason: "expanded",
      redirectCount: 1,
    });
    expect(fetcher).toHaveBeenNthCalledWith(1, "https://t.co/abc123", expect.objectContaining({ redirect: "manual" }));
    expect(fetcher).toHaveBeenNthCalledWith(2, "https://github.com/acme/tool", expect.objectContaining({ redirect: "manual" }));
    expect(dns.lookup).toHaveBeenCalledWith("t.co", { all: true, verbatim: false });
    expect(dns.lookup).toHaveBeenCalledWith("github.com", { all: true, verbatim: false });
  });

  it("blocks a redirect to a private or metadata address before fetching it", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, {
      status: 302,
      headers: { location: "http://169.254.169.254/latest/meta-data" },
    }));
    const { resolveShortlink } = await import("../src/shortlinks.js");

    const expansion = await resolveShortlink("https://t.co/private", { fetcher });

    expect(expansion).toMatchObject({
      expandedUrl: null,
      finalHost: "169.254.169.254",
      status: "blocked",
      reason: "blocked_redirect",
      redirectCount: 1,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("blocks a redirect hostname when DNS resolves it to a private address", async () => {
    vi.mocked(dns.lookup).mockImplementation(async (hostname: string) => {
      if (hostname === "metadata.internal") {
        return [{ address: "10.0.0.8", family: 4 }] as any;
      }
      return [{ address: "93.184.216.34", family: 4 }] as any;
    });
    const fetcher = vi.fn().mockResolvedValue(new Response(null, {
      status: 302,
      headers: { location: "http://metadata.internal/secrets" },
    }));
    const { resolveShortlink } = await import("../src/shortlinks.js");

    const expansion = await resolveShortlink("https://t.co/private-dns", { fetcher });

    expect(expansion).toMatchObject({
      finalHost: "metadata.internal",
      status: "blocked",
      reason: "blocked_redirect",
    });
    expect(dns.lookup).toHaveBeenCalledWith("metadata.internal", { all: true, verbatim: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("blocks the full IPv6 link-local range", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, {
      status: 302,
      headers: { location: "http://[fe90::1]/admin" },
    }));
    const { resolveShortlink } = await import("../src/shortlinks.js");

    const expansion = await resolveShortlink("https://t.co/link-local", { fetcher });

    expect(expansion).toMatchObject({ status: "blocked", reason: "blocked_redirect" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("fails closed on redirect loops", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://bit.ly/next" } }))
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://t.co/loop" } }))
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://bit.ly/next" } }));
    const { resolveShortlink } = await import("../src/shortlinks.js");

    const expansion = await resolveShortlink("https://t.co/loop", { fetcher });

    expect(expansion).toMatchObject({ status: "unresolved", reason: "redirect_loop", redirectCount: 2 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("fails closed when the total timeout aborts a slow request", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }));
    const { resolveShortlink } = await import("../src/shortlinks.js");

    const pending = resolveShortlink("https://t.co/slow", { fetcher, timeoutMs: 50 });
    await vi.advanceTimersByTimeAsync(51);

    await expect(pending).resolves.toMatchObject({ status: "unresolved", reason: "timeout" });
    vi.useRealTimers();
  });

  it("applies the same total timeout while DNS validation is pending", async () => {
    vi.useFakeTimers();
    vi.mocked(dns.lookup).mockImplementation(() => new Promise(() => {}) as any);
    const fetcher = vi.fn();
    const { resolveShortlink } = await import("../src/shortlinks.js");

    const pending = resolveShortlink("https://t.co/slow-dns", { fetcher, timeoutMs: 50 });
    await vi.advanceTimersByTimeAsync(51);

    await expect(pending).resolves.toMatchObject({ status: "unresolved", reason: "timeout" });
    expect(fetcher).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("caps the number of redirects", async () => {
    const fetcher = vi.fn(async (url: string) => {
      const hop = Number(new URL(url).searchParams.get("hop") ?? "0");
      return new Response(null, { status: 302, headers: { location: `https://t.co/path?hop=${hop + 1}` } });
    });
    const { resolveShortlink } = await import("../src/shortlinks.js");

    const expansion = await resolveShortlink("https://t.co/path?hop=0", { fetcher, maxRedirects: 2 });

    expect(expansion).toMatchObject({ status: "unresolved", reason: "redirect_limit", redirectCount: 2 });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("falls back to a bounded GET when HEAD does not reveal a redirect", async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "https://t.co/get-only" && init?.method === "HEAD") {
        return new Response(null, { status: 200 });
      }
      if (url === "https://t.co/get-only" && init?.method === "GET") {
        return new Response(null, { status: 302, headers: { location: "https://example.com/tool" } });
      }
      return new Response(null, { status: 200 });
    });
    const { resolveShortlink } = await import("../src/shortlinks.js");

    const expansion = await resolveShortlink("https://t.co/get-only", { fetcher });

    expect(expansion).toMatchObject({ status: "resolved", expandedUrl: "https://example.com/tool" });
    expect(fetcher.mock.calls.map(([, init]) => init?.method)).toEqual(["HEAD", "GET", "HEAD", "GET"]);
  });

  it("does not claim landing-page aggregators are redirect shorteners", async () => {
    const { findShortlinkUrls } = await import("../src/shortlinks.js");

    expect(findShortlinkUrls({
      ...baseExtract,
      caption: "Profile: https://linktr.ee/example and https://lnk.bio/example",
    })).toEqual([]);
  });

  it("adds resolved destinations to extraction evidence while keeping failures retryable", async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url === "https://t.co/abc123") {
        return new Response(null, { status: 302, headers: { location: "https://github.com/acme/tool" } });
      }
      if (url === "https://github.com/acme/tool") return new Response(null, { status: 200 });
      throw new Error("network unavailable");
    });
    const { expandShortlinksInExtract } = await import("../src/shortlinks.js");

    const result = await expandShortlinksInExtract({
      ...baseExtract,
      transcript: "Backup: https://bit.ly/unavailable",
    }, { fetcher });

    expect(result.source_links).toContain("https://github.com/acme/tool");
    expect(result.extraction_methods).toContain("shortlink:resolved");
    expect(result.shortlink_expansions).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceUrl: "https://t.co/abc123", finalHost: "github.com", status: "resolved" }),
      expect.objectContaining({ sourceUrl: "https://bit.ly/unavailable", status: "unresolved", reason: "network_error" }),
    ]));
    expect(result.extraction_warnings).toContain("Shortlink unresolved (network_error): https://bit.ly/unavailable");
  });
});
