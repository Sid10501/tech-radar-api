import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { extract } from "./extract.js";
import { runResearch } from "./agents/research.js";
import { runImplementation } from "./agents/implementation.js";
import { composeFinding } from "./compose.js";
import { AiMemoryRepo, setupSshKey } from "./git.js";
import type { AiMemoryRepoOptions } from "./git.js";

export interface Run {
  id: string;
  url: string;
  status: "pending" | "running" | "processed" | "failed";
  findingPath?: string;
  error?: string;
  startedAt: string;
  finishedAt?: string;
}

export interface RunPipelineOptions {
  remoteUrl?: string;
  localDir?: string;
  aiMemoryDir?: string;
}

// In-memory run store (last 50)
const runs = new Map<string, Run>();

function storeRun(run: Run): void {
  runs.set(run.id, run);
  if (runs.size > 50) {
    const oldest = runs.keys().next().value!;
    runs.delete(oldest);
  }
}

// Single-slot queue: only one pipeline run at a time (git pushes must serialize)
let running = false;
const queue: Array<() => void> = [];

async function acquireSlot(): Promise<void> {
  if (!running) {
    running = true;
    return;
  }
  return new Promise((resolve) => queue.push(resolve));
}

function releaseSlot(): void {
  const next = queue.shift();
  if (next) {
    next();
  } else {
    running = false;
  }
}

export function getRun(runId: string): Run | undefined {
  return runs.get(runId);
}

export function listRuns(): Run[] {
  return Array.from(runs.values()).reverse();
}

export async function runPipeline(
  url: string,
  opts: RunPipelineOptions = {},
): Promise<{ runId: string; findingPath: string }> {
  const runId = randomUUID();
  const now = new Date().toISOString();

  const run: Run = {
    id: runId,
    url,
    status: "pending",
    startedAt: now,
  };
  storeRun(run);

  await acquireSlot();
  run.status = "running";
  storeRun(run);

  const remoteUrl = opts.remoteUrl ?? process.env["AI_MEMORY_REPO"] ?? "";
  const localDir = opts.localDir ?? `/tmp/ai-memory-${runId}`;
  const configuredAiMemoryDir = opts.aiMemoryDir ?? process.env["AI_MEMORY_LOCAL_DIR"];

  // Set up SSH key if provided
  let sshKeyPath: string | undefined;
  const deployKeyB64 = process.env["GIT_DEPLOY_KEY_B64"];
  if (deployKeyB64) {
    sshKeyPath = setupSshKey(deployKeyB64);
  }

  const repoOpts: AiMemoryRepoOptions = {
    remoteUrl,
    localDir,
    gitAuthor: { name: "Tech Radar Bot", email: "bot@tech-radar.local" },
    sshKeyPath,
  };

  const repo = new AiMemoryRepo(repoOpts);

  try {
    await repo.init();
    await repo.pullLatest();

    const today = new Date().toISOString().slice(0, 10);

    // Write pending inbox row immediately
    await repo.updateInbox({ url, status: "pending", finding: null, date: today });
    await repo.commitAndPush(`tech-radar: pending ${url.slice(0, 60)}`);

    // Step 1: Extract
    const extractResult = await extract(url);

    // Step 2: Research
    const researchResult = await runResearch(extractResult);

    // Step 3: Implementation
    const implementationMemoryDir =
      configuredAiMemoryDir &&
      fs.existsSync(path.join(configuredAiMemoryDir, "GLOBAL_MEMORY.md"))
        ? configuredAiMemoryDir
        : localDir;

    const implementationResult = await runImplementation(
      extractResult,
      researchResult,
      implementationMemoryDir,
    );

    // Step 4: Compose
    const { filename, body } = composeFinding({
      extract: extractResult,
      research: researchResult,
      implementation: implementationResult,
    });

    // Step 5: Write to git
    await repo.writeFinding(filename, body);
    await repo.updateInbox({ url, status: "processed", finding: filename, date: today });
    await repo.updateIndex({
      date: today,
      title: extractResult.title ?? filename,
      finding: filename,
      targetProject: implementationResult.target_project,
    });
    await repo.commitAndPush(`tech-radar: ${filename.replace(".md", "")} — ${today}`);

    const findingPath = `tech-radar/findings/${filename}`;

    run.status = "processed";
    run.findingPath = findingPath;
    run.finishedAt = new Date().toISOString();
    storeRun(run);

    releaseSlot();
    return { runId, findingPath };

  } catch (err) {
    run.status = "failed";
    run.error = err instanceof Error ? err.message : String(err);
    run.finishedAt = new Date().toISOString();
    storeRun(run);

    // Best-effort: try to mark inbox as failed
    try {
      const today = new Date().toISOString().slice(0, 10);
      await repo.updateInbox({ url, status: "failed", finding: null, date: today, error: run.error });
      await repo.commitAndPush(`tech-radar: failed ${url.slice(0, 60)}`);
    } catch {
      // ignore secondary errors
    }

    releaseSlot();
    throw err;
  }
}
