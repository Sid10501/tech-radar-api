import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURE_DIR = path.resolve(
  fileURLToPath(import.meta.url),
  "../fixtures/ai_memory_min"
);

// --- ai_memory tool tests ---
describe("readAiMemory()", () => {
  it("reads GLOBAL_MEMORY.md from the fixture dir", async () => {
    const { readAiMemory } = await import("../src/tools/ai_memory.js");
    const content = await readAiMemory("GLOBAL_MEMORY.md", FIXTURE_DIR);
    expect(content).toContain("Cross-Tax");
    expect(content).toContain("StockBot");
  });

  it("reads a file from the domains/ subdir", async () => {
    const { readAiMemory } = await import("../src/tools/ai_memory.js");
    const content = await readAiMemory("domains/webdev.md", FIXTURE_DIR);
    expect(content).toContain("TypeScript");
  });

  it("throws if path tries to escape the whitelist", async () => {
    const { readAiMemory } = await import("../src/tools/ai_memory.js");
    await expect(readAiMemory("../../../etc/passwd", FIXTURE_DIR)).rejects.toThrow();
  });
});

describe("listRecentSessions()", () => {
  it("returns session filenames sorted newest-first", async () => {
    const { listRecentSessions } = await import("../src/tools/ai_memory.js");
    const sessions = await listRecentSessions(5, FIXTURE_DIR);
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions[0]).toContain("session");
  });
});

// --- github tool tests ---
describe("githubLookup()", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns repo metadata from the GitHub API", async () => {
    vi.mock("node:https", () => ({
      default: {
        get: vi.fn((_url: string, _opts: unknown, cb: (res: any) => void) => {
          const mockRes = {
            statusCode: 200,
            on: (event: string, handler: (chunk?: any) => void) => {
              if (event === "data") handler(JSON.stringify({
                stargazers_count: 1234,
                pushed_at: "2025-01-01T00:00:00Z",
                open_issues_count: 5,
                language: "TypeScript",
                license: { spdx_id: "MIT" },
                archived: false,
              }));
              if (event === "end") handler();
              return mockRes;
            },
          };
          cb(mockRes);
          return { on: vi.fn() };
        }),
      },
    }));

    const { githubLookup } = await import("../src/tools/github.js");
    const result = await githubLookup("anthropics/anthropic-sdk-python");
    expect(result.stars).toBe(1234);
    expect(result.language).toBe("TypeScript");
    expect(result.license).toBe("MIT");
  });
});
