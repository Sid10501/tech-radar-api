import { describe, expect, it, vi } from "vitest";
import { canonicalizeSocialUrl, classifySocialVideo } from "../src/socialVideoRouting.js";

const baseExtract = {
  url: "https://example.com/video",
  platform: "other" as const,
  status: "ok" as const,
  error: null,
  title: "A useful clip",
  creator: "creator",
  caption: "A general workflow",
  hashtags: [],
  duration_sec: 20,
  transcript: "General discussion",
  transcript_source: "whisper" as const,
  visual_text: null,
  visual_text_source: null,
  upload_date: null,
  raw_metadata_keys: [],
};

describe("canonicalizeSocialUrl", () => {
  it("deduplicates equivalent YouTube and tracking URLs", () => {
    expect(canonicalizeSocialUrl("https://youtu.be/AbC123?si=tracker&t=9")).toBe("https://www.youtube.com/watch?v=AbC123");
    expect(canonicalizeSocialUrl("https://www.youtube.com/watch?v=AbC123&utm_source=x&t=9")).toBe("https://www.youtube.com/watch?v=AbC123");
  });

  it("normalizes host, default port, fragments and tracking parameters", () => {
    expect(canonicalizeSocialUrl("HTTPS://Example.COM:443/video/?utm_source=x&b=2&a=1#frag"))
      .toBe("https://example.com/video?a=1&b=2");
  });
});

describe("classifySocialVideo", () => {
  it("honors explicit technology and finance intent without calling the model", async () => {
    const fallback = vi.fn();
    await expect(classifySocialVideo(baseExtract, "technology", fallback)).resolves.toMatchObject({ category: "technology", confidence: 1 });
    await expect(classifySocialVideo(baseExtract, "finance", fallback)).resolves.toMatchObject({ category: "finance", confidence: 1 });
    expect(fallback).not.toHaveBeenCalled();
  });

  it("classifies deterministic finance, technology, and mixed signals first", async () => {
    const fallback = vi.fn();
    await expect(classifySocialVideo({ ...baseExtract, transcript: "$NVDA earnings price target buy shares" }, "auto", fallback))
      .resolves.toMatchObject({ category: "finance" });
    await expect(classifySocialVideo({ ...baseExtract, transcript: "open source GitHub SDK API framework" }, "auto", fallback))
      .resolves.toMatchObject({ category: "technology" });
    await expect(classifySocialVideo({ ...baseExtract, transcript: "$NVDA trading model open source GitHub SDK" }, "auto", fallback))
      .resolves.toMatchObject({ category: "mixed" });
    expect(fallback).not.toHaveBeenCalled();
  });

  it("uses an injectable model only when deterministic signals are inconclusive", async () => {
    const fallback = vi.fn(async () => ({ category: "needs_review" as const, confidence: 0.4, reasons: ["ambiguous"] }));
    await expect(classifySocialVideo(baseExtract, "auto", fallback)).resolves.toMatchObject({ category: "needs_review" });
    expect(fallback).toHaveBeenCalledOnce();
  });
});
