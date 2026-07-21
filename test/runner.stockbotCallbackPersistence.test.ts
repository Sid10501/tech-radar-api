import { afterEach, describe, expect, it, vi } from "vitest";

const gitMocks = vi.hoisted(() => ({
  options: [] as Array<Record<string, unknown>>,
  setupSshKey: vi.fn(() => "/tmp/callback-deploy-key"),
}));

vi.mock("../src/git.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/git.js")>();
  return {
    ...actual,
    setupSshKey: gitMocks.setupSshKey,
    AiMemoryRepo: class {
      constructor(options: Record<string, unknown>) { gitMocks.options.push(options); }
      async init() {}
      async pullLatest() {}
      async updateInbox() {}
      async commitAndPush() {}
    },
  };
});

import { applyStockBotCompletion, registerPipelineRun } from "../src/runner.js";

describe("StockBot callback persistence", () => {
  afterEach(() => {
    delete process.env["AI_MEMORY_REPO"];
    delete process.env["AI_MEMORY_LOCAL_DIR"];
    delete process.env["GIT_DEPLOY_KEY_B64"];
    gitMocks.options.length = 0;
    gitMocks.setupSshKey.mockClear();
  });

  it("configures the callback checkout with the deploy key", async () => {
    process.env["AI_MEMORY_REPO"] = "git@github.com:example/ai-memory.git";
    process.env["AI_MEMORY_LOCAL_DIR"] = "/tmp/callback-ai-memory";
    process.env["GIT_DEPLOY_KEY_B64"] = Buffer.from("private key").toString("base64");
    const run = registerPipelineRun(`https://youtu.be/callback-key-${Date.now()}`, { intent: "finance" });
    run.downstreamAnalysisId = "callback-key-analysis";
    run.status = "downstream_pending";

    await applyStockBotCompletion({
      eventId: "callback-key-event",
      runId: run.id,
      analysisId: "callback-key-analysis",
      status: "completed",
      detailUrl: null,
      results: [],
      error: null,
    });

    expect(gitMocks.setupSshKey).toHaveBeenCalledWith(process.env["GIT_DEPLOY_KEY_B64"]);
    expect(gitMocks.options).toContainEqual(expect.objectContaining({ sshKeyPath: "/tmp/callback-deploy-key" }));
  });
});
