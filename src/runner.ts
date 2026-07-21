import { randomUUID } from "node:crypto";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { extract } from "./extract.js";
import { runResearch } from "./agents/research.js";
import { runImplementation } from "./agents/implementation.js";
import { composeFinding } from "./compose.js";
import { AiMemoryRepo, acquireAiMemoryRepoMutation, setupSshKey } from "./git.js";
import type { AiMemoryRepoOptions } from "./git.js";
import { enrichLinksFromExtract } from "./linkEnrichment.js";
import { extractTextWithVision } from "./visionOcr.js";
import type { ExtractResult } from "./extract.js";
import { childArtifactInboxRows } from "./lib/linkedArtifactIntake.js";
import {
  canonicalizeSocialUrl,
  classifySocialVideo,
  type SocialVideoClassification,
  type SocialVideoIntent,
  type SocialVideoModelClassifier,
} from "./socialVideoRouting.js";
import { SocialVideoEvidenceV1Schema, type SocialVideoEvidenceV1 } from "./schemas/socialVideoEvidence.js";
import { StockBotClient, type StockBotSubmission } from "./stockbotClient.js";
import { stockBotErrorText, type StockBotCompletionEvent } from "./stockbotCallback.js";
import { extractLocalMedia } from "./localMedia.js";

export interface Run {
  id: string;
  url: string;
  status: "pending" | "running" | "awaiting_media" | "downstream_pending" | "processed" | "partial" | "needs_review" | "failed" | "skipped";
  intent?: SocialVideoIntent;
  origin?: SocialVideoOrigin;
  findingPath?: string;
  generatedFindingPath?: string;
  replacedExistingFinding?: boolean;
  error?: string;
  startedAt: string;
  finishedAt?: string;
  downstreamAnalysisId?: string;
  downstreamStatus?: string;
  downstreamDetailUrl?: string;
  financeHandoffCompleted?: boolean;
  mediaPath?: string;
  evidenceIdempotencyKey?: string;
  classification?: SocialVideoClassification;
  processedBranches?: Array<"technology" | "finance">;
  extractionWorkDir?: string;
  submissionIdempotencyKey?: string;
  originalName?: string;
  deduplicatedToRunId?: string;
}

export interface SocialVideoOrigin {
  channel: "telegram" | "shortcut" | "dashboard" | "api";
  chatId?: string;
  messageId?: string;
}

export interface RunPipelineOptions {
  remoteUrl?: string;
  localDir?: string;
  aiMemoryDir?: string;
  force?: boolean;
  intent?: SocialVideoIntent;
  origin?: SocialVideoOrigin;
  classifier?: SocialVideoModelClassifier;
  idempotencyKey?: string;
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

// Complete working set; history endpoints apply their own presentation cap.
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
    const validStatus = ["pending", "running", "awaiting_media", "downstream_pending", "processed", "partial", "needs_review", "failed", "skipped"].includes(status)
      ? (status as Run["status"])
      : "processed";
    const recoveredStatus = validStatus === "running" ? "pending" : validStatus;
    const persistedRunId = finding?.match(/(?:^|;)run:([A-Za-z0-9-]+)/)?.[1];
    const downstreamAnalysisId = finding?.match(/(?:^|;)stockbot:([^;|]+)/)?.[1];
    const persistedFinding = finding?.split(";").find((part) => part.endsWith(".md"));
    const inboxRun: Run = {
      id: persistedRunId ?? randomUUID(),
      url,
      status: recoveredStatus,
      startedAt: date ? `${date}T00:00:00.000Z` : new Date().toISOString(),
      findingPath: persistedFinding ? `tech-radar/findings/${persistedFinding}` : undefined,
      error: error || undefined,
      downstreamAnalysisId,
      downstreamStatus: downstreamAnalysisId ? recoveredStatus : undefined,
      financeHandoffCompleted: Boolean(downstreamAnalysisId),
    };
    let richer: Run | undefined;
    const stateDir = runStateDir();
    if (persistedRunId && stateDir) {
      try { richer = JSON.parse(fs.readFileSync(path.join(stateDir, `${persistedRunId}.json`), "utf8")) as Run; } catch { /* no durable record */ }
    }
    const existing = runs.get(inboxRun.id);
    storeRun({ ...inboxRun, ...richer, ...existing, error: existing?.error ?? richer?.error ?? inboxRun.error });
  }
}

function storeRun(run: Run): void {
  runs.set(run.id, run);
  const stateDir = runStateDir();
  if (stateDir) {
    fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    const target = path.join(stateDir, `${run.id}.json`);
    const temporary = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(run), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporary, target);
  }
}

function runStateDir(): string | undefined {
  if (process.env["RUN_STATE_DIR"]) return path.resolve(process.env["RUN_STATE_DIR"]);
  return process.env["NODE_ENV"] === "test" ? undefined : "/tmp/tech-radar-runs";
}

function extractionWorkRoot(): string {
  return path.resolve(process.env["EXTRACTION_WORK_ROOT"] ?? path.join(process.env["TMPDIR"] ?? "/tmp", "tech-radar-extraction"));
}

function safeRunPathPart(runId: string): string | undefined {
  return /^[A-Za-z0-9_-]{1,200}$/.test(runId) ? runId : undefined;
}

function removeManagedExtractionWorkDir(candidate: string, runId: string): void {
  const safeId = safeRunPathPart(runId);
  if (!safeId) return;
  const root = extractionWorkRoot();
  const resolved = path.resolve(candidate);
  if (path.dirname(resolved) !== root || !path.basename(resolved).startsWith(`tech-radar-extract-${safeId}-`)) return;
  try {
    const stat = fs.lstatSync(resolved);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return;
    if (path.dirname(fs.realpathSync(resolved)) !== fs.realpathSync(root)) return;
    fs.rmSync(resolved, { recursive: true, force: true });
  } catch { /* missing or untrusted path */ }
}

function removeOwnedMedia(mediaPath: string, runId: string): void {
  const mediaRoot = path.resolve(process.env["MEDIA_UPLOAD_DIR"] ?? "/tmp/tech-radar-media");
  const resolvedMedia = path.resolve(mediaPath);
  const sidecarPath = `${resolvedMedia}.run.json`;
  if (path.dirname(resolvedMedia) !== mediaRoot || path.dirname(sidecarPath) !== mediaRoot) return;
  try {
    const mediaStat = fs.lstatSync(resolvedMedia);
    const sidecarStat = fs.lstatSync(sidecarPath);
    if (!mediaStat.isFile() || mediaStat.isSymbolicLink() || !sidecarStat.isFile() || sidecarStat.isSymbolicLink()) return;
    const realRoot = fs.realpathSync(mediaRoot);
    if (path.dirname(fs.realpathSync(resolvedMedia)) !== realRoot || path.dirname(fs.realpathSync(sidecarPath)) !== realRoot) return;
    const sidecar = JSON.parse(fs.readFileSync(sidecarPath, "utf8")) as { runId?: unknown; mediaPath?: unknown };
    if (sidecar.runId !== runId || typeof sidecar.mediaPath !== "string" || path.resolve(sidecar.mediaPath) !== resolvedMedia) return;
    fs.unlinkSync(resolvedMedia);
    fs.unlinkSync(sidecarPath);
  } catch { /* missing or untrusted path */ }
}

function cleanupRunArtifacts(run: Run): void {
  if (run.mediaPath) removeOwnedMedia(run.mediaPath, run.id);
  if (run.extractionWorkDir) removeManagedExtractionWorkDir(run.extractionWorkDir, run.id);
  run.mediaPath = undefined;
  run.extractionWorkDir = undefined;
  storeRun(run);
}

const executingRuns = new Set<string>();

export function recoverAndEnqueueRuns(opts: RunPipelineOptions = {}, enqueue: (run: Run, opts: RunPipelineOptions) => void = (run, options) => { void executeRegisteredPipeline(run, options).catch(() => {}); }): number {
  const stateDir = runStateDir();
  if (stateDir && fs.existsSync(stateDir)) {
    for (const name of fs.readdirSync(stateDir).filter((entry) => entry.endsWith(".json"))) {
      try {
        const recovered = JSON.parse(fs.readFileSync(path.join(stateDir, name), "utf8")) as Run;
        if (!recovered || typeof recovered.id !== "string" || typeof recovered.url !== "string" || typeof recovered.status !== "string") continue;
        if (recovered.status === "running") recovered.status = "pending";
        storeRun(recovered);
      } catch { /* ignore corrupt isolated state records */ }
    }
  }
  const mediaDir = path.resolve(process.env["MEDIA_UPLOAD_DIR"] ?? "/tmp/tech-radar-media");
  if (fs.existsSync(mediaDir)) {
    for (const name of fs.readdirSync(mediaDir).filter((entry) => entry.endsWith(".run.json"))) {
      try {
        const sidecar = JSON.parse(fs.readFileSync(path.join(mediaDir, name), "utf8")) as Partial<Run> & { runId?: string };
        const id = sidecar.runId ?? sidecar.id;
        if (!id || !sidecar.mediaPath) continue;
        const uploadState = sidecar as typeof sidecar & { idempotencyKey?: string; analysisId?: string };
        const existing = runs.get(id);
        storeRun({ ...existing, id, url: existing?.url ?? sidecar.url ?? `https://uploads.invalid/${encodeURIComponent(id)}`, status: existing?.status === "running" ? "pending" : existing?.status ?? "awaiting_media", intent: sidecar.intent ?? existing?.intent, origin: sidecar.origin ?? existing?.origin, mediaPath: sidecar.mediaPath, originalName: sidecar.originalName ?? existing?.originalName, evidenceIdempotencyKey: uploadState.idempotencyKey ?? existing?.evidenceIdempotencyKey, downstreamAnalysisId: uploadState.analysisId ?? existing?.downstreamAnalysisId, startedAt: sidecar.startedAt ?? existing?.startedAt ?? new Date().toISOString() });
      } catch { /* ignore malformed sidecars */ }
    }
  }
  let enqueued = 0;
  for (const run of runs.values()) {
    if (["processed", "partial", "failed", "skipped", "needs_review", "downstream_pending"].includes(run.status)) {
      cleanupRunArtifacts(run);
      continue;
    }
    if (run.extractionWorkDir) {
      removeManagedExtractionWorkDir(run.extractionWorkDir, run.id);
      run.extractionWorkDir = undefined;
      storeRun(run);
    }
    if (!["pending", "awaiting_media"].includes(run.status) || executingRuns.has(run.id)) continue;
    enqueued++;
    enqueue(run, opts);
  }
  return enqueued;
}

export async function withVisionFallback(
  extractResult: ExtractResult,
  visionExtractor: typeof extractTextWithVision = extractTextWithVision,
): Promise<ExtractResult> {
  const existingVisualText = extractResult.visual_text?.trim();
  const shouldRunVision = !existingVisualText || isNoisyFinanceListOcr(existingVisualText);
  if (!shouldRunVision) return extractResult;
  const imagePaths = (extractResult.media_assets ?? [])
    .filter((asset) => (asset.type === "image" || asset.type === "screenshot") && asset.path)
    .map((asset) => asset.path!)
    .slice(0, 4);
  if (imagePaths.length === 0) return extractResult;

  const vision = await visionExtractor(imagePaths);
  const warnings = [...(extractResult.extraction_warnings ?? [])];
  if (vision.warning) warnings.push(vision.warning);
  if (!vision.text) {
    return warnings.length ? { ...extractResult, extraction_warnings: warnings } : extractResult;
  }
  const boundedVisionText = vision.text.trim().slice(0, 4_000);
  if (vision.text.trim().length > boundedVisionText.length) warnings.push("vision OCR truncated to 4000 characters");
  return {
    ...extractResult,
    visual_text: boundedVisionText,
    visual_text_source: "vision_ocr",
    extraction_warnings: warnings,
  };
}

function isNoisyFinanceListOcr(text: string): boolean {
  if (!/\b(?:ETFs?|tickers?)\b/i.test(text)) return false;
  const listMarkers = text.match(/(?:^|\n)\s*(?:[-–—]\s*)?\d{1,2}\s*[.)]/g) ?? [];
  if (listMarkers.length < 2) return false;
  const cleanSymbols = new Set(text.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\s*(?:[-–—]\s*)?\d{1,2}\s*[.)]\s*([A-Z][A-Z0-9.-]{1,5})\s*$/);
    return match ? [match[1]] : [];
  }));
  return cleanSymbols.size < listMarkers.length;
}

export function getRun(runId: string): Run | undefined {
  const inMemory = runs.get(runId);
  if (inMemory) return inMemory;
  const stateDir = runStateDir();
  const safeId = safeRunPathPart(runId);
  if (!stateDir || !safeId) return undefined;
  try {
    const recovered = JSON.parse(fs.readFileSync(path.join(stateDir, `${safeId}.json`), "utf8")) as Run;
    if (recovered.id !== runId || typeof recovered.url !== "string" || typeof recovered.status !== "string") return undefined;
    runs.set(recovered.id, recovered);
    return recovered;
  } catch {
    return undefined;
  }
}

export function findMediaRunBySubmission(analysisId: string, idempotencyKey: string): Run | undefined {
  const matches = (run: Run) => run.downstreamAnalysisId === analysisId
    && run.evidenceIdempotencyKey === idempotencyKey;
  const inMemory = [...runs.values()].reverse().find(matches);
  if (inMemory) return inMemory;

  const stateDir = runStateDir();
  if (!stateDir || !fs.existsSync(stateDir)) return undefined;
  for (const name of fs.readdirSync(stateDir).filter((entry) => entry.endsWith(".json"))) {
    try {
      const recovered = JSON.parse(fs.readFileSync(path.join(stateDir, name), "utf8")) as Run;
      if (!recovered || typeof recovered.id !== "string" || typeof recovered.url !== "string" || typeof recovered.status !== "string") continue;
      if (!matches(recovered)) continue;
      runs.set(recovered.id, recovered);
      return recovered;
    } catch { /* ignore unrelated or corrupt state files */ }
  }
  return undefined;
}

export function listRuns(): Run[] {
  return Array.from(runs.values()).reverse().slice(0, 50);
}

export function findRunByUrl(url: string): Run | undefined {
  const canonical = canonicalizeIfPossible(url);
  for (const run of runs.values()) {
    if (canonicalizeIfPossible(run.url) === canonical) return run;
  }
  return undefined;
}

function canonicalizeIfPossible(url: string): string {
  try {
    return canonicalizeSocialUrl(url);
  } catch {
    return url;
  }
}

export class DuplicateRunError extends Error {
  constructor(public readonly existingRun: Run, public readonly idempotent = false) {
    super(`URL already ${existingRun.status}: ${existingRun.url}`);
    this.name = "DuplicateRunError";
  }
}

export function registerPipelineRun(url: string, opts: RunPipelineOptions = {}): Run {
  const canonicalUrl = canonicalizeSocialUrl(url);
  const requestedIntent = opts.intent ?? "technology";
  const candidates = [...runs.values()].reverse().filter((candidate) => canonicalizeIfPossible(candidate.url) === canonicalUrl
    && (candidate.intent ?? "technology") === requestedIntent);
  const retryableTerminal = (candidate: Run) => ["failed", "skipped", "needs_review"].includes(candidate.status)
    || (candidate.status === "partial" && !candidate.financeHandoffCompleted && !candidate.downstreamAnalysisId);
  if (opts.idempotencyKey) {
    const idempotent = candidates.find((candidate) => candidate.submissionIdempotencyKey === opts.idempotencyKey);
    if (idempotent && !(opts.force && retryableTerminal(idempotent))) throw new DuplicateRunError(idempotent, true);
  }
  const exactDuplicate = candidates[0];
  if (exactDuplicate && !(opts.force && retryableTerminal(exactDuplicate))) throw new DuplicateRunError(exactDuplicate, true);
  const covered = [...runs.values()].reverse().find((candidate) =>
    canonicalizeIfPossible(candidate.url) === canonicalUrl && runCoversIntent(candidate, requestedIntent));
  if (covered && !(opts.force && retryableTerminal(covered))) {
    throw new DuplicateRunError(covered, true);
  }
  const run: Run = {
    id: randomUUID(),
    url: canonicalUrl,
    status: "pending",
    intent: opts.intent ?? "technology",
    origin: opts.origin ?? { channel: "api" },
    submissionIdempotencyKey: opts.idempotencyKey,
    startedAt: new Date().toISOString(),
  };
  storeRun(run);
  return run;
}

function runCoversIntent(run: Run, requested: SocialVideoIntent): boolean {
  const existing = run.intent ?? "technology";
  if (requested === "auto") return existing === "auto";
  if (existing === requested) return true;
  if (existing !== "auto") return false;
  if (["pending", "running", "awaiting_media"].includes(run.status)) return true;
  return run.processedBranches?.includes(requested) ?? false;
}

export function registerAwaitingMediaRun(input: {
  fileUniqueId: string;
  mediaPath: string;
  intent: SocialVideoIntent;
  origin: SocialVideoOrigin;
  mimeType?: string;
  originalName?: string;
  idempotencyKey?: string;
  analysisId?: string;
}): Run {
  const mediaUrl = `https://uploads.invalid/${encodeURIComponent(input.fileUniqueId)}`;
  const existing = [...runs.values()].find((run) => run.url === mediaUrl && ["awaiting_media", "pending", "running"].includes(run.status));
  if (existing) throw new DuplicateRunError(existing);
  const run: Run = {
    id: randomUUID(),
    url: mediaUrl,
    status: "awaiting_media",
    intent: input.intent,
    origin: input.origin,
    mediaPath: input.mediaPath,
    evidenceIdempotencyKey: input.idempotencyKey,
    originalName: input.originalName,
    downstreamAnalysisId: input.analysisId,
    startedAt: new Date().toISOString(),
  };
  const sidecarPath = `${input.mediaPath}.run.json`;
  try {
    fs.writeFileSync(sidecarPath, JSON.stringify({
      schemaVersion: 1,
      runId: run.id,
      status: run.status,
      intent: run.intent,
      origin: run.origin,
      mediaPath: run.mediaPath,
      mimeType: input.mimeType,
      originalName: input.originalName,
      idempotencyKey: input.idempotencyKey,
      analysisId: input.analysisId,
      startedAt: run.startedAt,
    }), { encoding: "utf8", mode: 0o600, flag: "wx" });
    storeRun(run);
  } catch (error) {
    runs.delete(run.id);
    fs.rmSync(sidecarPath, { force: true });
    const stateDir = runStateDir();
    if (stateDir) fs.rmSync(path.join(stateDir, `${run.id}.json`), { force: true });
    throw error;
  }
  return run;
}

export function runMediaPipeline(input: Parameters<typeof registerAwaitingMediaRun>[0], opts: Omit<RunPipelineOptions, "intent" | "origin"> = {}): PipelinePromise {
  const run = registerAwaitingMediaRun(input);
  const completion = executeRegisteredPipeline(run, { ...opts, intent: input.intent, origin: input.origin });
  return Object.assign(completion, { runId: run.id });
}

export type PipelineResult = { runId: string; findingPath: string };
export type PipelinePromise = Promise<PipelineResult> & { runId: string };

export function runPipeline(
  url: string,
  opts: RunPipelineOptions = {},
): PipelinePromise {
  const run = registerPipelineRun(url, opts);
  const completion = executeRegisteredPipeline(run, opts);
  return Object.assign(completion, { runId: run.id });
}

async function executeRegisteredPipeline(run: Run, opts: RunPipelineOptions): Promise<PipelineResult> {
  const { id: runId, url } = run;

  if (executingRuns.has(runId)) throw new Error(`run ${runId} is already executing`);
  executingRuns.add(runId);
  let repo: AiMemoryRepo | undefined;
  let releaseMutation: (() => void) | undefined;
  try {
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

  repo = new AiMemoryRepo(repoOpts);
  const workRoot = extractionWorkRoot();
  fs.mkdirSync(workRoot, { recursive: true, mode: 0o700 });
  const extractionWorkDir = fs.mkdtempSync(path.join(workRoot, `tech-radar-extract-${runId}-`));
  run.extractionWorkDir = extractionWorkDir;
  storeRun(run);

  releaseMutation = await acquireAiMemoryRepoMutation();
    await repo.init();
    await repo.pullLatest();

    const today = new Date().toISOString().slice(0, 10);

    // Write pending inbox row immediately
    await repo.updateInbox({ url, status: "pending", finding: `run:${run.id}`, date: today });
    await repo.commitAndPush(`tech-radar: pending ${url.slice(0, 60)}`);

    // Step 1: Extract
    const extractResult = run.mediaPath
      ? await extractLocalMedia({ runId, mediaPath: run.mediaPath, workDir: extractionWorkDir })
      : await extract(url, { outDir: extractionWorkDir });
    if (run.originalName) extractResult.title = run.originalName;

    // Bail early if the post has no usable content — skip agents entirely
    const hasContent = (extractResult.caption && extractResult.caption.trim()) ||
                       (extractResult.transcript && extractResult.transcript.trim()) ||
                       (extractResult.visual_text && extractResult.visual_text.trim());
    const durationExceeded = typeof extractResult.duration_sec === "number" && extractResult.duration_sec > 1_800;
    if (durationExceeded || extractResult.status === "failed" || !hasContent) {
      const skipReason = durationExceeded
        ? "duration_limit: media exceeds 1800 seconds"
        : extractResult.status === "failed"
        ? (extractResult.error ?? "extract failed")
        : "no caption, transcript, or visual text";
      await repo.updateInbox({ url, status: "skipped", finding: null, date: today, error: skipReason });
      await repo.commitAndPush(`tech-radar: skipped ${url.slice(0, 60)}`);

      run.status = "skipped";
      run.error = skipReason;
      run.finishedAt = new Date().toISOString();
      storeRun(run);

      sendTelegram(`⏭️ *Skipped* (${skipReason}):\n${url.slice(0, 80)}`);
      return { runId, findingPath: "" };
    }

    const enrichedExtract = await extractAndEnrich(extractResult);
    let findingPath = "";
    let childCount = 0;
    let findingFilename = "";
    const activeRepo = repo;

    const routed = await routeEnrichedExtract(enrichedExtract, run.intent ?? "technology", {
      classifier: opts.classifier,
      technology: async (sharedExtract) => {
        const researchResult = await runResearch(sharedExtract);
        const implementationMemoryDir = configuredAiMemoryDir && fs.existsSync(path.join(configuredAiMemoryDir, "GLOBAL_MEMORY.md"))
          ? configuredAiMemoryDir
          : localDir;
        const implementationResult = await runImplementation(sharedExtract, researchResult, implementationMemoryDir);
        const composed = composeFinding({ extract: sharedExtract, research: researchResult, implementation: implementationResult });
        const write = await activeRepo.writeFindingForSource({ sourceUrl: url, filename: composed.filename, body: composed.body, date: today });
        await activeRepo.updateIndex({ date: today, title: sharedExtract.title ?? write.filename, finding: write.filename, targetProject: implementationResult.target_project });
        for (const row of childArtifactInboxRows(sharedExtract, { date: today, parentFinding: write.filename })) {
          if (await activeRepo.updateInboxIfMissing(row)) childCount++;
        }
        findingPath = `tech-radar/findings/${write.filename}`;
        findingFilename = write.filename;
        run.findingPath = findingPath;
        run.generatedFindingPath = write.generatedFilename === write.filename ? undefined : `tech-radar/findings/${write.generatedFilename}`;
        run.replacedExistingFinding = write.replacedExisting;
        return findingPath;
      },
      finance: async (sharedExtract, classification) => {
        if (run.financeHandoffCompleted && run.downstreamAnalysisId) {
          return { analysisId: run.downstreamAnalysisId, status: run.downstreamStatus ?? "pending", deduplicated: true };
        }
        const client = new StockBotClient({
          baseUrl: process.env["STOCKBOT_API_URL"] ?? "",
          serviceToken: process.env["STOCKBOT_SERVICE_TOKEN"] ?? "",
          timeoutMs: Number(process.env["STOCKBOT_TIMEOUT_MS"] ?? 10_000),
        });
        const evidence = buildSocialVideoEvidence({ extract: sharedExtract, classification, runId, canonicalUrl: url, origin: run.origin ?? { channel: "api" }, idempotencyKey: run.evidenceIdempotencyKey });
        const submission = await client.submitVideoEvidence(evidence);
        run.downstreamAnalysisId = submission.analysisId;
        run.downstreamStatus = submission.status;
        run.downstreamDetailUrl = submission.detailUrl ?? detailUrlFor(submission.analysisId);
        run.financeHandoffCompleted = true;
        if (submission.deduplicated && submission.originRunId && submission.originRunId !== run.id) {
          run.deduplicatedToRunId = submission.originRunId;
          const original = runs.get(submission.originRunId);
          if (original) {
            original.downstreamAnalysisId = submission.analysisId;
            original.downstreamStatus = submission.status;
            original.downstreamDetailUrl = run.downstreamDetailUrl;
            original.financeHandoffCompleted = true;
            const originalTerminalStatus = stockBotTerminalRunStatus(submission);
            if (originalTerminalStatus) {
              original.status = originalTerminalStatus;
              original.finishedAt = new Date().toISOString();
            } else if (!["processed", "partial", "failed", "skipped", "needs_review"].includes(original.status)) {
              original.status = "downstream_pending";
              original.finishedAt = undefined;
            }
            storeRun(original);
          }
        }
        storeRun(run);
        return submission;
      },
    });

    const requestedFinance = routed.classification.category === "finance" || routed.classification.category === "mixed";
    run.classification = routed.classification;
    run.processedBranches = [routed.technology !== undefined ? "technology" : undefined, routed.finance !== undefined ? "finance" : undefined].filter((branch): branch is "technology" | "finance" => Boolean(branch));
    const branchErrors = Object.values(routed.branchErrors ?? {});
    const noRoutedBranch = ["other", "needs_review"].includes(routed.classification.category);
    const hasFinance = Boolean(routed.finance);
    const terminalFinanceStatus = routed.finance ? stockBotTerminalRunStatus(routed.finance, run.id) : undefined;
    const pipelineStatus = noRoutedBranch ? "needs_review" : branchErrors.length ? (hasFinance || routed.technology ? "partial" : "failed") : terminalFinanceStatus ?? (hasFinance ? "downstream_pending" : "processed");
    run.status = mergeRunStatus(run.status, pipelineStatus);
    run.error = branchErrors.length ? branchErrors.join("; ").slice(0, 1_000) : undefined;
    run.finishedAt = run.status === "downstream_pending" ? undefined : new Date().toISOString();
    if (terminalFinanceStatus === "failed") run.error = "StockBot analysis failed";
    if (terminalFinanceStatus === "skipped") run.error = run.deduplicatedToRunId
      ? `Deduplicated to StockBot run ${run.deduplicatedToRunId}`
      : "StockBot analysis canceled";
    const inboxFinding = hasFinance
      ? [findingFilename || null, `stockbot:${run.downstreamAnalysisId}`, `run:${run.id}`].filter(Boolean).join(";")
      : findingFilename;
    await repo.updateInbox({ url, status: run.status, finding: inboxFinding || null, date: today });
    await repo.commitAndPush(hasFinance ? `tech-radar: StockBot handoff ${run.id}` : `tech-radar: ${run.status} ${run.id}`);
    storeRun(run);

    if (terminalFinanceStatus) {
      const link = run.downstreamDetailUrl ? `\n${run.downstreamDetailUrl}` : "";
      sendTelegram(run.deduplicatedToRunId
        ? `⏭️ *Stock analysis deduplicated*\nReusing run ${run.deduplicatedToRunId}${link}`
        : `${terminalFinanceStatus === "processed" ? "✅" : "⚠️"} *Stock analysis ${routed.finance!.status}*${link}`);
    } else if (noRoutedBranch) {
      sendTelegram(`⚠️ *Needs review*\n\n${url.slice(0, 80)}\n\n${routed.classification.reasons.join("; ").slice(0, 300)}`);
    } else if (branchErrors.length) {
      sendTelegram(`⚠️ *Partial social-video analysis*\n\n${url.slice(0, 80)}\n\n${branchErrors.join("; ").slice(0, 300)}`);
    } else if (!requestedFinance && findingFilename) {
      const repoUrl = process.env["AI_MEMORY_REPO_URL"] ?? "";
      const fileLink = repoUrl ? `${repoUrl}/blob/master/${findingPath}` : findingPath;
      const childNote = childCount > 0 ? `\nQueued child artifacts: ${childCount}` : "";
      sendTelegram(`✅ *Tech Radar finding ready*\n\n[${findingFilename.replace(".md", "")}](${fileLink})\n\nSource: ${url.slice(0, 60)}${childNote}`);
    }

    return { runId, findingPath };

  } catch (err) {
    run.status = mergeRunStatus(run.status, "failed");
    run.error = err instanceof Error ? err.message : String(err);
    run.finishedAt = new Date().toISOString();
    storeRun(run);

    // Best-effort: try to mark inbox as failed
    try {
      const today = new Date().toISOString().slice(0, 10);
      await repo?.updateInbox({ url, status: "failed", finding: null, date: today, error: run.error });
      await repo?.commitAndPush(`tech-radar: failed ${url.slice(0, 60)}`);
    } catch {
      // ignore secondary errors
    }

    sendTelegram(`❌ *Tech Radar run failed*\n\n${url.slice(0, 80)}\n\nError: \`${(run.error ?? "unknown").slice(0, 200)}\``);

    throw err;
  } finally {
    try {
      cleanupRunArtifacts(run);
    } finally {
      releaseMutation?.();
      executingRuns.delete(runId);
    }
  }
}

export function stockBotTerminalRunStatus(submission: Pick<StockBotSubmission, "status" | "deduplicated" | "originRunId">, currentRunId?: string): Run["status"] | undefined {
  if (!submission.deduplicated) return undefined;
  if (currentRunId && submission.originRunId && submission.originRunId !== currentRunId) return "skipped";
  if (submission.status === "completed") return "processed";
  if (submission.status === "partial") return "partial";
  if (submission.status === "failed") return "failed";
  if (submission.status === "canceled") return "skipped";
  if (submission.status === "needs_review") return "needs_review";
  return undefined;
}

export function mergeRunStatus(current: Run["status"], proposed: Run["status"]): Run["status"] {
  const terminal = new Set<Run["status"]>(["processed", "partial", "needs_review", "failed", "skipped"]);
  if (terminal.has(current) && ["pending", "running", "awaiting_media", "downstream_pending"].includes(proposed)) return current;
  return proposed;
}

async function extractAndEnrich(extractResult: ExtractResult): Promise<ExtractResult> {
  const visionEnhancedExtract = await withVisionFallback(extractResult);
  return { ...visionEnhancedExtract, enriched_links: await enrichLinksFromExtract(visionEnhancedExtract) };
}

interface RouteHandlers {
  technology: (extract: ExtractResult) => Promise<unknown>;
  finance: (extract: ExtractResult, classification: SocialVideoClassification) => Promise<StockBotSubmission>;
  classifier?: SocialVideoModelClassifier;
}

export async function routeEnrichedExtract(
  extractResult: ExtractResult,
  intent: SocialVideoIntent,
  handlers: RouteHandlers,
): Promise<{ classification: SocialVideoClassification; technology?: unknown; finance?: StockBotSubmission; branchErrors?: Partial<Record<"technology" | "finance", string>> }> {
  const classification = await classifySocialVideo(extractResult, intent, handlers.classifier);
  const result: { classification: SocialVideoClassification; technology?: unknown; finance?: StockBotSubmission; branchErrors?: Partial<Record<"technology" | "finance", string>> } = { classification };
  const branches: Array<{ name: "technology" | "finance"; promise: Promise<unknown> }> = [];
  if (classification.category === "technology" || classification.category === "mixed") branches.push({ name: "technology", promise: handlers.technology(extractResult) });
  if (classification.category === "finance" || classification.category === "mixed") branches.push({ name: "finance", promise: handlers.finance(extractResult, classification) });
  const settled = await Promise.allSettled(branches.map((branch) => branch.promise));
  settled.forEach((outcome, index) => {
    const name = branches[index].name;
    if (outcome.status === "fulfilled") {
      if (name === "technology") result.technology = outcome.value;
      else result.finance = outcome.value as StockBotSubmission;
    } else {
      result.branchErrors ??= {};
      result.branchErrors[name] = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
    }
  });
  return result;
}

export function buildSocialVideoEvidence(input: {
  extract: ExtractResult;
  classification: SocialVideoClassification;
  runId: string;
  canonicalUrl: string;
  origin: SocialVideoOrigin;
  idempotencyKey?: string;
}): SocialVideoEvidenceV1 {
  if (typeof input.extract.duration_sec === "number" && input.extract.duration_sec > 1_800) throw new Error("duration_limit: media exceeds 1800 seconds");
  const durationSeconds = input.extract.duration_sec == null ? undefined : Math.max(0, Math.round(input.extract.duration_sec));
  const durationMs = Math.round((durationSeconds ?? 0) * 1_000);
  const transcriptText = input.extract.transcript?.trim();
  const methods = new Set(input.extract.extraction_methods ?? []);
  if (input.extract.transcript_source) methods.add(input.extract.transcript_source);
  if (input.extract.visual_text_source) methods.add(input.extract.visual_text_source);
  if (input.extract.enriched_links) methods.add("link_enrichment");
  const rawTranscriptSegments = input.extract.transcript_segments?.length
    ? input.extract.transcript_segments.map((segment) => ({ startMs: Math.round(segment.start_ms), endMs: Math.round(segment.end_ms), text: segment.text }))
    : transcriptText ? buildUntimedTranscriptSegments(transcriptText, durationMs) : [];
  const transcriptSegments = boundTranscriptSegments(rawTranscriptSegments);
  const sources: Array<{ text: string; startMs?: number; endMs?: number }> = [
    ...(input.extract.caption?.trim() ? splitClaimBlocks(input.extract.caption).map((text) => ({ text })) : []),
    ...transcriptSegments.flatMap((segment) => splitClaimBlocks(segment.text).map((text) => ({ text, startMs: segment.startMs, endMs: segment.endMs }))),
    ...(input.extract.visual_text?.trim() ? splitClaimBlocks(input.extract.visual_text).map((text) => ({ text })) : []),
  ];
  const securities = extractSecurityMentions(sources, {
    visualText: input.extract.visual_text ?? undefined,
    corroboratingText: [input.extract.caption, transcriptText].filter(Boolean).join("\n"),
  }).slice(0, 10);
  const publishedAt = normalizePublishedAt(input.extract.upload_date);
  const uploaded = new URL(input.canonicalUrl).hostname === "uploads.invalid";
  const contractUrl = uploaded ? `https://internal.invalid/tech-radar-upload/${encodeURIComponent(input.runId)}` : input.extract.url;
  const contractCanonicalUrl = uploaded ? contractUrl : input.canonicalUrl;
  return SocialVideoEvidenceV1Schema.parse({
    schemaVersion: 1,
    idempotencyKey: input.idempotencyKey ?? `${input.runId}:finance-v1`,
    origin: { ...input.origin, runId: input.runId },
    source: {
      url: contractUrl,
      canonicalUrl: contractCanonicalUrl,
      platform: uploaded ? "upload" : input.extract.platform,
      externalId: uploaded ? input.runId : externalIdFromUrl(input.canonicalUrl),
      title: input.extract.title ?? undefined,
      creator: input.extract.creator ?? undefined,
      publishedAt,
      durationSeconds,
    },
    classification: input.classification,
    transcript: {
      method: input.extract.transcript_source ?? undefined,
      segments: transcriptSegments,
    },
    visualTexts: input.extract.visual_text?.trim()
      ? [{ text: input.extract.visual_text, method: input.extract.visual_text_source ?? undefined }]
      : [],
    extraction: { methods: [...methods], warnings: input.extract.extraction_warnings ?? [] },
    financeClaims: {
      securities: securities.map((security) => ({
        ...security,
        claims: sampleEvenly(sources.filter((source) => securities.length === 1 || sourceMatchesSecurity(source.text, security)), 100).map((source) => ({
          text: source.text,
          confidence: 0.5,
          ...(source.startMs !== undefined && source.endMs !== undefined ? { startMs: source.startMs, endMs: source.endMs } : {}),
        })),
      })),
    },
  });
}

function buildUntimedTranscriptSegments(text: string, durationMs: number): Array<{ startMs: number; endMs: number; text: string }> {
  const chunks: string[] = [];
  for (const block of splitClaimBlocks(text)) {
    for (let offset = 0; offset < block.length; offset += 4_000) chunks.push(block.slice(offset, offset + 4_000));
  }
  return chunks.map((chunk, index) => ({
    startMs: Math.round(durationMs * index / Math.max(1, chunks.length)),
    endMs: Math.round(durationMs * (index + 1) / Math.max(1, chunks.length)),
    text: chunk,
  }));
}

function boundTranscriptSegments(values: Array<{ startMs: number; endMs: number; text: string }>): Array<{ startMs: number; endMs: number; text: string }> {
  let retained = sampleEvenly(values.flatMap((segment) => {
    const text = segment.text.trim();
    return Array.from({ length: Math.ceil(text.length / 4_000) }, (_, index) => ({ ...segment, text: text.slice(index * 4_000, (index + 1) * 4_000) })).filter((item) => item.text);
  }), 3_600);
  while (retained.reduce((total, segment) => total + segment.text.length, 0) > 120_000 && retained.length > 1) {
    retained = sampleEvenly(retained, Math.ceil(retained.length / 2));
  }
  return retained;
}

function sampleEvenly<T>(values: T[], limit: number): T[] {
  if (values.length <= limit) return values;
  return Array.from({ length: limit }, (_, index) => values[Math.round(index * (values.length - 1) / (limit - 1))]);
}

function extractSecurityMentions(sources: Array<{ text: string }>, context?: { visualText?: string; corroboratingText?: string }): Array<{
  symbol?: string;
  exchange?: string;
  companyName?: string;
  assetType: "stock" | "etf" | "unsupported";
  confidence: number;
}> {
  const text = sources.map((source) => source.text).join("\n");
  const bySymbol = new Map<string, { symbol: string; exchange?: string; companyName?: string; assetType: "stock" | "etf" | "unsupported"; confidence: number }>();
  for (const source of sources) {
    const matches = [
      ...source.text.matchAll(/\$([A-Z][A-Z0-9.-]{0,9})\b/g),
      ...source.text.matchAll(/\b(NASDAQ|NYSE|TSX|ASX|LSE)\s*:\s*([A-Z][A-Z0-9.-]{0,9})\b/g),
    ];
    for (const match of matches) {
      const symbol = (match[2] ?? match[1]).toUpperCase();
      const exchange = match[2] ? match[1].toUpperCase() : undefined;
      bySymbol.set(symbol, { symbol, exchange, assetType: /\bETF\b/i.test(source.text) ? "etf" : "stock", confidence: exchange ? 0.85 : 0.7 });
    }
  }
  const hasEtfContext = /\bETFs?\b/i.test(text);
  const hasSecurityContext = hasEtfContext || /\b(?:stocks?|shares?|funds?|invest(?:ing|ment|ors?)?|portfolio|NASDAQ|NYSE)\b/i.test(text);
  for (const symbol of extractExplicitVisualTickerList(context?.visualText, context?.corroboratingText, hasSecurityContext)) {
    bySymbol.set(symbol, { symbol, assetType: hasEtfContext ? "etf" : "stock", confidence: 0.65 });
  }
  for (const company of text.matchAll(/\b([A-Z][A-Za-z&.' -]{1,80}(?:Inc\.?|Corp\.?|Corporation|Ltd\.?|Limited|PLC))\s*\(([A-Z][A-Z0-9.-]{0,9})\)/g)) {
    const symbol = company[2];
    const current = bySymbol.get(symbol);
    bySymbol.set(symbol, { symbol, companyName: company[1].trim(), assetType: current?.assetType ?? "stock", exchange: current?.exchange, confidence: 0.9 });
  }
  const named = new Map<string, { companyName: string; assetType: "stock" | "etf"; confidence: number }>();
  const resolvedNames = new Set([...bySymbol.values()].flatMap((security) => security.companyName ? [normalizeSecurityName(security.companyName)] : []));
  for (const source of sources) {
    const mentions: Array<{ match: RegExpMatchArray; assetType: "stock" | "etf" }> = [
      ...[...source.text.matchAll(/(?<![$A-Za-z0-9])\b([A-Z][A-Za-z&.'-]*(?:\s+[A-Z][A-Za-z&.'-]*){0,5}\s+ETF)\b/g)].map((match) => ({ match, assetType: "etf" as const })),
      ...[...source.text.matchAll(/(?<![$A-Za-z0-9])\b([A-Z][A-Za-z&.'-]*(?:\s+(?:[A-Z][A-Za-z&.'-]*|Corp\.?|Corporation|Inc\.?|Ltd\.?)){0,4})\s+(?:stock|shares?)\b/g)].map((match) => ({ match, assetType: "stock" as const })),
    ];
    for (const { match, assetType } of mentions) {
      const companyName = match[1].trim();
      const normalized = normalizeSecurityName(companyName);
      const index = match.index ?? 0;
      const before = source.text.slice(0, index);
      const after = source.text.slice(index + match[0].length);
      const adjacentSymbol = /(?:\$[A-Z][A-Z0-9.-]{0,9}|(?:NASDAQ|NYSE|TSX|ASX|LSE)\s*:\s*[A-Z][A-Z0-9.-]{0,9})\s*$/.test(before)
        || /^\s*(?:\(\s*[A-Z][A-Z0-9.-]{0,9}\s*\)|(?:[-–—]\s*)?\$[A-Z][A-Z0-9.-]{0,9}\b|(?:NASDAQ|NYSE|TSX|ASX|LSE)\s*:\s*[A-Z][A-Z0-9.-]{0,9}\b)/.test(after);
      if (adjacentSymbol || /^(?:This|The|A|An|Company)\b/i.test(companyName) || resolvedNames.has(normalized)) continue;
      named.set(normalized, { companyName, assetType, confidence: 0.3 });
    }
  }
  if (bySymbol.size === 0 && named.size === 0 && /\b(?:stock|shares?|security|company|investment)\b/i.test(text)) {
    return [{ assetType: /\bETF\b/i.test(text) ? "etf" : "stock", confidence: 0.2 }];
  }
  return [...bySymbol.values(), ...named.values()];
}

function extractExplicitVisualTickerList(visualText: string | undefined, corroboratingText: string | undefined, hasSecurityContext: boolean): string[] {
  if (!visualText || !hasSecurityContext) return [];
  const stopWords = new Set([
    "ETF", "ETFS", "FUND", "FUNDS", "NASDAQ", "NYSE", "TSX", "ASX", "LSE", "USA", "US",
    "BUY", "SELL", "HOLD", "SHARE", "FOLLOW", "LIKE", "SAVE", "POST", "NOW", "WATCH", "COMMENT", "LINK", "BIO",
    "TOP", "BEST", "THIS", "THAT", "NEXT", "LAST",
  ]);
  const valid = (value: string): boolean => /^[A-Z][A-Z0-9.-]{1,5}$/.test(value) && !stopWords.has(value);
  const isCorroborated = (symbol: string): boolean => new RegExp(`\\b${symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(corroboratingText ?? "");
  const lines = visualText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const numbered = lines.flatMap((line) => {
    const match = line.match(/^\d{1,2}\s*[.)-]\s*\$?([A-Z][A-Z0-9.-]{1,5})$/);
    return match && valid(match[1]) ? [match[1]] : [];
  });
  if (numbered.length >= 2 && numbered.filter(isCorroborated).length >= 2) return [...new Set(numbered)];

  const compact = lines.flatMap((line) => {
    const tokens = line.split(/[\s,|/]+/).map((token) => token.replace(/^\$/, "")).filter(Boolean);
    const candidates = tokens.filter(valid);
    return candidates.length >= 2 && tokens.length <= 10 ? [candidates] : [];
  }).find((tokens) => {
    return tokens.filter(isCorroborated).length >= 2;
  });
  return compact ? [...new Set(compact)] : [];
}

function normalizeSecurityName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function sourceMatchesSecurity(text: string, security: { symbol?: string; exchange?: string; companyName?: string }): boolean {
  if (security.symbol && new RegExp(`\\b${security.symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text)) return true;
  const normalizedText = text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const normalizedCompany = security.companyName?.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return Boolean(normalizedCompany && normalizedText.includes(normalizedCompany));
}

function splitClaimBlocks(text: string): string[] {
  return text.split(/(?:\r?\n)+|(?<=[.!?])\s+/).map((value) => value.trim()).filter(Boolean);
}

function normalizePublishedAt(value: string | null): string | undefined {
  if (!value) return undefined;
  if (/^\d{8}$/.test(value)) return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00.000Z`;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? undefined : parsed.toISOString();
}

function externalIdFromUrl(url: string): string | undefined {
  const parsed = new URL(url);
  return parsed.searchParams.get("v") ?? parsed.pathname.split("/").filter(Boolean).pop();
}

export async function applyStockBotCompletion(event: StockBotCompletionEvent): Promise<Run | undefined> {
  const releaseMutation = await acquireAiMemoryRepoMutation();
  try {
    const run = getRun(event.runId);
    if (!run || run.downstreamAnalysisId !== event.analysisId) return undefined;
    run.downstreamStatus = event.status;
    run.downstreamDetailUrl = event.detailUrl ?? detailUrlFor(event.analysisId);
    if (event.status === "completed") run.status = "processed";
    else if (event.status === "partial") run.status = "partial";
    else if (event.status === "canceled") {
      run.status = "skipped";
      run.error = stockBotErrorText(event.error) ?? "StockBot analysis canceled";
    } else if (event.status === "failed") {
      run.status = "failed";
      run.error = stockBotErrorText(event.error) ?? "StockBot analysis failed";
    } else if (event.status === "needs_review") run.status = "needs_review";
    run.finishedAt = new Date().toISOString();
    storeRun(run);
    await persistCallbackState(run);
    sendTelegram(stockBotCompletionNotification(event, run.downstreamDetailUrl));
    return run;
  } finally {
    releaseMutation();
  }
}

export function stockBotCompletionNotification(event: Pick<StockBotCompletionEvent, "status" | "results" | "error">, detailUrl?: string): string {
  const concise = event.results.slice(0, 10).map((result) => `${result.symbol ?? result.companyName ?? "Security"}: ${result.claimGrade}, ${result.opinion}`).join("\n");
  const link = detailUrl ? `\n${detailUrl}` : "";
  if (event.status === "needs_review") return `⚠️ *Stock analysis needs review — action required*\n${concise || stockBotErrorText(event.error) || "No result details"}${link}`;
  const icon = event.status === "completed" ? "✅" : event.status === "partial" ? "⚠️" : event.status === "canceled" ? "⏭️" : "❌";
  return `${icon} *Stock analysis ${event.status}*\n${concise || stockBotErrorText(event.error) || "No result details"}${link}`;
}

function detailUrlFor(analysisId: string): string | undefined {
  const base = process.env["STOCKBOT_DETAIL_BASE_URL"];
  return base ? `${base.replace(/\/$/, "")}/${encodeURIComponent(analysisId)}` : undefined;
}

async function persistCallbackState(run: Run): Promise<void> {
  const baseDir = process.env["AI_MEMORY_LOCAL_DIR"];
  if (!baseDir) return;
  const date = new Date().toISOString().slice(0, 10);
  const finding = [run.findingPath?.split("/").pop(), `stockbot:${run.downstreamAnalysisId}`, `run:${run.id}`].filter(Boolean).join(";");
  const remoteUrl = process.env["AI_MEMORY_REPO"];
  if (!remoteUrl) return;
  const deployKeyB64 = process.env["GIT_DEPLOY_KEY_B64"];
  const sshKeyPath = deployKeyB64 ? setupSshKey(deployKeyB64) : undefined;
  const repo = new AiMemoryRepo({ remoteUrl, localDir: baseDir, sshKeyPath, gitAuthor: { name: "Tech Radar Bot", email: "bot@tech-radar.local" } });
  await repo.init();
  await repo.pullLatest();
  await repo.updateInbox({ url: run.url, status: run.status, finding, date, error: run.error });
  await repo.commitAndPush(`tech-radar: StockBot ${run.status} ${run.id}`);
}
