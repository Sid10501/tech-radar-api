import Fastify from "fastify";
import path from "node:path";
import { runPipeline, getRun, listRuns, hydrateRunsFromInbox, DuplicateRunError } from "./runner.js";
import { handleTelegramUpdate } from "./telegram.js";
import { DASHBOARD_HTML } from "./dashboard.js";
import { getFindingDetail, listFindings } from "./findings.js";

function authMiddleware(request: any, reply: any, done: () => void): void {
  const authToken = process.env["AUTH_TOKEN"];
  if (!authToken) {
    done();
    return;
  }
  // Accept bearer token or cookie
  const bearer = request.headers["authorization"]?.replace(/^Bearer\s+/i, "");
  const cookie = request.cookies?.auth_token;
  if (bearer === authToken || cookie === authToken) {
    done();
    return;
  }
  reply.code(401).send({ error: "Unauthorized" });
}

export function buildServer() {
  const app = Fastify({ logger: true });

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

  app.get("/api/findings", { preHandler: authMiddleware }, async () => {
    return { findings: listFindings() };
  });

  app.get<{ Params: { id: string } }>(
    "/api/findings/:id",
    { preHandler: authMiddleware },
    async (request, reply) => {
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
