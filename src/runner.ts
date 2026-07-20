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
import { cleanupRegisteredMedia, extractLocalMedia } from "./localMedia.js";

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
    const validStatus = ["pending", "running", "awaiting_media", "downstream_pending", "processed", "partial", "needs_review", "failed", "skipped"].includes(status)
      ? (status as Run["status"])
      : "processed";
    const recoveredStatus = validStatus === "running" ? "pending" : validStatus;
    const persistedRunId = finding?.match(/(?:^|;)run:([A-Za-z0-9-]+)/)?.[1];
    const downstreamAnalysisId = finding?.match(/(?:^|;)stockbot:([^;|]+)/)?.[1];
    const persistedFinding = finding?.split(";").find((part) => part.endsWith(".md"));
    const run: Run = {
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
    storeRun(run);
  }
}

function storeRun(run: Run): void {
  runs.set(run.id, run);
  if (runs.size > 50) {
    const oldest = runs.keys().next().value!;
    runs.delete(oldest);
  }
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

const executingRuns = new Set<string>();

export function recoverAndEnqueueRuns(opts: RunPipelineOptions = {}): number {
  const stateDir = runStateDir();
  if (stateDir && fs.existsSync(stateDir)) {
    for (const name of fs.readdirSync(stateDir).filter((entry) => entry.endsWith(".json"))) {
      try {
        const recovered = JSON.parse(fs.readFileSync(path.join(stateDir, name), "utf8")) as Run;
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
        if (!id || runs.has(id) || !sidecar.mediaPath) continue;
        const uploadState = sidecar as typeof sidecar & { idempotencyKey?: string; analysisId?: string };
        storeRun({ id, url: sidecar.url ?? `https://uploads.invalid/${encodeURIComponent(id)}`, status: "awaiting_media", intent: sidecar.intent, origin: sidecar.origin, mediaPath: sidecar.mediaPath, evidenceIdempotencyKey: uploadState.idempotencyKey, downstreamAnalysisId: uploadState.analysisId, startedAt: sidecar.startedAt ?? new Date().toISOString() });
      } catch { /* ignore malformed sidecars */ }
    }
  }
  let enqueued = 0;
  for (const run of runs.values()) {
    if (!["pending", "awaiting_media"].includes(run.status) || executingRuns.has(run.id)) continue;
    enqueued++;
    void executeRegisteredPipeline(run, opts).catch(() => {});
  }
  return enqueued;
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
  constructor(public readonly existingRun: Run) {
    super(`URL already ${existingRun.status}: ${existingRun.url}`);
    this.name = "DuplicateRunError";
  }
}

export function registerPipelineRun(url: string, opts: RunPipelineOptions = {}): Run {
  const canonicalUrl = canonicalizeSocialUrl(url);
  if (!opts.force) {
    const requestedIntent = opts.intent ?? "technology";
    const existing = [...runs.values()].find((candidate) =>
      canonicalizeIfPossible(candidate.url) === canonicalUrl
      && intentsOverlap(candidate.intent ?? "technology", requestedIntent)
      && ["pending", "running", "awaiting_media", "downstream_pending", "processed", "partial"].includes(candidate.status));
    if (existing && ["pending", "running", "awaiting_media", "downstream_pending", "processed"].includes(existing.status)) {
      throw new DuplicateRunError(existing);
    }
  }
  const run: Run = {
    id: randomUUID(),
    url: canonicalUrl,
    status: "pending",
    intent: opts.intent ?? "technology",
    origin: opts.origin ?? { channel: "api" },
    startedAt: new Date().toISOString(),
  };
  storeRun(run);
  return run;
}

function intentsOverlap(existing: SocialVideoIntent, requested: SocialVideoIntent): boolean {
  if (existing === "auto" || requested === "auto") return true;
  return existing === requested;
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
    downstreamAnalysisId: input.analysisId,
    startedAt: new Date().toISOString(),
  };
  fs.writeFileSync(`${input.mediaPath}.run.json`, JSON.stringify({
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
    await repo.updateInbox({ url, status: "pending", finding: `run:${run.id}`, date: today });
    await repo.commitAndPush(`tech-radar: pending ${url.slice(0, 60)}`);

    // Step 1: Extract
    const extractResult = run.mediaPath
      ? await extractLocalMedia({ runId, mediaPath: run.mediaPath })
      : await extract(url);

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
      if (run.mediaPath) await cleanupRegisteredMedia(run.mediaPath);
      releaseSlot();
      executingRuns.delete(runId);
      return { runId, findingPath: "" };
    }

    const enrichedExtract = await extractAndEnrich(extractResult);
    let findingPath = "";
    let childCount = 0;
    let findingFilename = "";

    const routed = await routeEnrichedExtract(enrichedExtract, run.intent ?? "technology", {
      classifier: opts.classifier,
      technology: async (sharedExtract) => {
        const researchResult = await runResearch(sharedExtract);
        const implementationMemoryDir = configuredAiMemoryDir && fs.existsSync(path.join(configuredAiMemoryDir, "GLOBAL_MEMORY.md"))
          ? configuredAiMemoryDir
          : localDir;
        const implementationResult = await runImplementation(sharedExtract, researchResult, implementationMemoryDir);
        const composed = composeFinding({ extract: sharedExtract, research: researchResult, implementation: implementationResult });
        const write = await repo.writeFindingForSource({ sourceUrl: url, filename: composed.filename, body: composed.body, date: today });
        await repo.updateIndex({ date: today, title: sharedExtract.title ?? write.filename, finding: write.filename, targetProject: implementationResult.target_project });
        for (const row of childArtifactInboxRows(sharedExtract, { date: today, parentFinding: write.filename })) {
          if (await repo.updateInboxIfMissing(row)) childCount++;
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
        run.financeHandoffCompleted = true;
        storeRun(run);
        return submission;
      },
    });

    const requestedFinance = routed.classification.category === "finance" || routed.classification.category === "mixed";
    const branchErrors = Object.values(routed.branchErrors ?? {});
    const noRoutedBranch = ["other", "needs_review"].includes(routed.classification.category);
    const hasFinance = Boolean(routed.finance);
    run.status = noRoutedBranch ? "needs_review" : branchErrors.length ? (hasFinance || routed.technology ? "partial" : "failed") : hasFinance ? "downstream_pending" : "processed";
    run.error = branchErrors.length ? branchErrors.join("; ").slice(0, 1_000) : undefined;
    run.finishedAt = run.status === "downstream_pending" ? undefined : new Date().toISOString();
    const inboxFinding = hasFinance
      ? [findingFilename || null, `stockbot:${run.downstreamAnalysisId}`, `run:${run.id}`].filter(Boolean).join(";")
      : findingFilename;
    await repo.updateInbox({ url, status: run.status, finding: inboxFinding || null, date: today });
    await repo.commitAndPush(hasFinance ? `tech-radar: StockBot handoff ${run.id}` : `tech-radar: ${run.status} ${run.id}`);
    storeRun(run);

    if (noRoutedBranch) {
      sendTelegram(`⚠️ *Needs review*\n\n${url.slice(0, 80)}\n\n${routed.classification.reasons.join("; ").slice(0, 300)}`);
    } else if (branchErrors.length) {
      sendTelegram(`⚠️ *Partial social-video analysis*\n\n${url.slice(0, 80)}\n\n${branchErrors.join("; ").slice(0, 300)}`);
    } else if (!requestedFinance && findingFilename) {
      const repoUrl = process.env["AI_MEMORY_REPO_URL"] ?? "";
      const fileLink = repoUrl ? `${repoUrl}/blob/master/${findingPath}` : findingPath;
      const childNote = childCount > 0 ? `\nQueued child artifacts: ${childCount}` : "";
      sendTelegram(`✅ *Tech Radar finding ready*\n\n[${findingFilename.replace(".md", "")}](${fileLink})\n\nSource: ${url.slice(0, 60)}${childNote}`);
    }

    if (run.mediaPath) await cleanupRegisteredMedia(run.mediaPath);
    releaseSlot();
    executingRuns.delete(runId);
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

    if (run.mediaPath) await cleanupRegisteredMedia(run.mediaPath);
    releaseSlot();
    executingRuns.delete(runId);
    throw err;
  }
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
  const durationSeconds = input.extract.duration_sec == null ? undefined : input.extract.duration_sec;
  const durationMs = Math.round((durationSeconds ?? 0) * 1_000);
  const transcriptText = input.extract.transcript?.trim();
  const methods = new Set(input.extract.extraction_methods ?? []);
  if (input.extract.transcript_source) methods.add(input.extract.transcript_source);
  if (input.extract.visual_text_source) methods.add(input.extract.visual_text_source);
  if (input.extract.enriched_links) methods.add("link_enrichment");
  const sources = [
    { text: input.extract.caption?.trim(), timed: false },
    { text: transcriptText, timed: true },
    { text: input.extract.visual_text?.trim(), timed: false },
  ].filter((source): source is { text: string; timed: boolean } => Boolean(source.text));
  const securities = extractSecurityMentions(sources).slice(0, 10);
  const publishedAt = normalizePublishedAt(input.extract.upload_date);
  return SocialVideoEvidenceV1Schema.parse({
    schemaVersion: 1,
    idempotencyKey: input.idempotencyKey ?? `${input.runId}:finance-v1`,
    origin: { ...input.origin, runId: input.runId },
    source: {
      url: input.extract.url,
      canonicalUrl: input.canonicalUrl,
      platform: input.extract.platform,
      externalId: externalIdFromUrl(input.canonicalUrl),
      title: input.extract.title ?? undefined,
      creator: input.extract.creator ?? undefined,
      publishedAt,
      durationSeconds,
    },
    classification: input.classification,
    transcript: {
      method: input.extract.transcript_source ?? undefined,
      segments: transcriptText ? [{ startMs: 0, endMs: Math.min(1_800_000, durationMs), text: transcriptText }] : [],
    },
    visualTexts: input.extract.visual_text?.trim()
      ? [{ text: input.extract.visual_text, method: input.extract.visual_text_source ?? undefined }]
      : [],
    extraction: { methods: [...methods], warnings: input.extract.extraction_warnings ?? [] },
    financeClaims: {
      securities: securities.map((security) => ({
        ...security,
        claims: sources.map((source) => ({
          text: source.text,
          confidence: 0.5,
          ...(source.timed ? { startMs: 0, endMs: Math.min(1_800_000, durationMs) } : {}),
        })),
      })),
    },
  });
}

function extractSecurityMentions(sources: Array<{ text: string }>): Array<{
  symbol?: string;
  exchange?: string;
  companyName?: string;
  assetType: "stock" | "etf" | "unsupported";
  confidence: number;
}> {
  const text = sources.map((source) => source.text).join("\n");
  const bySymbol = new Map<string, { symbol: string; exchange?: string; companyName?: string; assetType: "stock" | "etf" | "unsupported"; confidence: number }>();
  const matches = [
    ...text.matchAll(/\$([A-Z][A-Z0-9.-]{0,9})\b/g),
    ...text.matchAll(/\b(NASDAQ|NYSE|TSX|ASX|LSE)\s*:\s*([A-Z][A-Z0-9.-]{0,9})\b/g),
  ];
  for (const match of matches) {
    const symbol = (match[2] ?? match[1]).toUpperCase();
    const exchange = match[2] ? match[1].toUpperCase() : undefined;
    const nearby = text.slice(Math.max(0, (match.index ?? 0) - 80), (match.index ?? 0) + match[0].length + 80);
    const isEtf = /\bETF\b/i.test(nearby);
    bySymbol.set(symbol, { symbol, exchange, assetType: isEtf ? "etf" : "stock", confidence: exchange ? 0.85 : 0.7 });
  }
  const company = text.match(/\b([A-Z][A-Za-z&.' -]{1,80}(?:Inc\.?|Corp\.?|Corporation|Ltd\.?|Limited|PLC))\s*\(([A-Z][A-Z0-9.-]{0,9})\)/);
  if (company) {
    const symbol = company[2];
    const current = bySymbol.get(symbol);
    bySymbol.set(symbol, { symbol, companyName: company[1].trim(), assetType: current?.assetType ?? "stock", exchange: current?.exchange, confidence: 0.9 });
  }
  if (bySymbol.size === 0 && /\b(?:stock|shares?|security|company|investment)\b/i.test(text)) {
    return [{ assetType: "unsupported", confidence: 0.2 }];
  }
  return [...bySymbol.values()];
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

export function applyStockBotCompletion(event: StockBotCompletionEvent): Run | undefined {
  const run = [...runs.values()].find((candidate) => candidate.downstreamAnalysisId === event.analysisId);
  if (!run) return undefined;
  run.downstreamStatus = event.status;
  run.downstreamDetailUrl = event.detailUrl ?? detailUrlFor(event.analysisId);
  if (event.status === "completed") {
    run.status = "processed";
    run.finishedAt = new Date().toISOString();
  } else if (event.status === "failed") {
    run.status = "failed";
    run.error = stockBotErrorText(event.error) ?? "StockBot analysis failed";
    run.finishedAt = new Date().toISOString();
  } else {
    run.status = "downstream_pending";
  }
  storeRun(run);
  persistCallbackState(run);
  const concise = event.results.slice(0, 10).map((result) => `${result.symbol ?? result.companyName ?? "Security"}: ${result.claimGrade}, ${result.opinion}`).join("\n");
  const link = run.downstreamDetailUrl ? `\n${run.downstreamDetailUrl}` : "";
  sendTelegram(`${event.status === "completed" ? "✅" : "❌"} *Stock analysis ${event.status}*\n${concise || stockBotErrorText(event.error) || "No result details"}${link}`);
  return run;
}

function detailUrlFor(analysisId: string): string | undefined {
  const base = process.env["STOCKBOT_DETAIL_BASE_URL"];
  return base ? `${base.replace(/\/$/, "")}/${encodeURIComponent(analysisId)}` : undefined;
}

function persistCallbackState(run: Run): void {
  const baseDir = process.env["AI_MEMORY_LOCAL_DIR"];
  if (!baseDir) return;
  const inboxPath = path.join(baseDir, "tech-radar", "INBOX.md");
  if (!fs.existsSync(inboxPath)) return;
  const lines = fs.readFileSync(inboxPath, "utf8").split("\n");
  const index = lines.findIndex((line) => line.includes(`| ${run.url} |`));
  if (index < 0) return;
  const date = new Date().toISOString().slice(0, 10);
  const finding = [run.findingPath?.split("/").pop(), `stockbot:${run.downstreamAnalysisId}`, `run:${run.id}`].filter(Boolean).join(";");
  lines[index] = `| ${date} | ${run.url} | ${run.status} | ${finding} | ${(run.error ?? "").slice(0, 120).replace(/\|/g, "/")} |`;
  fs.writeFileSync(inboxPath, lines.join("\n"), "utf8");
}
