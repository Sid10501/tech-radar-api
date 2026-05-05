import Fastify from "fastify";
import { runPipeline, getRun, listRuns } from "./runner.js";
import { handleTelegramUpdate } from "./telegram.js";

const HTML_TEMPLATE = (runs: ReturnType<typeof listRuns>) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Tech Radar</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; }
    h1 { font-size: 1.5rem; }
    form { display: flex; gap: .5rem; margin: 1.5rem 0; }
    input[type=url] { flex: 1; padding: .5rem; border: 1px solid #ccc; border-radius: 4px; font-size: 1rem; }
    button { padding: .5rem 1rem; background: #0070f3; color: white; border: none; border-radius: 4px; cursor: pointer; }
    table { width: 100%; border-collapse: collapse; font-size: .9rem; }
    th, td { text-align: left; padding: .5rem .75rem; border-bottom: 1px solid #eee; }
    th { background: #f5f5f5; font-weight: 600; }
    .status-processed { color: #0a7; }
    .status-failed { color: #c00; }
    .status-running, .status-pending { color: #777; }
  </style>
</head>
<body>
  <h1>Tech Radar</h1>
  <form method="POST" action="/runs" id="form">
    <input type="url" name="url" placeholder="Paste a TikTok, YouTube, or Instagram URL…" required>
    <button type="submit">Research</button>
  </form>
  <table>
    <thead><tr><th>Status</th><th>URL</th><th>Finding</th><th>Started</th></tr></thead>
    <tbody>
      ${runs.map((r) => `<tr>
        <td class="status-${r.status}">${r.status}</td>
        <td><a href="${r.url}" target="_blank" rel="noopener">${r.url.slice(0, 60)}${r.url.length > 60 ? "…" : ""}</a></td>
        <td>${r.findingPath ? `<a href="${process.env["AI_MEMORY_REPO_URL"] ? process.env["AI_MEMORY_REPO_URL"] + "/blob/master/" + r.findingPath : r.findingPath}" target="_blank" rel="noopener">${r.findingPath.split("/").pop()}</a>` : r.error ?? ""}</td>
        <td>${new Date(r.startedAt).toLocaleString()}</td>
      </tr>`).join("")}
    </tbody>
  </table>
  <script>
    // Submit form as JSON via fetch, then reload
    document.getElementById("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const url = e.target.url.value;
      const token = document.cookie.match(/auth_token=([^;]+)/)?.[1];
      const res = await fetch("/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + (token || "") },
        body: JSON.stringify({ url }),
      });
      if (res.ok) { window.location.reload(); }
      else { alert("Error: " + (await res.text())); }
    });
    // Auto-refresh if any run is in-flight
    const inFlight = ${JSON.stringify(runs.some((r) => r.status === "running" || r.status === "pending"))};
    if (inFlight) setTimeout(() => window.location.reload(), 5000);
  </script>
</body>
</html>`;

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
    return HTML_TEMPLATE(runs);
  });

  app.post<{ Body: { url: string } }>(
    "/runs",
    { preHandler: authMiddleware },
    async (request, reply) => {
      const { url } = request.body;
      if (!url || typeof url !== "string") {
        return reply.code(400).send({ error: "url is required" });
      }
      // runPipeline registers the run synchronously before its first await,
      // so listRuns()[0] is reliably set after one microtask tick.
      runPipeline(url).catch(() => {}); // errors are captured inside runPipeline
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
  const port = Number(process.env["PORT"] ?? 3000);
  await app.listen({ port, host: "0.0.0.0" });
  console.log(`listening on port ${port}`);
}
