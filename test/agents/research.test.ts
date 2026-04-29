import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const FIXTURE_DIR = path.resolve(fileURLToPath(import.meta.url), "../../fixtures");

// Load canned extract result
const extractFixture = JSON.parse(
  fs.readFileSync(path.join(FIXTURE_DIR, "extract_youtube.json"), "utf8"),
);

// Canned research output the mock will return
const CANNED_RESEARCH = {
  what: "Zod 4 is a TypeScript-first schema validation library with improved performance and smaller bundle size.",
  who: "Colin McDonnell (@colinhacks)",
  status: "stable",
  why: "Zod 4 offers 14x faster parsing, tree-shakeable modules, and improved TypeScript inference over Zod 3.",
  comparisons: ["Valibot", "Yup", "io-ts"],
  links: {
    github: "https://github.com/colinhacks/zod",
    docs: "https://zod.dev",
    npm: "https://www.npmjs.com/package/zod",
  },
  kickstarter: "Install with `npm install zod@^4.0.0`. Import `z` and define schemas with `z.object({ ... })`.",
  viability_signals: {
    github_stars: 32000,
    last_pushed: "2026-04-01T00:00:00Z",
    open_issues: 42,
    license: "MIT",
    archived: false,
  },
};

// Track tool calls made during the run
let githubLookupCalls: string[] = [];

describe("runResearch()", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    githubLookupCalls = [];
  });

  it("calls github_lookup and returns Zod-valid ResearchOutput", async () => {
    // Mock @anthropic-ai/sdk to simulate an agent that calls github_lookup
    vi.mock("@anthropic-ai/sdk", () => {
      const mockCreate = vi.fn();

      // First call: Claude returns a tool_use for github_lookup
      mockCreate.mockResolvedValueOnce({
        id: "msg_1",
        type: "message",
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "tool_1",
            name: "github_lookup",
            input: { repo: "colinhacks/zod" },
          },
        ],
        stop_reason: "tool_use",
        usage: { input_tokens: 500, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      });

      // Second call: Claude returns the final JSON text after seeing tool result
      mockCreate.mockResolvedValueOnce({
        id: "msg_2",
        type: "message",
        role: "assistant",
        content: [
          {
            type: "text",
            text: JSON.stringify(CANNED_RESEARCH),
          },
        ],
        stop_reason: "end_turn",
        usage: { input_tokens: 600, output_tokens: 200, cache_read_input_tokens: 400, cache_creation_input_tokens: 0 },
      });

      return {
        default: vi.fn().mockImplementation(() => ({
          messages: {
            create: mockCreate,
          },
        })),
      };
    });

    // Mock the github tool so we can track calls without hitting the real API
    vi.mock("../../src/tools/github.js", () => ({
      githubLookup: vi.fn(async (repo: string) => {
        githubLookupCalls.push(repo);
        return {
          stars: 32000,
          lastPushed: "2026-04-01T00:00:00Z",
          openIssues: 42,
          language: "TypeScript",
          license: "MIT",
          archived: false,
        };
      }),
    }));

    const { runResearch } = await import("../../src/agents/research.js");
    const result = await runResearch(extractFixture);

    // Agent must have triggered github_lookup
    expect(githubLookupCalls.length).toBeGreaterThan(0);

    // Output must match the ResearchOutput Zod schema
    expect(result.what).toBeTruthy();
    expect(result.who).toBeTruthy();
    expect(["stable", "alpha", "beta", "abandoned", "unknown"]).toContain(result.status);
    expect(Array.isArray(result.comparisons)).toBe(true);
    expect(result.links).toBeDefined();
    expect(result.kickstarter).toBeTruthy();
    expect(result.viability_signals).toBeDefined();
    expect(typeof result.viability_signals.github_stars).toBe("number");
  });
});
