import { describe, expect, it, vi } from "vitest";

describe("vision OCR fallback", () => {
  it("skips when OPENAI_API_KEY is not configured", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const { extractTextWithVision } = await import("../src/visionOcr.js");

    await expect(extractTextWithVision(["/tmp/missing.png"])).resolves.toEqual({
      text: null,
      warning: "vision OCR skipped: OPENAI_API_KEY not configured",
    });
  });

  it("parses Responses API text from a mocked transport", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const { extractTextWithVision } = await import("../src/visionOcr.js");

    const result = await extractTextWithVision(
      [Buffer.from("fake-image")],
      async (_body) => ({
        output: [
          {
            content: [
              { type: "output_text", text: "Repo: github.com/marcosricopeng/palmier" },
            ],
          },
        ],
      }),
    );

    expect(result).toEqual({
      text: "Repo: github.com/marcosricopeng/palmier",
      warning: null,
    });
  });

  it("includes up to eight sampled frames by default", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("OPENAI_VISION_MAX_IMAGES", "");
    const { extractTextWithVision } = await import("../src/visionOcr.js");
    let requestBody: Record<string, unknown> | undefined;

    await extractTextWithVision(
      Array.from({ length: 10 }, (_, index) => Buffer.from(`frame-${index}`)),
      async (body) => {
        requestBody = body;
        return { output_text: "frames" };
      },
    );

    const input = requestBody?.input as Array<{ content: Array<{ type: string }> }>;
    expect(input[0]?.content.filter(({ type }) => type === "input_image")).toHaveLength(8);
  });
});
