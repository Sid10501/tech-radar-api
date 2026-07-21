import Fastify from "fastify";
import multipart from "@fastify/multipart";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import os from "node:os";
import { runPipeline, runMediaPipeline, getRun, listRuns, hydrateRunsFromInbox, recoverAndEnqueueRuns, DuplicateRunError, applyStockBotCompletion, findMediaRunBySubmission } from "./runner.js";
import { MAX_LOCAL_MEDIA_BYTES } from "./localMedia.js";
import { handleTelegramUpdate } from "./telegram.js";
import { DASHBOARD_HTML } from "./dashboard.js";
import {
  getAiMemoryDir,
  getFindingDetail,
  getPublicFindingDetail,
  listClusteredFindings,
  listFindings,
  listPublicFindings,
  type FindingSummary,
} from "./findings.js";
import { auditFindings, auditPublicFindings, enrichmentProfile, filterCounts, filterCountsFromPublic } from "./findingAudit.js";
import { listReleaseNotes } from "./releaseNotes.js";
import { buildRssXml } from "./rss.js";
import { AiMemoryRepo, setupSshKey, withAiMemoryRepoMutation } from "./git.js";
import { canonicalizeSocialUrl, type SocialVideoIntent } from "./socialVideoRouting.js";
import { StockBotEventDeduper, verifyStockBotCallback } from "./stockbotCallback.js";
import { verifyUploadToken, type UploadClaims } from "./uploadAuthorization.js";

const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; object-src 'none'",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
} as const;
const NO_STORE_CACHE_CONTROL = "no-store, max-age=0";

interface EnrichCandidate {
  finding: FindingSummary;
  enrichment: ReturnType<typeof enrichmentProfile>;
}

function isSameSourceDuplicate(finding: FindingSummary): boolean {
  return finding.diagnostics.duplicateGroup?.reason === "same source URL";
}

function enrichCandidatePayload({ finding, enrichment }: EnrichCandidate) {
  return {
    id: finding.id,
    title: finding.title,
    sourceUrl: finding.source.url,
    quality: {
      level: finding.quality.level,
      score: finding.quality.score,
    },
    triage: finding.triage,
    enrichment,
  };
}

function skippedDuplicatePayload({ finding }: EnrichCandidate) {
  return {
    id: finding.id,
    title: finding.title,
    sourceUrl: finding.source.url,
    reason: "same_source_duplicate" as const,
  };
}

function getCookieValue(cookieHeader: unknown, name: string): string | undefined {
  const raw = Array.isArray(cookieHeader) ? cookieHeader.join(";") : cookieHeader;
  if (typeof raw !== "string") return undefined;
  for (const pair of raw.split(";")) {
    const [key, ...valueParts] = pair.trim().split("=");
    if (key === name) {
      return decodeURIComponent(valueParts.join("="));
    }
  }
  return undefined;
}

function isAuthorized(request: any): boolean {
  const authToken = process.env["AUTH_TOKEN"];
  if (!authToken) return true;
  // Accept bearer token or cookie
  const bearer = request.headers["authorization"]?.replace(/^Bearer\s+/i, "");
  const cookie = getCookieValue(request.headers["cookie"], "auth_token");
  return bearer === authToken || cookie === authToken;
}

function isOwnerAuthorized(request: any): boolean {
  const authToken = process.env["AUTH_TOKEN"];
  if (!authToken) return false;
  const bearer = request.headers["authorization"]?.replace(/^Bearer\s+/i, "");
  const cookie = getCookieValue(request.headers["cookie"], "auth_token");
  return bearer === authToken || cookie === authToken;
}

function authMiddleware(request: any, reply: any, done: () => void): void {
  if (isAuthorized(request)) {
    done();
    return;
  }
  reply.code(401).send({ error: "Unauthorized" });
}

function safeUploadExtension(filename: string, mimeType: string): string | null {
  const extension = path.extname(path.basename(filename)).toLowerCase();
  const allowed = new Set([".mp4", ".mov", ".m4v", ".webm", ".mp3", ".m4a", ".wav", ".ogg"]);
  if (allowed.has(extension)) return extension;
  const byMime: Record<string, string> = { "video/mp4": ".mp4", "video/quicktime": ".mov", "video/webm": ".webm", "audio/mpeg": ".mp3", "audio/mp4": ".m4a", "audio/wav": ".wav", "audio/ogg": ".ogg" };
  return byMime[mimeType.toLowerCase()] ?? null;
}

function publicFeedAllowedOrigins(): Set<string> {
  return new Set(
    (process.env["PUBLIC_FEED_ALLOWED_ORIGINS"] ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

let aiMemorySync: Promise<void> | null = null;
let aiMemorySyncedAt = 0;
const AI_MEMORY_SYNC_TTL_MS = Number(process.env["AI_MEMORY_SYNC_TTL_MS"] ?? 60_000);

async function ensureAiMemoryCheckout(): Promise<void> {
  const localDir = getAiMemoryDir();
  const remoteUrl = process.env["AI_MEMORY_REPO"] ?? "";
  if (!remoteUrl) return;
  if (Date.now() - aiMemorySyncedAt < AI_MEMORY_SYNC_TTL_MS) return;

  aiMemorySync ??= withAiMemoryRepoMutation(async () => {
    let sshKeyPath: string | undefined;
    const deployKeyB64 = process.env["GIT_DEPLOY_KEY_B64"];
    if (deployKeyB64) {
      sshKeyPath = setupSshKey(deployKeyB64);
    }
    const repo = new AiMemoryRepo({
      remoteUrl,
      localDir,
      gitAuthor: { name: "Tech Radar Bot", email: "bot@tech-radar.local" },
      sshKeyPath,
    });
    await repo.init();
    await repo.pullLatest();
    aiMemorySyncedAt = Date.now();
  }).finally(() => {
    aiMemorySync = null;
  });

  await aiMemorySync;
}

type EventReservationStore = Pick<StockBotEventDeduper, "begin" | "state" | "markApplied" | "forget"> & Partial<Pick<StockBotEventDeduper, "startHeartbeat">>;

export function buildServer(dependencies: { callbackEvents?: EventReservationStore; consumedUploadTokens?: EventReservationStore } = {}) {
  if (process.env["NODE_ENV"] === "production") {
    const configured = process.env["RUN_STATE_DIR"];
    const resolved = configured ? path.resolve(configured) : "";
    const temporaryRoot = path.resolve(os.tmpdir());
    if (!resolved || resolved === temporaryRoot || resolved.startsWith(`${temporaryRoot}${path.sep}`) || resolved === "/tmp" || resolved.startsWith("/tmp/")) {
      throw new Error("production RUN_STATE_DIR must be configured on persistent storage");
    }
    if (!process.env["AUTH_TOKEN"]?.trim()) throw new Error("production AUTH_TOKEN must be configured for private owner surfaces");
  }
  const app = Fastify({ logger: true });
  app.register(multipart, { limits: { files: 1, fileSize: MAX_LOCAL_MEDIA_BYTES, fields: 10, parts: 11 } });
  const callbackStatePath = process.env["RUN_STATE_DIR"]
    ? path.join(path.resolve(process.env["RUN_STATE_DIR"]), "stockbot-callback-events.json")
    : process.env["AI_MEMORY_LOCAL_DIR"]
      ? path.join(process.env["AI_MEMORY_LOCAL_DIR"], "tech-radar", "stockbot-callback-events.json")
      : undefined;
  if (process.env["RUN_STATE_DIR"] && process.env["AI_MEMORY_LOCAL_DIR"] && callbackStatePath && !fs.existsSync(callbackStatePath)) {
    const legacy = path.join(process.env["AI_MEMORY_LOCAL_DIR"], "tech-radar", "stockbot-callback-events.json");
    if (fs.existsSync(legacy)) {
      fs.mkdirSync(path.dirname(callbackStatePath), { recursive: true, mode: 0o700 });
      fs.copyFileSync(legacy, callbackStatePath);
    }
  }
  const callbackEvents = dependencies.callbackEvents ?? new StockBotEventDeduper(
    1_000,
    callbackStatePath,
  );
  const consumedUploadTokens = dependencies.consumedUploadTokens ?? new StockBotEventDeduper(10_000, callbackStatePath ? path.join(path.dirname(callbackStatePath), "stockbot-upload-tokens.json") : undefined);
  const uploadAuthMiddleware = (request: any, reply: any, done: () => void): void => {
    const bearer = request.headers["authorization"]?.replace(/^Bearer\s+/i, "");
    if (process.env["STOCKBOT_DISPATCH_TOKEN"] && bearer === process.env["STOCKBOT_DISPATCH_TOKEN"]) return done();
    const token = request.headers["x-stockbot-upload-token"];
    if (typeof token !== "string") return reply.code(401).send({ error: "Upload authorization required" });
    try {
      const origin = request.headers.origin;
      const allowed = new Set((process.env["STOCKBOT_UPLOAD_ALLOWED_ORIGINS"] ?? "").split(",").map((value) => value.trim()).filter(Boolean));
      if (typeof origin !== "string" || !allowed.has(origin)) return reply.code(403).send({ error: "Upload Origin is not allowed" });
      request.uploadClaims = verifyUploadToken(token, process.env["STOCKBOT_UPLOAD_SECRET"] ?? "");
      request.uploadToken = token;
      done();
    } catch (error) {
      reply.code(401).send({ error: error instanceof Error ? error.message : "Invalid upload authorization" });
    }
  };
  const dispatchAuthMiddleware = (request: any, reply: any, done: () => void): void => {
    const bearer = request.headers["authorization"]?.replace(/^Bearer\s+/i, "");
    if (process.env["STOCKBOT_DISPATCH_TOKEN"] && bearer === process.env["STOCKBOT_DISPATCH_TOKEN"]) return done();
    if (isOwnerAuthorized(request)) return done();
    reply.code(401).send({ error: "Unauthorized" });
  };

  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (request, body, done) => {
    const rawBody = (body as Buffer).toString("utf8");
    (request as typeof request & { rawBody?: string }).rawBody = rawBody;
    try {
      done(null, rawBody ? JSON.parse(rawBody) : {});
    } catch (error) {
      done(error as Error, undefined);
    }
  });

  app.addHook("onRequest", async (request, reply) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      reply.header(name, value);
    }
    reply.header("Cache-Control", NO_STORE_CACHE_CONTROL);
  });

  app.addHook("onRequest", async (request, reply) => {
    if (new URL(request.url, "http://local").pathname !== "/runs/upload") return;
    const origin = request.headers.origin;
    const allowed = new Set((process.env["STOCKBOT_UPLOAD_ALLOWED_ORIGINS"] ?? "").split(",").map((value) => value.trim()).filter(Boolean));
    if (typeof origin === "string" && allowed.has(origin)) {
      reply.header("Access-Control-Allow-Origin", origin);
      reply.header("Vary", "Origin");
    }
    if (request.method === "OPTIONS") {
      if (typeof origin !== "string" || !allowed.has(origin)) return reply.code(403).send();
      reply.header("Access-Control-Allow-Methods", "POST");
      reply.header("Access-Control-Allow-Headers", "Content-Type, X-StockBot-Upload-Token");
      return reply.code(204).send();
    }
  });

  // CORS is scoped to the public feed: exact origins from PUBLIC_FEED_ALLOWED_ORIGINS, never a wildcard
  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/api/public/")) return;
    const origin = request.headers.origin;
    if (typeof origin === "string" && publicFeedAllowedOrigins().has(origin)) {
      reply.header("Access-Control-Allow-Origin", origin);
      reply.header("Vary", "Origin");
    }
    if (request.method === "OPTIONS") {
      reply.header("Access-Control-Allow-Methods", "GET");
      return reply.code(204).send();
    }
  });

  app.get("/healthz", async () => {
    return { ok: true };
  });

  app.post<{ Body: { password?: string } }>("/api/unlock", async (request, reply) => {
    const authToken = process.env["AUTH_TOKEN"];
    if (!authToken) return { ok: true };
    if (request.body?.password !== authToken) {
      return reply.code(401).send({ error: "Invalid password" });
    }
    reply.header("Set-Cookie", `auth_token=${encodeURIComponent(authToken)}; HttpOnly; SameSite=Strict; Path=/`);
    return { ok: true };
  });

  app.get("/api/session", async (request) => {
    return { privateUnlocked: isAuthorized(request) };
  });

  app.get("/", async (_request, reply) => {
    reply.header("Content-Type", "text/html; charset=utf-8");
    return DASHBOARD_HTML([]);
  });

  app.post<{ Body: { url: string; intent?: SocialVideoIntent; force?: boolean } }>(
    "/runs",
    { preHandler: dispatchAuthMiddleware },
    async (request, reply) => {
      const { url, intent = "auto", force = false } = request.body ?? {};
      if (!url || typeof url !== "string") {
        return reply.code(400).send({ error: "url is required" });
      }
      if (!["auto", "technology", "finance"].includes(intent)) {
        return reply.code(400).send({ error: "intent must be auto, technology, or finance" });
      }
      if (typeof force !== "boolean") return reply.code(400).send({ error: "force must be a boolean" });
      let canonicalUrl: string;
      try {
        canonicalUrl = canonicalizeSocialUrl(url);
      } catch {
        return reply.code(400).send({ error: "url must be an absolute http or https URL" });
      }
      try {
        const idempotencyKey = request.headers["idempotency-key"];
        if (idempotencyKey !== undefined && (typeof idempotencyKey !== "string" || !idempotencyKey.trim() || idempotencyKey.length > 300)) return reply.code(400).send({ error: "Idempotency-Key must be 1-300 characters" });
        const completion = runPipeline(canonicalUrl, { intent, origin: { channel: "api" }, idempotencyKey, force });
        completion.catch(() => {});
        return reply.code(202).send({ runId: completion.runId, status: getRun(completion.runId)?.status ?? "pending", deduplicated: false });
      } catch (err) {
        if (err instanceof DuplicateRunError) {
          if (err.idempotent) return reply.code(202).send({ runId: err.existingRun.id, status: err.existingRun.status, deduplicated: true });
          return reply.code(409).send({ error: `URL already ${err.existingRun.status}`, runId: err.existingRun.id });
        }
        throw err;
      }
    },
  );

  app.post("/runs/upload", { preHandler: uploadAuthMiddleware }, async (request, reply) => {
    const mediaDir = path.resolve(process.env["MEDIA_UPLOAD_DIR"] ?? "/tmp/tech-radar-media");
    await fs.promises.mkdir(mediaDir, { recursive: true, mode: 0o700 });
    let mediaPath: string | undefined;
    let filename = "";
    let mimeType = "";
    let intent: SocialVideoIntent = "auto";
    let originChannel: "shortcut" | "dashboard" | "api" = "api";
    let idempotencyKey: string | undefined;
    let analysisId: string | undefined;
    let uploadReservationId: string | undefined;
    const seenFields = new Set<string>();
    const allowedFields = new Set(["intent", "origin", "idempotencyKey", "analysisId"]);
    try {
      for await (const part of request.parts()) {
        if (part.type === "field") {
          if (!allowedFields.has(part.fieldname)) throw new Error(`unknown multipart field: ${part.fieldname}`);
          if (seenFields.has(part.fieldname)) throw new Error(`repeated multipart field: ${part.fieldname}`);
          seenFields.add(part.fieldname);
          if (part.fieldname === "intent") intent = String(part.value) as SocialVideoIntent;
          if (part.fieldname === "origin") {
            if (!["shortcut", "dashboard", "api"].includes(String(part.value))) throw new Error("origin must be shortcut, dashboard, or api");
            originChannel = String(part.value) as typeof originChannel;
          }
          if (part.fieldname === "idempotencyKey") idempotencyKey = String(part.value);
          if (part.fieldname === "analysisId") analysisId = String(part.value);
          continue;
        }
        if (part.fieldname !== "file") throw new Error("multipart file field must be named file");
        if (seenFields.has("file")) throw new Error("repeated multipart file field");
        seenFields.add("file");
        if (mediaPath) throw new Error("exactly one file is allowed");
        if (!/^(?:video\/|audio\/)/i.test(part.mimetype)) throw new Error("unsupported media MIME type");
        const extension = safeUploadExtension(part.filename, part.mimetype);
        if (!extension) throw new Error("unsupported media extension");
        filename = part.filename;
        mimeType = part.mimetype;
        mediaPath = path.join(mediaDir, `${randomUUID()}${extension}`);
        const handle = await fs.promises.open(mediaPath, "wx", 0o600);
        await pipeline(part.file, handle.createWriteStream());
        await handle.close().catch(() => {});
        if (part.file.truncated) throw new Error("upload exceeds the 20 MB limit");
      }
      if (!mediaPath) return reply.code(400).send({ error: "file is required" });
      if (!["auto", "technology", "finance"].includes(intent)) throw new Error("intent must be auto, technology, or finance");
      if (idempotencyKey !== undefined && !idempotencyKey.trim()) throw new Error("idempotencyKey must not be empty");
      if (idempotencyKey && idempotencyKey.length > 300) throw new Error("idempotencyKey exceeds 300 characters");
      if (analysisId !== undefined && !analysisId.trim()) throw new Error("analysisId must not be empty");
      if (analysisId && analysisId.length > 200) throw new Error("analysisId exceeds 200 characters");
      const uploadClaims = (request as typeof request & { uploadClaims?: UploadClaims; uploadToken?: string }).uploadClaims;
      if (uploadClaims) {
        const size = (await fs.promises.stat(mediaPath)).size;
        if (intent !== uploadClaims.intent || String(originChannel) !== uploadClaims.origin || idempotencyKey !== uploadClaims.idempotencyKey || analysisId !== uploadClaims.analysisId || size !== uploadClaims.size) throw new Error("multipart fields or size do not match upload token");
        uploadReservationId = `${uploadClaims.analysisId}:${uploadClaims.idempotencyKey}`;
        const existing = findMediaRunBySubmission(uploadClaims.analysisId, uploadClaims.idempotencyKey);
        if (existing) {
          try { consumedUploadTokens.markApplied(uploadReservationId); } catch { /* durable run identity remains authoritative */ }
          await fs.promises.unlink(mediaPath).catch(() => {});
          return reply.code(202).send({ runId: existing.id, status: existing.status, deduplicated: true });
        }
        if (!consumedUploadTokens.begin(uploadReservationId)) {
          await fs.promises.unlink(mediaPath).catch(() => {});
          return reply.code(409).send({ error: "upload token already consumed" });
        }
      }
      const completion = runMediaPipeline({ fileUniqueId: randomUUID(), mediaPath, intent, origin: { channel: originChannel }, mimeType, originalName: filename, idempotencyKey, analysisId });
      completion.catch(() => {});
      if (uploadReservationId) {
        try {
          consumedUploadTokens.markApplied(uploadReservationId);
        } catch {
          return reply.code(202).send({ runId: completion.runId, status: "pending" });
        }
      }
      return reply.code(202).send({ runId: completion.runId, status: "pending" });
    } catch (error) {
      if (uploadReservationId) consumedUploadTokens.forget(uploadReservationId);
      if (mediaPath) await fs.promises.unlink(mediaPath).catch(() => {});
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // Telegram webhook — Telegram POSTs updates here
  app.post<{ Body: Record<string, unknown> }>(
    "/telegram/webhook",
    async (request, reply) => {
      // Verify it's from our bot via secret token header
      const secret = process.env["TELEGRAM_WEBHOOK_SECRET"];
      if (!secret) {
        return reply.code(503).send({ error: "Telegram webhook secret is not configured" });
      }
      if (request.headers["x-telegram-bot-api-secret-token"] !== secret) {
        return reply.code(401).send();
      }
      handleTelegramUpdate(request.body).catch(() => {});
      return reply.code(200).send();
    },
  );

  app.post("/api/internal/stockbot/completion", async (request, reply) => {
    const secret = process.env["STOCKBOT_CALLBACK_SECRET"];
    if (!secret) return reply.code(503).send({ error: "StockBot callback secret is not configured" });
    const timestamp = request.headers["x-stockbot-timestamp"];
    const signature = request.headers["x-stockbot-signature"];
    const rawBody = (request as typeof request & { rawBody?: string }).rawBody ?? "";
    if (typeof timestamp !== "string" || typeof signature !== "string" || !rawBody) {
      return reply.code(401).send({ error: "Invalid StockBot callback" });
    }
    let event;
    try {
      event = verifyStockBotCallback({ rawBody, timestamp, signature, secret });
    } catch {
      return reply.code(401).send({ error: "Invalid StockBot callback" });
    }
    if (!callbackEvents.begin(event.eventId)) {
      if (callbackEvents.state(event.eventId) === "applied") return { ok: true, deduplicated: true };
      return reply.code(425).send({ error: "StockBot callback is still being applied" });
    }
    const stopHeartbeat = callbackEvents.startHeartbeat?.(event.eventId) ?? (() => {});
    try {
      const run = await applyStockBotCompletion(event);
      if (!run) {
        callbackEvents.forget(event.eventId);
        return reply.code(404).send({ error: "Run not found for analysis" });
      }
      callbackEvents.markApplied(event.eventId);
      return { ok: true, deduplicated: false };
    } catch {
      callbackEvents.forget(event.eventId);
      return reply.code(500).send({ error: "StockBot callback could not be applied" });
    } finally {
      stopHeartbeat();
    }
  });

  app.get("/runs", { preHandler: authMiddleware }, async () => {
    return listRuns();
  });

  app.get("/api/public/findings", async () => {
    await ensureAiMemoryCheckout();
    return { findings: listPublicFindings() };
  });

  app.get("/api/public/audit", async () => {
    await ensureAiMemoryCheckout();
    const findings = listPublicFindings();
    return { audit: auditPublicFindings(findings), filters: filterCountsFromPublic(findings) };
  });

  app.get("/api/public/release-notes", async () => {
    return { releases: listReleaseNotes() };
  });

  app.get("/api/public/findings/rss", async (request, reply) => {
    await ensureAiMemoryCheckout();
    const siteBase = process.env["PUBLIC_SITE_RADAR_BASE"] || `${request.protocol}://${request.headers.host}`;
    reply.header("Content-Type", "application/rss+xml; charset=utf-8");
    return buildRssXml(listPublicFindings(), { siteBase });
  });

  app.get<{ Params: { id: string } }>("/api/public/findings/:id", async (request, reply) => {
    await ensureAiMemoryCheckout();
    const detail = getPublicFindingDetail(request.params.id);
    if (!detail) return reply.code(404).send({ error: "Finding not found" });
    return detail;
  });

  app.get("/api/findings", { preHandler: authMiddleware }, async () => {
    await ensureAiMemoryCheckout();
    return { findings: listClusteredFindings() };
  });

  app.get("/api/audit", { preHandler: authMiddleware }, async () => {
    await ensureAiMemoryCheckout();
    const findings = listClusteredFindings();
    return { audit: auditFindings(findings), filters: filterCounts(findings) };
  });

  app.post<{ Params: { id: string } }>(
    "/api/admin/enrich/:id",
    { preHandler: authMiddleware },
    async (request, reply) => {
      await ensureAiMemoryCheckout();
      const detail = getFindingDetail(request.params.id);
      const sourceUrl = detail?.finding.source.url;
      if (!detail) return reply.code(404).send({ error: "Finding not found" });
      if (!sourceUrl) return reply.code(400).send({ error: "Finding has no source URL" });
      const result = await runPipeline(sourceUrl, { force: true });
      return reply.code(202).send({ queued: true, ...result });
    },
  );

  app.post<{ Body: { limit?: number; dryRun?: boolean } }>(
    "/api/admin/enrich-weak",
    { preHandler: authMiddleware },
    async (request, reply) => {
      await ensureAiMemoryCheckout();
      const requestedLimit = Number(request.body?.limit ?? 10);
      const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(50, Math.trunc(requestedLimit))) : 10;
      const retryableRows = listFindings()
        .map((finding) => ({ finding, enrichment: enrichmentProfile(finding) }))
        .filter(({ finding, enrichment }) => enrichment.status === "needs-enrichment" && finding.source.url);
      const skippedDuplicates = retryableRows.filter(({ finding }) => isSameSourceDuplicate(finding)).map(skippedDuplicatePayload);
      const candidates = retryableRows.filter(({ finding }) => !isSameSourceDuplicate(finding)).slice(0, limit);
      if (request.body?.dryRun === true) {
        return reply.code(200).send({
          dryRun: true,
          limit,
          matched: candidates.length,
          queued: 0,
          candidates: candidates.map(enrichCandidatePayload),
          skippedDuplicates,
          runs: [],
        });
      }
      const runs = [];
      for (const { finding } of candidates) {
        runs.push(await runPipeline(finding.source.url!, { force: true }));
      }
      return reply.code(202).send({
        dryRun: false,
        limit,
        matched: candidates.length,
        queued: runs.length,
        candidates: [],
        skippedDuplicates,
        runs,
      });
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/findings/:id",
    { preHandler: authMiddleware },
    async (request, reply) => {
      await ensureAiMemoryCheckout();
      const detail = getFindingDetail(request.params.id);
      if (!detail) return reply.code(404).send({ error: "Finding not found" });
      return detail;
    },
  );

  app.get<{ Params: { id: string } }>(
    "/runs/:id",
    { preHandler: authMiddleware },
    async (request, reply) => {
      const run = getRun(request.params.id);
      if (!run) return reply.code(404).send({ error: "Run not found" });
      return run;
    },
  );

  return app;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const app = buildServer();
  // Hydrate run history from persisted INBOX.md on startup
  const aiMemoryDir = process.env["AI_MEMORY_LOCAL_DIR"];
  if (aiMemoryDir) {
    hydrateRunsFromInbox(path.join(aiMemoryDir, "tech-radar", "INBOX.md"));
  }
  recoverAndEnqueueRuns();

  if (!process.env["AI_MEMORY_REPO_URL"]) {
    console.warn("[warn] AI_MEMORY_REPO_URL not set — Telegram finding links will be bare paths");
  }

  const port = Number(process.env["PORT"] ?? 3000);
  await app.listen({ port, host: "0.0.0.0" });
  console.log(`listening on port ${port}`);
}
