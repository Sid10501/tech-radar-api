import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const FIXTURE_DIR = path.resolve(fileURLToPath(import.meta.url), "../../fixtures");

const extractFixture = JSON.parse(
  fs.readFileSync(path.join(FIXTURE_DIR, "extract_youtube.json"), "utf8"),
);

const researchFixture = {
  what: "Zod 4 is a TypeScript-first schema validation library.",
  who: "Colin McDonnell (@colinhacks)",
  status: "stable" as const,
  why: "Faster parsing, smaller bundle, better TypeScript inference.",
  comparisons: ["Valibot", "Yup"],
  links: { github: "https://github.com/colinhacks/zod", docs: "https://zod.dev", npm: null },
  kickstarter: "Install with npm install zod@^4.0.0.",
  viability_signals: { github_stars: 32000, last_pushed: "2026-04-01T00:00:00Z", open_issues: 42, license: "MIT", archived: false },
};

// Track which ai-memory files were read by the agent
let memoryFilesRead: string[] = [];

const CANNED_IMPLEMENTATION = {
  fit_for_sid: "Zod 4 is a direct upgrade for Cross-Tax, which already uses Zod 3 for API input validation.",
  target_project: "Cross-Tax",
  implementation_idea_markdown: "## Implementation Idea\n\nReplace Zod 3 with Zod 4 in Cross-Tax's API layer for a performance boost.\n\n```typescript\nimport { z } from 'zod';\n```\n",
  follow_ups: ["Check Cross-Tax's current Zod version", "Run migration script"],
};

describe("runImplementation()", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    memoryFilesRead = [];
  });

  it("reads GLOBAL_MEMORY.md and returns Zod-valid ImplementationOutput with a known target_project", async () => {
    vi.mock("@anthropic-ai/sdk", () => {
      const mockCreate = vi.fn();

      // First call: agent reads GLOBAL_MEMORY.md via list_recent_sessions then read_ai_memory
      mockCreate.mockResolvedValueOnce({
        id: "msg_1",
        type: "message",
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "tool_1",
            name: "read_ai_memory",
            input: { path: "GLOBAL_MEMORY.md" },
          },
        ],
        stop_reason: "tool_use",
        usage: { input_tokens: 500, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      });

      // Second call: final JSON response
      mockCreate.mockResolvedValueOnce({
        id: "msg_2",
        type: "message",
        role: "assistant",
        content: [
          {
            type: "text",
            text: JSON.stringify(CANNED_IMPLEMENTATION),
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

    // Mock ai_memory tools — track reads
    vi.mock("../../src/tools/ai_memory.js", () => ({
      readAiMemory: vi.fn(async (filePath: string, _memoryDir?: string) => {
        memoryFilesRead.push(filePath);
        if (filePath === "GLOBAL_MEMORY.md") {
          return "# Global Memory\nProjects: Cross-Tax, StockBot, Finance Assistant\n";
        }
        return "# Domain\nTypeScript, React, Fastify\n";
      }),
      listRecentSessions: vi.fn(async () => ["2026-04-28-test-session.md"]),
    }));

    const { runImplementation } = await import("../../src/agents/implementation.js");
    const result = await runImplementation(extractFixture, researchFixture, FIXTURE_DIR);

    // Must have read GLOBAL_MEMORY.md
    expect(memoryFilesRead).toContain("GLOBAL_MEMORY.md");

    // Output must parse against ImplementationOutputSchema
    expect(result.fit_for_sid).toBeTruthy();
    expect(["Cross-Tax", "StockBot", "Finance Assistant", "new project", "none"]).toContain(result.target_project);
    expect(result.implementation_idea_markdown).toBeTruthy();
    expect(Array.isArray(result.follow_ups)).toBe(true);
  });
});
