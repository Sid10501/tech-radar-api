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
});
