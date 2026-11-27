import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const FIXTURE_DIR = path.resolve(fileURLToPath(import.meta.url), "../fixtures");

let bareDir: string;
let workDir: string;

function initBareRemote(): void {
  bareDir = fs.mkdtempSync(path.join(os.tmpdir(), "runner-bare-"));
  execFileSync("git", ["init", "--bare", bareDir]);

  // Clone it to seed an initial commit
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "runner-seed-"));
  execFileSync("git", ["-c", "init.defaultBranch=master", "init", workDir]);
  execFileSync("git", ["-C", workDir, "config", "user.email", "test@test.com"]);
  execFileSync("git", ["-C", workDir, "config", "user.name", "Test"]);
  fs.writeFileSync(path.join(workDir, "README.md"), "# ai-memory\n");
  fs.mkdirSync(path.join(workDir, "tech-radar", "findings"), { recursive: true });
  fs.writeFileSync(path.join(workDir, "tech-radar", "INBOX.md"),
    "# Tech Radar Inbox\n\n| Date | URL | Status | Finding |\n|---|---|---|---|\n");
  fs.writeFileSync(path.join(workDir, "tech-radar", "INDEX.md"),
    "# Tech Radar Index\n\n| Date | Title | Finding | Project |\n|---|---|---|---|\n");
  execFileSync("git", ["-C", workDir, "add", "."]);
  execFileSync("git", ["-C", workDir, "commit", "-m", "init"]);
  execFileSync("git", ["-C", workDir, "remote", "add", "origin", bareDir]);
  execFileSync("git", ["-C", workDir, "push", "-u", "origin", "master"]);
}

describe("runPipeline()", () => {
  beforeEach(() => {
    vi.resetModules();
    initBareRemote();
  });

  afterEach(() => {
    fs.rmSync(bareDir, { recursive: true, force: true });
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  it.each([
    { name: "complete source", capture: undefined, status: "processed" },
    { name: "incomplete carousel", capture: { kind: "enumerated", slides: [{ index: 1, status: "ocr", text: "Cover" }, { index: 2, status: "skipped", text: null }] }, status: "needs_review" },
    { name: "regressed retry", capture: undefined, status: "needs_review", preserve: true },
  ])("runs end-to-end for $name", async ({ capture, status, preserve }) => {
    const sourceUrl = "https://www.youtube.com/shorts/dQw4w9WgXcQ";
    const canonical = "# Reviewed\n\n**Source:** youtube · [Author](https://www.youtube.com/shorts/dQw4w9WgXcQ)\n\n## Source coverage\n\nOCR returned text for 2 of 2 listed media items.";
    const indexPath = "tech-radar/INDEX.md";
    if (preserve) {
      fs.writeFileSync(path.join(workDir, "tech-radar/findings/reviewed.md"), canonical);
      fs.appendFileSync(path.join(workDir, indexPath), "| 2026-07-06 | Reviewed | reviewed.md | Original project |\n");
      execFileSync("git", ["-C", workDir, "add", "."]);
      execFileSync("git", ["-C", workDir, "commit", "-m", "Seed reviewed finding"]);
      execFileSync("git", ["-C", workDir, "push"]);
    }
    const extractFixture = JSON.parse(
      fs.readFileSync(path.join(FIXTURE_DIR, "extract_youtube.json"), "utf8"),
    );

    let extractionOutDir = "";
    vi.doMock("../src/extract.js", () => ({
      extract: vi.fn(async (_url: string, options: { outDir?: string }) => {
        extractionOutDir = options.outDir!;
        fs.writeFileSync(path.join(extractionOutDir, "frame.jpg"), "temporary frame");
        return { ...extractFixture, instagram_capture: capture };
      }),
      ExtractError: class ExtractError extends Error {},
    }));

    const mockCreate = vi.fn();

    // Research agent: tool call then final answer
    mockCreate.mockResolvedValueOnce({
      id: "r1", type: "message", role: "assistant",
      content: [{ type: "tool_use", id: "t1", name: "github_lookup", input: { repo: "colinhacks/zod" } }],
      stop_reason: "tool_use",
      usage: { input_tokens: 500, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    });
    mockCreate.mockResolvedValueOnce({
      id: "r2", type: "message", role: "assistant",
      content: [{ type: "text", text: JSON.stringify({
        what: "Zod 4 is a TypeScript schema validation library.",
        who: "@colinhacks",
        status: "stable",
        why: "Faster and smaller than v3.",
        comparisons: ["Valibot"],
        links: { github: "https://github.com/colinhacks/zod", docs: null, npm: null },
        kickstarter: "npm install zod@^4",
        viability_signals: { github_stars: 32000, last_pushed: "2026-04-01T00:00:00Z", open_issues: 42, license: "MIT", archived: false },
      }) }],
      stop_reason: "end_turn",
      usage: { input_tokens: 600, output_tokens: 200, cache_read_input_tokens: 400, cache_creation_input_tokens: 0 },
    });

    // Implementation agent: reads GLOBAL_MEMORY.md then final answer
    mockCreate.mockResolvedValueOnce({
      id: "i1", type: "message", role: "assistant",
      content: [{ type: "tool_use", id: "t2", name: "read_ai_memory", input: { path: "GLOBAL_MEMORY.md" } }],
      stop_reason: "tool_use",
      usage: { input_tokens: 500, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    });
    mockCreate.mockResolvedValueOnce({
      id: "i2", type: "message", role: "assistant",
      content: [{ type: "text", text: JSON.stringify({
        fit_for_owner: "Good fit for Cross-Tax.",
        target_project: "Cross-Tax",
        implementation_idea_markdown: "Upgrade to Zod 4 in Cross-Tax.\n",
        follow_ups: ["Check current version"],
      }) }],
      stop_reason: "end_turn",
      usage: { input_tokens: 600, output_tokens: 200, cache_read_input_tokens: 400, cache_creation_input_tokens: 0 },
    });

    vi.doMock("@anthropic-ai/sdk", () => ({
      default: vi.fn().mockImplementation(function () { return {
        messages: { create: mockCreate },
      }; }),
    }));

    vi.doMock("../src/githubGrounding.js", () => ({
      lookupGithubGrounded: vi.fn(async (repo: string) => ({ repo,
        signals: { github_stars: 32000, last_pushed: "2026-04-01T00:00:00Z", open_issues: 42, license: "MIT", archived: false },
        evidence: { id: 'github-metadata', kind: 'metadata', url: `https://github.com/${repo}`, retrieved_at: '2026-09-12T00:00:00Z', published_at: null, excerpt: 'Metadata only' },
      })),
    }));

    vi.doMock("../src/tools/github.js", () => ({
      githubLookup: vi.fn(async () => ({
        stars: 32000, lastPushed: "2026-04-01T00:00:00Z",
        openIssues: 42, language: "TypeScript", license: "MIT", archived: false,
      })),
      githubSearchRepositories: vi.fn(async () => []),
    }));

    vi.doMock("../src/tools/ai_memory.js", async (importOriginal) => ({
      ...await importOriginal<typeof import("../src/tools/ai_memory.js")>(),
      readAiMemory: vi.fn(async (filePath: string) => {
        if (filePath === "GLOBAL_MEMORY.md") return "# Global Memory\nProjects: Cross-Tax\n";
        return "# domain\n";
      }),
      listRecentSessions: vi.fn(async () => []),
    }));

    const localDir = fs.mkdtempSync(path.join(os.tmpdir(), "runner-local-"));
    try {
      const { runPipeline, registerPipelineRun, getRun, listRuns } = await import("../src/runner.js");

      const { runId, findingPath } = await runPipeline(
        sourceUrl,
        {
          remoteUrl: bareDir,
          localDir,
          aiMemoryDir: FIXTURE_DIR,
        },
      );

      expect(runId).toBeTruthy();
      expect(findingPath).toContain("tech-radar/findings/");
      expect(findingPath).toMatch(/\.md$/);

      const run = getRun(runId);
      expect(run).toBeDefined();
      expect(run?.status).toBe(status);
      if (capture) {
        expect(registerPipelineRun(run!.url, { force: true }).status).toBe("pending");
      }

      const runs = listRuns();
      expect(runs.some((r) => r.id === runId)).toBe(true);

      const fullFindingPath = path.join(localDir, findingPath);
      expect(fs.existsSync(fullFindingPath)).toBe(true);
      const findingContent = fs.readFileSync(fullFindingPath, "utf8");
      const inbox = fs.readFileSync(path.join(localDir, "tech-radar", "INBOX.md"), "utf8");
      if (preserve) {
        expect(findingContent).toBe(canonical);
        expect(fs.readFileSync(path.join(localDir, indexPath), "utf8")).toBe(fs.readFileSync(path.join(workDir, indexPath), "utf8"));
        expect(inbox).toContain("Retry lost slide evidence");
        expect(inbox).not.toContain("child of");
        return;
      }
      expect(findingContent).toContain("## Implementation Idea");
      expect(inbox).toContain("| https://github.com/colinhacks/zod | pending |");
      expect(inbox).toContain("| https://zod.dev/ | pending |");
      expect(inbox).toContain(`child of ${path.basename(findingPath)}: github_repo`);
      expect(extractionOutDir).toBeTruthy();
      expect(fs.existsSync(extractionOutDir)).toBe(false);

    } finally {
      fs.rmSync(localDir, { recursive: true, force: true });
    }
  });

  it.each([
    { financeSuccess: false, status: "failed", expected: "Technology branch failed (insufficient provider credits); StockBot handoff failed (HTTP 503)" },
    { financeSuccess: true, status: "partial", expected: "Technology branch failed (insufficient provider credits)" },
  ])("persists safe branch evidence in the inbox for a $status mixed run", async ({ financeSuccess, status, expected }) => {
    const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, "extract_youtube.json"), "utf8"));
    const sourceUrl = `https://www.instagram.com/p/mixed-${status}/`;
    vi.doMock("../src/extract.js", () => ({ extract: async () => ({ ...fixture, url: sourceUrl,
      title: "AI agent for stock market investing", source_links: [], linked_artifacts: [] }) }));
    vi.doMock("../src/linkEnrichment.js", () => ({ enrichLinksFromExtract: async () => ({ confirmed: {}, candidates: [], warnings: [], github: null }) }));
    vi.doMock("../src/agents/research.js", () => ({ runResearch: async () => {
      throw new Error('400 {"message":"Your credit balance is too low","authorization":"secret-test-value"}\nprivate provider details');
    } }));
    vi.doMock("../src/stockbotClient.js", () => ({ StockBotClient: class {
      async submitVideoEvidence() {
        if (!financeSuccess) throw new Error("StockBot returned HTTP 503");
        return { analysisId: "demo-analysis", status: "pending", deduplicated: false };
      }
    } }));
    const localDir = fs.mkdtempSync(path.join(os.tmpdir(), "runner-routed-error-"));
    try {
      const { runPipeline, getRun } = await import("../src/runner.js");
      const { runId } = await runPipeline(sourceUrl, { remoteUrl: bareDir, localDir, intent: "auto" });
      expect(getRun(runId)).toMatchObject({ status, error: expected });
      const inbox = fs.readFileSync(path.join(localDir, "tech-radar/INBOX.md"), "utf8");
      expect(inbox.split("\n").filter(line => line.includes(sourceUrl))).toEqual([expect.stringContaining(expected)]);
      expect(inbox).not.toMatch(/secret-test-value|private provider details|authorization/);
    } finally {
      vi.doUnmock("../src/linkEnrichment.js");
      vi.doUnmock("../src/agents/research.js");
      vi.doUnmock("../src/stockbotClient.js");
      fs.rmSync(localDir, { recursive: true, force: true });
    }
  });

  it("marks run as failed when extract throws", async () => {
    let failedOutDir = "";
    vi.doMock("../src/extract.js", () => ({
      extract: vi.fn(async (_url: string, options: { outDir?: string }) => {
        failedOutDir = options.outDir!;
        fs.writeFileSync(path.join(failedOutDir, "partial-frame.jpg"), "temporary frame");
        throw new Error("extract failed");
      }),
      ExtractError: class ExtractError extends Error {},
    }));

    // SDK mock to avoid import errors (not called in this test)
    vi.doMock("@anthropic-ai/sdk", () => ({
      default: vi.fn().mockImplementation(function () { return {
        messages: { create: vi.fn() },
      }; }),
    }));

    const localDir = fs.mkdtempSync(path.join(os.tmpdir(), "runner-fail-"));
    try {
      const { runPipeline, listRuns } = await import("../src/runner.js");

      await expect(
        runPipeline("https://bad.url/", { remoteUrl: bareDir, localDir }),
      ).rejects.toThrow("extract failed");
      expect(fs.existsSync(failedOutDir)).toBe(false);

      const runs = listRuns();
      const failed = runs.find((r) => r.status === "failed");
      expect(failed).toBeDefined();

    } finally {
      fs.rmSync(localDir, { recursive: true, force: true });
    }
  });

  it("marks run as skipped when extract returns status: failed", async () => {
    const extractFixture = JSON.parse(
      fs.readFileSync(path.join(FIXTURE_DIR, "extract_youtube.json"), "utf8"),
    );
    const failedExtract = { ...extractFixture, status: "failed", caption: null, transcript: null, error: "yt-dlp error: 403" };

    vi.doMock("../src/extract.js", () => ({
      extract: vi.fn(async () => failedExtract),
      ExtractError: class ExtractError extends Error {},
    }));

    vi.doMock("@anthropic-ai/sdk", () => ({
      default: vi.fn().mockImplementation(function () { return {
        messages: { create: vi.fn() },
      }; }),
    }));

    const localDir = fs.mkdtempSync(path.join(os.tmpdir(), "runner-skip1-"));
    try {
      const { runPipeline, listRuns } = await import("../src/runner.js");

      const result = await runPipeline(
        "https://www.instagram.com/reel/skip-test-1/",
        { remoteUrl: bareDir, localDir },
      );

      expect(result.runId).toBeTruthy();
      expect(result.findingPath).toBe("");

      const runs = listRuns();
      const skipped = runs.find((r) => r.url === "https://www.instagram.com/reel/skip-test-1/");
      expect(skipped?.status).toBe("skipped");
      expect(skipped?.error).toContain("yt-dlp error");
    } finally {
      fs.rmSync(localDir, { recursive: true, force: true });
    }
  });

  it("marks run as skipped when extract returns no caption and no transcript", async () => {
    const emptyExtract = {
      url: "https://www.instagram.com/reel/skip-test-2/",
      platform: "instagram",
      status: "partial",
      error: null,
      title: "Some post",
      creator: "someone",
      caption: null,
      hashtags: [],
      duration_sec: 30,
      transcript: null,
      transcript_source: null,
      upload_date: "2026-05-30",
      raw_metadata_keys: [],
    };

    vi.doMock("../src/extract.js", () => ({
      extract: vi.fn(async () => emptyExtract),
      ExtractError: class ExtractError extends Error {},
    }));

    vi.doMock("@anthropic-ai/sdk", () => ({
      default: vi.fn().mockImplementation(function () { return {
        messages: { create: vi.fn() },
      }; }),
    }));

    const localDir = fs.mkdtempSync(path.join(os.tmpdir(), "runner-skip2-"));
    try {
      const { runPipeline, listRuns } = await import("../src/runner.js");

      const result = await runPipeline(
        "https://www.instagram.com/reel/skip-test-2/",
        { remoteUrl: bareDir, localDir },
      );

      expect(result.findingPath).toBe("");

      const runs = listRuns();
      const skipped = runs.find((r) => r.url === "https://www.instagram.com/reel/skip-test-2/");
      expect(skipped?.status).toBe("skipped");
      expect(skipped?.error).toBe("no caption, transcript, or visual text");
    } finally {
      fs.rmSync(localDir, { recursive: true, force: true });
    }
  });

  it("continues when extract returns visual text but no caption or transcript", async () => {
    const visualOnlyExtract = {
      url: "https://www.instagram.com/reel/ocr-only/",
      platform: "instagram",
      status: "partial",
      error: null,
      title: "Visual-only tool demo",
      creator: "someone",
      caption: null,
      hashtags: [],
      duration_sec: 30,
      transcript: null,
      transcript_source: null,
      visual_text: "FrameAgent: automate video timeline edits with Claude",
      visual_text_source: "ocr",
      upload_date: "2026-06-21",
      raw_metadata_keys: [],
    };

    vi.doMock("../src/extract.js", () => ({
      extract: vi.fn(async () => visualOnlyExtract),
      ExtractError: class ExtractError extends Error {},
    }));

    const mockCreate = vi.fn();
    mockCreate.mockResolvedValueOnce({
      id: "r1", type: "message", role: "assistant",
      content: [{ type: "text", text: JSON.stringify({
        what: "FrameAgent automates video timeline edits.",
        who: "unknown",
        status: "unknown",
        why: "It captures a tool name that only appears in the video frame.",
        comparisons: [],
        links: { github: null, docs: null, npm: null },
        kickstarter: "Find the repo before evaluating.",
        viability_signals: { github_stars: 0, last_pushed: null, open_issues: 0, license: null, archived: false },
      }) }],
      stop_reason: "end_turn",
      usage: { input_tokens: 100, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    });
    mockCreate.mockResolvedValueOnce({
      id: "i1", type: "message", role: "assistant",
      content: [{ type: "text", text: JSON.stringify({
        fit_for_owner: "Potential fit, pending source validation.",
        target_project: "tech-radar-api",
        implementation_idea_markdown: "Use OCR text as a low-confidence extraction signal.",
        follow_ups: ["Verify the source repo"],
      }) }],
      stop_reason: "end_turn",
      usage: { input_tokens: 100, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    });

    vi.doMock("@anthropic-ai/sdk", () => ({
      default: vi.fn().mockImplementation(function () { return {
        messages: { create: mockCreate },
      }; }),
    }));

    vi.doMock("../src/tools/ai_memory.js", async (importOriginal) => ({
      ...await importOriginal<typeof import("../src/tools/ai_memory.js")>(),
      readAiMemory: vi.fn(async () => "# memory\n"),
      listRecentSessions: vi.fn(async () => []),
    }));

    const localDir = fs.mkdtempSync(path.join(os.tmpdir(), "runner-ocr-"));
    try {
      const { runPipeline, listRuns } = await import("../src/runner.js");

      const result = await runPipeline(
        "https://www.instagram.com/reel/ocr-only/",
        {
          remoteUrl: bareDir,
          localDir,
          aiMemoryDir: FIXTURE_DIR,
        },
      );

      expect(result.findingPath).toContain("tech-radar/findings/");

      const runs = listRuns();
      const processed = runs.find((r) => r.url === "https://www.instagram.com/reel/ocr-only/");
      expect(processed?.status).toBe("processed");
    } finally {
      fs.rmSync(localDir, { recursive: true, force: true });
    }
  });

  it("enriches extracted links before research runs", async () => {
    const extractResult = {
      url: "https://www.instagram.com/p/repo-visible/",
      platform: "instagram",
      status: "ok",
      error: null,
      title: "Palmier carousel",
      creator: "uncover.ai",
      caption: "Palmier is open source.",
      hashtags: [],
      duration_sec: null,
      transcript: null,
      transcript_source: null,
      visual_text: "Repo: https://github.com/marcosricopeng/palmier",
      visual_text_source: "ocr",
      upload_date: "2026-06-19",
      raw_metadata_keys: [],
    };
    const enrichedLinks = {
      confirmed: { github: "https://github.com/marcosricopeng/palmier", docs: null, npm: null },
      candidates: [{ kind: "github", url: "https://github.com/marcosricopeng/palmier", source: "visual_text", confidence: "confirmed" }],
      warnings: [],
    };
    let researchExtract: any;

    vi.doMock("../src/extract.js", () => ({
      extract: vi.fn(async () => extractResult),
      ExtractError: class ExtractError extends Error {},
    }));
    vi.doMock("../src/linkEnrichment.js", () => ({
      enrichLinksFromExtract: vi.fn(async () => enrichedLinks),
    }));
    vi.doMock("../src/agents/research.js", () => ({
      runResearch: vi.fn(async (extract: any) => {
        researchExtract = extract;
        return {
          what: "Palmier is a local AI video editor.",
          who: "Marcos Rico Peng",
          status: "unknown",
          why: "It exposes timeline editing through Claude.",
          comparisons: [],
          links: { github: "https://github.com/marcosricopeng/palmier", docs: null, npm: null },
          kickstarter: "Clone the repo and test the macOS app.",
          viability_signals: { github_stars: 42, last_pushed: "2026-06-20T00:00:00Z", open_issues: 2, license: "MIT", archived: false },
        };
      }),
    }));
    vi.doMock("../src/agents/implementation.js", () => ({
      runImplementation: vi.fn(async () => ({
        fit_for_owner: "Good fit for tech-radar-api media enrichment validation.",
        target_project: "tech-radar-api",
        implementation_idea_markdown: "Use this as a regression fixture for carousel OCR.",
        follow_ups: ["Verify the repo still exists"],
      })),
    }));

    const localDir = fs.mkdtempSync(path.join(os.tmpdir(), "runner-enrich-"));
    try {
      const { runPipeline } = await import("../src/runner.js");

      await runPipeline("https://www.instagram.com/p/repo-visible/", {
        remoteUrl: bareDir,
        localDir,
        aiMemoryDir: FIXTURE_DIR,
      });

      expect(researchExtract.enriched_links).toEqual(enrichedLinks);
    } finally {
      fs.rmSync(localDir, { recursive: true, force: true });
    }
  });

  it("uses vision OCR fallback before research when media images have no OCR text", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const extractResult = {
      url: "https://www.instagram.com/p/vision-fallback/",
      platform: "instagram",
      status: "partial",
      error: null,
      title: "Carousel with visible repo",
      creator: "uncover.ai",
      caption: "New video editor.",
      hashtags: [],
      duration_sec: null,
      transcript: null,
      transcript_source: null,
      visual_text: null,
      visual_text_source: null,
      upload_date: "2026-06-19",
      raw_metadata_keys: [],
      media_assets: [{ type: "image", source: "metadata", path: "/tmp/post.png", url: null, ocr_text: null, confidence: "medium" }],
    };
    let researchExtract: any;

    vi.doMock("../src/extract.js", () => ({
      extract: vi.fn(async () => extractResult),
      ExtractError: class ExtractError extends Error {},
    }));
    vi.doMock("../src/visionOcr.js", () => ({
      extractTextWithVision: vi.fn(async () => ({
        text: "Repo: https://github.com/marcosricopeng/palmier",
        warning: null,
      })),
    }));
    vi.doMock("../src/linkEnrichment.js", () => ({
      enrichLinksFromExtract: vi.fn(async (extract: any) => ({
        confirmed: { github: extract.visual_text?.includes("github.com") ? "https://github.com/marcosricopeng/palmier" : null, docs: null, npm: null },
        candidates: [],
        warnings: [],
      })),
    }));
    vi.doMock("../src/agents/research.js", () => ({
      runResearch: vi.fn(async (extract: any) => {
        researchExtract = extract;
        return {
          what: "Palmier is a local AI video editor.",
          who: "Marcos Rico Peng",
          status: "unknown",
          why: "It exposes timeline editing through Claude.",
          comparisons: [],
          links: { github: "https://github.com/marcosricopeng/palmier", docs: null, npm: null },
          kickstarter: "Clone the repo.",
          viability_signals: { github_stars: 42, last_pushed: "2026-06-20T00:00:00Z", open_issues: 2, license: "MIT", archived: false },
        };
      }),
    }));
    vi.doMock("../src/agents/implementation.js", () => ({
      runImplementation: vi.fn(async () => ({
        fit_for_owner: "Good fit for tech-radar-api media enrichment validation.",
        target_project: "tech-radar-api",
        implementation_idea_markdown: "Use this as a regression fixture for vision OCR.",
        follow_ups: ["Verify the repo still exists"],
      })),
    }));

    const localDir = fs.mkdtempSync(path.join(os.tmpdir(), "runner-vision-"));
    try {
      const { runPipeline } = await import("../src/runner.js");

      await runPipeline("https://www.instagram.com/p/vision-fallback/", {
        remoteUrl: bareDir,
        localDir,
        aiMemoryDir: FIXTURE_DIR,
      });

      expect(researchExtract.visual_text).toContain("marcosricopeng/palmier");
      expect(researchExtract.visual_text_source).toBe("vision_ocr");
    } finally {
      fs.rmSync(localDir, { recursive: true, force: true });
    }
  });
});
