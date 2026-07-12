import Fastify from "fastify";
import path from "node:path";
import { runPipeline, getRun, listRuns, hydrateRunsFromInbox, DuplicateRunError } from "./runner.js";
import { handleTelegramUpdate } from "./telegram.js";
import { DASHBOARD_HTML } from "./dashboard.js";
import {
  getAiMemoryDir,
  getFindingDetail,
  getPublicFindingDetail,
  listFindings,
  listPublicFindings,
  type FindingSummary,
} from "./findings.js";
import { auditFindings, auditPublicFindings, enrichmentProfile, filterCounts, filterCountsFromPublic } from "./findingAudit.js";
import { listReleaseNotes } from "./releaseNotes.js";
import { buildRssXml } from "./rss.js";
import { AiMemoryRepo, setupSshKey } from "./git.js";

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

function authMiddleware(request: any, reply: any, done: () => void): void {
  if (isAuthorized(request)) {
    done();
    return;
  }
  reply.code(401).send({ error: "Unauthorized" });
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

  aiMemorySync ??= (async () => {
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
  })().finally(() => {
    aiMemorySync = null;
  });

  await aiMemorySync;
}

export function buildServer() {
  const app = Fastify({ logger: true });

  app.addHook("onRequest", async (request, reply) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      reply.header(name, value);
    }
    reply.header("Cache-Control", NO_STORE_CACHE_CONTROL);
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

  // Set auth token cookie via ?token= query param (one-time web UI flow)
  app.addHook("onRequest", async (request, reply) => {
    const token = (request.query as Record<string, string>)?.["token"];
    if (token && token === process.env["AUTH_TOKEN"]) {
      reply.header("Set-Cookie", `auth_token=${token}; HttpOnly; SameSite=Strict; Path=/`);
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
    const runs = listRuns();
    reply.header("Content-Type", "text/html; charset=utf-8");
    return DASHBOARD_HTML(runs);
  });

  app.post<{ Body: { url: string } }>(
    "/runs",
    { preHandler: authMiddleware },
    async (request, reply) => {
      const { url } = request.body;
      if (!url || typeof url !== "string") {
        return reply.code(400).send({ error: "url is required" });
      }
      // Check for duplicate before queuing
      try {
        // runPipeline registers the run synchronously before its first await,
        // so listRuns()[0] is reliably set after one microtask tick.
        runPipeline(url).catch(() => {}); // errors are captured inside runPipeline
      } catch (err) {
        if (err instanceof DuplicateRunError) {
          return reply.code(409).send({ error: `URL already ${err.existingRun.status}`, runId: err.existingRun.id });
        }
        throw err;
      }
      await Promise.resolve(); // yield to let runPipeline register the run
      const latest = listRuns()[0];
      return reply.code(202).send({ runId: latest?.id ?? "unknown" });
    },
  );

  // Telegram webhook — Telegram POSTs updates here
  app.post<{ Body: Record<string, unknown> }>(
    "/telegram/webhook",
    async (request, reply) => {
      // Verify it's from our bot via secret token header
      const secret = process.env["TELEGRAM_WEBHOOK_SECRET"];
      if (secret && request.headers["x-telegram-bot-api-secret-token"] !== secret) {
        return reply.code(401).send();
      }
      handleTelegramUpdate(request.body).catch(() => {});
      return reply.code(200).send();
    },
  );

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
    return { findings: listFindings() };
  });

  app.get("/api/audit", { preHandler: authMiddleware }, async () => {
    await ensureAiMemoryCheckout();
    const findings = listFindings();
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
  // Hydrate run history from persisted INBOX.md on startup
  const aiMemoryDir = process.env["AI_MEMORY_LOCAL_DIR"];
  if (aiMemoryDir) {
    hydrateRunsFromInbox(path.join(aiMemoryDir, "tech-radar", "INBOX.md"));
  }

  if (!process.env["AI_MEMORY_REPO_URL"]) {
    console.warn("[warn] AI_MEMORY_REPO_URL not set — Telegram finding links will be bare paths");
  }

  const app = buildServer();
  const port = Number(process.env["PORT"] ?? 3000);
  await app.listen({ port, host: "0.0.0.0" });
  console.log(`listening on port ${port}`);
}
