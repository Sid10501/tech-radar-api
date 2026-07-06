import { randomUUID } from "node:crypto";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { extract } from "./extract.js";
import { runResearch } from "./agents/research.js";
import { runImplementation } from "./agents/implementation.js";
import { composeFinding } from "./compose.js";
import { AiMemoryRepo, setupSshKey } from "./git.js";
import type { AiMemoryRepoOptions } from "./git.js";
import { enrichLinksFromExtract } from "./linkEnrichment.js";
import { extractTextWithVision } from "./visionOcr.js";
import type { ExtractResult } from "./extract.js";
import { childArtifactInboxRows } from "./lib/linkedArtifactIntake.js";

export interface Run {
  id: string;
  url: string;
  status: "pending" | "running" | "processed" | "failed" | "skipped";
  findingPath?: string;
  error?: string;
  startedAt: string;
  finishedAt?: string;
}

export interface RunPipelineOptions {
  remoteUrl?: string;
  localDir?: string;
  aiMemoryDir?: string;
  force?: boolean;
}

function sendTelegram(text: string): void {
  const token = process.env["TELEGRAM_BOT_TOKEN"];
  const chatId = process.env["TELEGRAM_CHAT_ID"];
  if (!token || !chatId) return;
  const body = JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" });
  const req = https.request({
    hostname: "api.telegram.org",
    path: `/bot${token}/sendMessage`,
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
  });
  req.on("error", () => {}); // fire-and-forget
  req.write(body);
  req.end();
}

// In-memory run store (last 50)
const runs = new Map<string, Run>();

export function hydrateRunsFromInbox(inboxPath: string): void {
  if (!fs.existsSync(inboxPath)) return;
  const content = fs.readFileSync(inboxPath, "utf8");
  const rows = content
    .split("\n")
    .filter((l) => l.startsWith("|") && !l.startsWith("| Date") && !l.startsWith("|---") && !l.includes("<!-- "));

  for (const row of rows) {
    const cols = row.split("|").map((c) => c.trim()).filter((_, i) => i > 0 && i < 6);
    const [date, url, status, finding, error] = cols;
    if (!url || !status) continue;
    const validStatus = ["pending", "running", "processed", "failed", "skipped"].includes(status)
      ? (status as Run["status"])
      : "processed";
    const run: Run = {
      id: randomUUID(),
      url,
      status: validStatus,
      startedAt: date ? `${date}T00:00:00.000Z` : new Date().toISOString(),
      findingPath: finding ? `tech-radar/findings/${finding}` : undefined,
      error: error || undefined,
    };
    storeRun(run);
  }
}

function storeRun(run: Run): void {
  runs.set(run.id, run);
  if (runs.size > 50) {
    const oldest = runs.keys().next().value!;
    runs.delete(oldest);
  }
}

async function withVisionFallback(extractResult: ExtractResult): Promise<ExtractResult> {
  if (extractResult.visual_text?.trim()) return extractResult;
  const imagePaths = (extractResult.media_assets ?? [])
    .filter((asset) => (asset.type === "image" || asset.type === "screenshot") && asset.path)
    .map((asset) => asset.path!)
    .slice(0, 4);
  if (imagePaths.length === 0) return extractResult;

  const vision = await extractTextWithVision(imagePaths);
  const warnings = [...(extractResult.extraction_warnings ?? [])];
  if (vision.warning) warnings.push(vision.warning);
  if (!vision.text) {
    return warnings.length ? { ...extractResult, extraction_warnings: warnings } : extractResult;
  }
  return {
    ...extractResult,
    visual_text: vision.text,
    visual_text_source: "vision_ocr",
    extraction_warnings: warnings,
  };
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

export function findRunByUrl(url: string): Run | undefined {
  for (const run of runs.values()) {
    if (run.url === url) return run;
  }
  return undefined;
}

export class DuplicateRunError extends Error {
  constructor(public readonly existingRun: Run) {
    super(`URL already ${existingRun.status}: ${existingRun.url}`);
    this.name = "DuplicateRunError";
  }
}

export async function runPipeline(
  url: string,
  opts: RunPipelineOptions = {},
): Promise<{ runId: string; findingPath: string }> {
  if (!opts.force) {
    const existing = findRunByUrl(url);
    if (existing && (existing.status === "pending" || existing.status === "running" || existing.status === "processed")) {
      throw new DuplicateRunError(existing);
    }
  }

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

    // Bail early if the post has no usable content — skip agents entirely
    const hasContent = (extractResult.caption && extractResult.caption.trim()) ||
                       (extractResult.transcript && extractResult.transcript.trim()) ||
                       (extractResult.visual_text && extractResult.visual_text.trim());
    if (extractResult.status === "failed" || !hasContent) {
      const skipReason = extractResult.status === "failed"
        ? (extractResult.error ?? "extract failed")
        : "no caption, transcript, or visual text";
      await repo.updateInbox({ url, status: "skipped", finding: null, date: today, error: skipReason });
      await repo.commitAndPush(`tech-radar: skipped ${url.slice(0, 60)}`);

      run.status = "skipped";
      run.error = skipReason;
      run.finishedAt = new Date().toISOString();
      storeRun(run);

      sendTelegram(`⏭️ *Skipped* (${skipReason}):\n${url.slice(0, 80)}`);
      releaseSlot();
      return { runId, findingPath: "" };
    }

    const visionEnhancedExtract = await withVisionFallback(extractResult);
    const enrichedExtract = {
      ...visionEnhancedExtract,
      enriched_links: await enrichLinksFromExtract(visionEnhancedExtract),
    };

    // Step 2: Research
    const researchResult = await runResearch(enrichedExtract);

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
      extract: enrichedExtract,
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
    let childCount = 0;
    for (const row of childArtifactInboxRows(extractResult, { date: today, parentFinding: filename })) {
      if (await repo.updateInboxIfMissing(row)) childCount++;
    }
    await repo.commitAndPush(`tech-radar: ${filename.replace(".md", "")} — ${today}`);

    const findingPath = `tech-radar/findings/${filename}`;

    run.status = "processed";
    run.findingPath = findingPath;
    run.finishedAt = new Date().toISOString();
    storeRun(run);

    const repoUrl = process.env["AI_MEMORY_REPO_URL"] ?? "";
    const fileLink = repoUrl ? `${repoUrl}/blob/master/${findingPath}` : findingPath;
    const childNote = childCount > 0 ? `\nQueued child artifacts: ${childCount}` : "";
    sendTelegram(`✅ *Tech Radar finding ready*\n\n[${filename.replace(".md", "")}](${fileLink})\n\nSource: ${url.slice(0, 60)}${childNote}`);

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

    sendTelegram(`❌ *Tech Radar run failed*\n\n${url.slice(0, 80)}\n\nError: \`${(run.error ?? "unknown").slice(0, 200)}\``);

    releaseSlot();
    throw err;
  }
}
