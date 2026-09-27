import { afterEach, describe, expect, it, vi } from "vitest";
import { canonicalizeSocialUrl, classifySocialVideo } from "../src/socialVideoRouting.js";

const modelCreate = vi.hoisted(() => vi.fn());
vi.mock("@anthropic-ai/sdk", () => ({
  default: class { messages = { create: modelCreate }; },
}));
afterEach(() => { vi.unstubAllEnvs(); modelCreate.mockReset(); });

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

describe("router model output contract", () => {
  it("requests the complete classification schema and accepts validated structured output", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-only-key");
    modelCreate.mockResolvedValue({ stop_reason: "tool_use", content: [
      { type: "tool_use", id: "classification-1", name: "classify_social_video", input: { category: "other", confidence: 0.8, reasons: ["General discussion"] } },
    ] });
    const result = await classifySocialVideo(baseExtract);
    const request = modelCreate.mock.calls[0][0];
    expect(request.tool_choice).toEqual({ type: "tool", name: "classify_social_video" });
    expect(request.tools).toEqual([expect.objectContaining({
      name: "classify_social_video",
      input_schema: {
        type: "object",
        properties: {
          category: { type: "string", enum: ["technology", "finance", "mixed", "other", "needs_review"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          reasons: { type: "array", items: { type: "string", maxLength: 500 }, maxItems: 5 },
        },
        required: ["category", "confidence", "reasons"],
        additionalProperties: false,
      },
    })]);
    expect(result).toEqual({ category: "other", confidence: 0.8, reasons: ["General discussion"] });
    const evidence = JSON.parse(request.messages[0].content);
    expect(evidence.caption).toContain("UNTRUSTED");
    expect(evidence.caption).toContain("A general workflow");
  });

  it.each([
    { category: "technology" },
    { category: "technology", confidence: 2, reasons: [] },
    { category: "invalid", confidence: 0.8, reasons: [] },
    { category: "finance", confidence: 0.8, reasons: ["x".repeat(501)] },
  ])("keeps invalid model classifications in needs_review: %j", async (input) => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-only-key");
    modelCreate.mockResolvedValue({ stop_reason: "tool_use", content: [
      { type: "tool_use", id: "classification-1", name: "classify_social_video", input },
    ] });
    await expect(classifySocialVideo(baseExtract)).resolves.toEqual({ category: "needs_review", confidence: 0, reasons: ["router model returned invalid output"] });
  });

  it.each(["max_tokens", "end_turn"])("does not route an incomplete or missing tool response (%s)", async (stop_reason) => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-only-key");
    modelCreate.mockResolvedValue({ stop_reason, content: stop_reason === "max_tokens" ? [
      { type: "tool_use", id: "classification-1", name: "classify_social_video", input: { category: "finance", confidence: 1, reasons: [] } },
    ] : [
      { type: "text", text: '{"category":"finance","confidence":1,"reasons":[]}' },
    ] });
    await expect(classifySocialVideo(baseExtract)).resolves.toMatchObject({ category: "needs_review", confidence: 0 });
  });
});
