import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHmac } from "node:crypto";
import { StockBotEventDeduper } from "../src/stockbotCallback.js";

const gitMocks = vi.hoisted(() => ({
  init: vi.fn(async () => {}),
  pullLatest: vi.fn(async () => {}),
  setupSshKey: vi.fn(() => "/tmp/mock-key"),
}));

// Mock runner before importing server so the routes work without a real pipeline
vi.mock("../src/runner.js", () => ({
  runPipeline: vi.fn(() => Object.assign(
    Promise.resolve({ runId: "mock-run-id", findingPath: "tech-radar/findings/test.md" }),
    { runId: "mock-run-id" },
  )),
  runMediaPipeline: vi.fn(() => Object.assign(
    Promise.resolve({ runId: "mock-upload-run", findingPath: "" }),
    { runId: "mock-upload-run" },
  )),
  getRun: vi.fn((id: string) => id === "existing" ? { id, url: "https://x.com", status: "processed", startedAt: new Date().toISOString() } : undefined),
  listRuns: vi.fn(() => [{ id: "existing", url: "https://x.com", status: "processed", startedAt: new Date().toISOString() }]),
  applyStockBotCompletion: vi.fn(() => ({ id: "finance-run", status: "processed" })),
  findMediaRunBySubmission: vi.fn(() => undefined),
  DuplicateRunError: class DuplicateRunError extends Error {
    constructor(public existingRun: any, public idempotent = false) { super("duplicate"); }
  },
}));

vi.mock("../src/git.js", () => ({
  setupSshKey: gitMocks.setupSshKey,
  withAiMemoryRepoMutation: vi.fn(async (operation: () => Promise<unknown>) => operation()),
  AiMemoryRepo: vi.fn().mockImplementation(() => ({
    init: gitMocks.init,
    pullLatest: gitMocks.pullLatest,
  })),
}));

const { buildServer } = await import("../src/server.js");
const runnerMock = await import("../src/runner.js");

const EXPECTED_SECURITY_HEADERS = {
  "content-security-policy":
    "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; object-src 'none'",
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
};
const EXPECTED_CACHE_CONTROL = "no-store, max-age=0";

function expectSecurityHeaders(headers: Record<string, unknown>) {
  expect(headers).toMatchObject(EXPECTED_SECURITY_HEADERS);
}

function expectNoPrivateFindingFields(value: unknown) {
  if (Array.isArray(value)) {
    value.forEach(expectNoPrivateFindingFields);
    return;
  }
  if (!value || typeof value !== "object") return;
  expect(value).not.toHaveProperty("targetProject");
  expect(value).not.toHaveProperty("verdict");
  expect(value).not.toHaveProperty("recommendedAction");
  Object.values(value).forEach(expectNoPrivateFindingFields);
}

function uploadToken(claims: Record<string, unknown>, secret: string): string {
  const sorted = Object.fromEntries(Object.entries(claims).sort(([a], [b]) => a.localeCompare(b)));
  const segment = Buffer.from(JSON.stringify(sorted)).toString("base64url");
  return `${segment}.${createHmac("sha256", secret).update(segment).digest("hex")}`;
}

describe("server routes", () => {
  const app = buildServer();

  beforeAll(() => app.ready());
  beforeEach(() => {
    vi.mocked(runnerMock.runPipeline).mockClear();
  });
  afterAll(() => app.close());

  it("GET /healthz returns 200 with { ok: true }", async () => {
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expectSecurityHeaders(res.headers);
    expect(res.json()).toEqual({ ok: true });
  });

  it("refuses production startup without a persistent RUN_STATE_DIR", () => {
    const previousNodeEnv = process.env["NODE_ENV"]; const previousStateDir = process.env["RUN_STATE_DIR"];
    process.env["NODE_ENV"] = "production"; process.env["RUN_STATE_DIR"] = "/tmp/tech-radar-runs";
    try { expect(() => buildServer()).toThrow(/persistent storage/i); }
    finally { if (previousNodeEnv === undefined) delete process.env["NODE_ENV"]; else process.env["NODE_ENV"] = previousNodeEnv; if (previousStateDir === undefined) delete process.env["RUN_STATE_DIR"]; else process.env["RUN_STATE_DIR"] = previousStateDir; }
  });

  it("refuses production startup without an owner AUTH_TOKEN", () => {
    const previousNodeEnv = process.env["NODE_ENV"]; const previousStateDir = process.env["RUN_STATE_DIR"]; const previousAuth = process.env["AUTH_TOKEN"];
    const stateDir = fs.mkdtempSync(path.join(process.cwd(), ".production-auth-"));
    process.env["NODE_ENV"] = "production"; process.env["RUN_STATE_DIR"] = stateDir; delete process.env["AUTH_TOKEN"];
    try { expect(() => buildServer()).toThrow(/AUTH_TOKEN/); }
    finally { if (previousNodeEnv === undefined) delete process.env["NODE_ENV"]; else process.env["NODE_ENV"] = previousNodeEnv; if (previousStateDir === undefined) delete process.env["RUN_STATE_DIR"]; else process.env["RUN_STATE_DIR"] = previousStateDir; if (previousAuth === undefined) delete process.env["AUTH_TOKEN"]; else process.env["AUTH_TOKEN"] = previousAuth; fs.rmSync(stateDir, { recursive: true, force: true }); }
  });

  it("GET / returns HTML page", async () => {
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    expectSecurityHeaders(res.headers);
    expect(res.headers["cache-control"]).toBe(EXPECTED_CACHE_CONTROL);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("Tech Radar");
    expect(res.body).toContain("dashboard-root");
    expect(res.body).toContain("Release notes");
    expect(res.body).toContain("/api/public/release-notes");
    expect(res.body).toContain("Raw extraction");
    expect(res.body).toContain("data-filter=\"repo\"");
    expect(res.body).toContain("data-filter=\"project\"");
    expect(res.body).toContain("data-filter=\"ocr\"");
    expect(res.body).not.toContain("class=\"tabs\"");
    expect(res.body).not.toContain("evidence-tab");
    expect(res.body).not.toContain("https://x.com");
    expect(res.body).toContain("window.__RUNS__ = [];");
  });

  it("scopes direct-upload preflight to exact configured origins", async () => {
    process.env["STOCKBOT_UPLOAD_ALLOWED_ORIGINS"] = "https://stocks.example";
    try {
      const allowed = await app.inject({ method: "OPTIONS", url: "/runs/upload", headers: { origin: "https://stocks.example", "access-control-request-method": "POST" } });
      expect(allowed.statusCode).toBe(204);
      expect(allowed.headers["access-control-allow-origin"]).toBe("https://stocks.example");
      expect(allowed.headers["access-control-allow-headers"]).toContain("X-StockBot-Upload-Token");
      const denied = await app.inject({ method: "OPTIONS", url: "/runs/upload", headers: { origin: "https://evil.example" } });
      expect(denied.statusCode).toBe(403);
      const prefix = await app.inject({ method: "OPTIONS", url: "/runs/upload/extra", headers: { origin: "https://stocks.example" } });
      expect(prefix.headers["access-control-allow-origin"]).toBeUndefined();
    } finally { delete process.env["STOCKBOT_UPLOAD_ALLOWED_ORIGINS"]; }
  });

  it("does not turn query tokens into authentication cookies", async () => {
    const res = await app.inject({ method: "GET", url: "/?token=preview" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe(EXPECTED_CACHE_CONTROL);
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("does not treat an unconfigured owner token as authorization for POST /runs", async () => {
    const res = await app.inject({ method: "POST", url: "/runs", payload: { url: "https://youtu.be/no-owner-token", intent: "finance" } });
    expect(res.statusCode).toBe(401);
  });

  it("rolls back a signed upload reservation and media when run registration fails", async () => {
    const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), "upload-register-fail-"));
    const reservation = { begin: vi.fn(() => true), markApplied: vi.fn(), forget: vi.fn(), state: vi.fn() };
    process.env["MEDIA_UPLOAD_DIR"] = mediaDir; process.env["STOCKBOT_UPLOAD_SECRET"] = "upload-fail-secret"; process.env["STOCKBOT_UPLOAD_ALLOWED_ORIGINS"] = "https://stocks.example";
    vi.mocked(runnerMock.runMediaPipeline).mockImplementationOnce(() => { throw new Error("registration failed"); });
    const isolated = buildServer({ consumedUploadTokens: reservation as any }); await isolated.ready();
    const boundary = "----register-fail"; const claims = { analysisId: "fail-analysis", idempotencyKey: "fail-key", origin: "dashboard", intent: "finance", exp: Math.floor(Date.now() / 1000) + 300, size: 1 };
    const payload = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="x.mp4"\r\nContent-Type: video/mp4\r\n\r\nx\r\n--${boundary}\r\nContent-Disposition: form-data; name="intent"\r\n\r\nfinance\r\n--${boundary}\r\nContent-Disposition: form-data; name="origin"\r\n\r\ndashboard\r\n--${boundary}\r\nContent-Disposition: form-data; name="idempotencyKey"\r\n\r\nfail-key\r\n--${boundary}\r\nContent-Disposition: form-data; name="analysisId"\r\n\r\nfail-analysis\r\n--${boundary}--\r\n`);
    try {
      const res = await isolated.inject({ method: "POST", url: "/runs/upload", headers: { origin: "https://stocks.example", "x-stockbot-upload-token": uploadToken(claims, "upload-fail-secret"), "content-type": `multipart/form-data; boundary=${boundary}` }, payload });
      expect(res.statusCode).toBe(400); expect(reservation.forget).toHaveBeenCalledWith("fail-analysis:fail-key"); expect(fs.readdirSync(mediaDir)).toEqual([]);
    } finally { await isolated.close(); delete process.env["MEDIA_UPLOAD_DIR"]; delete process.env["STOCKBOT_UPLOAD_SECRET"]; delete process.env["STOCKBOT_UPLOAD_ALLOWED_ORIGINS"]; fs.rmSync(mediaDir, { recursive: true, force: true }); }
  });

  it("keeps a durably registered signed upload accepted when markApplied persistence fails", async () => {
    const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), "upload-apply-fail-"));
    const reservation = { begin: vi.fn(() => true), markApplied: vi.fn(() => { throw new Error("reservation disk failed"); }), forget: vi.fn(), state: vi.fn() };
    process.env["MEDIA_UPLOAD_DIR"] = mediaDir; process.env["STOCKBOT_UPLOAD_SECRET"] = "upload-apply-secret"; process.env["STOCKBOT_UPLOAD_ALLOWED_ORIGINS"] = "https://stocks.example";
    const isolated = buildServer({ consumedUploadTokens: reservation as any }); await isolated.ready();
    const boundary = "----apply-fail"; const claims = { analysisId: "apply-analysis", idempotencyKey: "apply-key", origin: "dashboard", intent: "finance", exp: Math.floor(Date.now() / 1000) + 300, size: 1 };
    const payload = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="x.mp4"\r\nContent-Type: video/mp4\r\n\r\nx\r\n--${boundary}\r\nContent-Disposition: form-data; name="intent"\r\n\r\nfinance\r\n--${boundary}\r\nContent-Disposition: form-data; name="origin"\r\n\r\ndashboard\r\n--${boundary}\r\nContent-Disposition: form-data; name="idempotencyKey"\r\n\r\napply-key\r\n--${boundary}\r\nContent-Disposition: form-data; name="analysisId"\r\n\r\napply-analysis\r\n--${boundary}--\r\n`);
    try {
      const res = await isolated.inject({ method: "POST", url: "/runs/upload", headers: { origin: "https://stocks.example", "x-stockbot-upload-token": uploadToken(claims, "upload-apply-secret"), "content-type": `multipart/form-data; boundary=${boundary}` }, payload });
      expect(res.statusCode).toBe(202); expect(res.json().runId).toBe("mock-upload-run"); expect(reservation.markApplied).toHaveBeenCalledWith("apply-analysis:apply-key"); expect(reservation.forget).not.toHaveBeenCalled(); expect(fs.readdirSync(mediaDir)).toHaveLength(1);
    } finally { await isolated.close(); delete process.env["MEDIA_UPLOAD_DIR"]; delete process.env["STOCKBOT_UPLOAD_SECRET"]; delete process.env["STOCKBOT_UPLOAD_ALLOWED_ORIGINS"]; fs.rmSync(mediaDir, { recursive: true, force: true }); }
  });

  it("GET /api/public/findings returns public findings without auth", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "server-public-findings-"));
    const findingsDir = path.join(dir, "tech-radar", "findings");
    fs.mkdirSync(findingsDir, { recursive: true });
    fs.writeFileSync(
      path.join(findingsDir, "sample.md"),
      [
        "# Public Sample",
        "",
        "**Source:** github · [Repo](https://github.com/example/repo)",
        "**Saved:** 20260615",
        "**Tags:** github, ai",
        "",
        "## TL;DR",
        "",
        "General research summary.",
        "",
        "## What it actually is",
        "",
        "- What: A public tool.",
        "",
        "## Fit for Sid",
        "",
        "- Target project: ai-memory",
      ].join("\n"),
    );
    fs.writeFileSync(
      path.join(dir, "tech-radar", "applied.json"),
      JSON.stringify({ "sample.md": { appliedAt: "2026-07-06", link: "https://github.com/Sid10501/portfolio" } }),
    );
    process.env["AI_MEMORY_LOCAL_DIR"] = dir;

    const res = await app.inject({ method: "GET", url: "/api/public/findings" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.findings).toHaveLength(1);
    expect(body.findings[0].title).toBe("Public Sample");
    expect(body.findings[0].displayTitle).toBe("Public Sample");
    expect(body.findings[0].displaySummary).toBe("General research summary.");
    expect(body.findings[0].applied).toEqual({ appliedAt: "2026-07-06", link: "https://github.com/Sid10501/portfolio" });
    expect(body.findings[0]).not.toHaveProperty("targetProject");
    expectNoPrivateFindingFields(body);
    expect(res.headers["cache-control"]).toBe(EXPECTED_CACHE_CONTROL);
  });

  it("GET /api/public/audit returns latest batch health without auth", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "server-public-audit-"));
    const findingsDir = path.join(dir, "tech-radar", "findings");
    fs.mkdirSync(findingsDir, { recursive: true });
    fs.writeFileSync(
      path.join(findingsDir, "sample.md"),
      [
        "# Public Audit Sample",
        "",
        "**Source:** instagram",
        "**Saved:** 20260615",
        "**Tags:** instagram, ai",
        "",
        "## TL;DR",
        "",
        "A promising workflow needs source enrichment.",
        "",
        "## What the post showed",
        "",
        "> Caption: useful dashboard automation pattern",
        "",
        "Key claims from transcript:",
        "(no transcript available)",
        "",
        "## Links",
        "",
        "No links found.",
        "",
        "## Fit for Sid",
        "",
        "- Target project: tech-radar-api",
        "- Verdict: `#try-soon`",
      ].join("\n"),
    );
    process.env["AI_MEMORY_LOCAL_DIR"] = dir;

    const res = await app.inject({ method: "GET", url: "/api/public/audit" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.audit.total).toBe(1);
    expect(body.audit.quality.weak).toBe(1);
    expect(body.audit.needsEnrichment).toBe(1);
    expect(body.audit.missingTranscript).toBe(1);
    expect(body.audit.missingRepoOrDocs).toBe(1);
    expect(body.filters.all).toBe(1);
    expect(body.filters.enrich).toBe(1);
    expect(body.filters.repo).toBe(0);
    expect(body.audit).not.toHaveProperty("actions");
    expectNoPrivateFindingFields(body);
    expect(res.headers["cache-control"]).toBe(EXPECTED_CACHE_CONTROL);
  });

  it("GET /api/public/release-notes returns release notes without auth", async () => {
    const res = await app.inject({ method: "GET", url: "/api/public/release-notes" });

    expect(res.statusCode).toBe(200);
    expectSecurityHeaders(res.headers);
    expect(res.headers["cache-control"]).toBe(EXPECTED_CACHE_CONTROL);
    const body = res.json();
    expect(Array.isArray(body.releases)).toBe(true);
    expect(body.releases.length).toBeGreaterThan(0);
    expect(body.releases[0]).toMatchObject({
      date: "2026-07-11",
      title: "Workflow Maps",
    });
  });

  it("GET /api/public/findings/:id returns sanitized markdown without auth", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "server-public-detail-"));
    const findingsDir = path.join(dir, "tech-radar", "findings");
    fs.mkdirSync(findingsDir, { recursive: true });
    fs.writeFileSync(
      path.join(findingsDir, "sample.md"),
      [
        "# Sample",
        "",
        "## TL;DR",
        "",
        "Public",
        "",
        "## What it actually is",
        "",
        "Public-safe sentence.",
        "- Target project: Cross-Tax",
        "- Verdict: `#try-soon`",
        "- Recommended action: Create task",
        "",
        "## Fit for Sid",
        "",
        "Private project fit",
        "",
        "## Implementation Idea",
        "",
        "Private action",
        "",
        "## Follow-ups",
        "",
        "- Private follow-up task",
      ].join("\n"),
    );
    process.env["AI_MEMORY_LOCAL_DIR"] = dir;

    const res = await app.inject({ method: "GET", url: "/api/public/findings/sample.md" });

    expect(res.statusCode).toBe(200);
    expectSecurityHeaders(res.headers);
    expect(res.headers["cache-control"]).toBe(EXPECTED_CACHE_CONTROL);
    const body = res.json();
    expect(body.markdown).toContain("## TL;DR");
    expect(body.markdown).not.toContain("Fit for Sid");
    expect(body.markdown).not.toContain("Implementation Idea");
    expect(body.markdown).not.toMatch(/Target project|Verdict|Recommended action/i);
    expect(body.markdown).toContain("Public-safe sentence.");
    expect(res.body).not.toContain("Fit for Sid");
    expect(res.body).not.toContain("## Implementation Idea");
    expect(res.body).not.toContain("## Follow-ups");
    expectNoPrivateFindingFields(body);
  });

  it("reuses a recent ai-memory sync for repeated dashboard reads", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "server-sync-cache-"));
    const findingsDir = path.join(dir, "tech-radar", "findings");
    fs.mkdirSync(findingsDir, { recursive: true });
    fs.writeFileSync(path.join(findingsDir, "sample.md"), "# Sample\n\n## TL;DR\n\nPublic");
    process.env["AI_MEMORY_LOCAL_DIR"] = dir;
    process.env["AI_MEMORY_REPO"] = "git@example.com:Sid10501/ai-memory.git";
    gitMocks.init.mockClear();
    gitMocks.pullLatest.mockClear();

    const list = await app.inject({ method: "GET", url: "/api/public/findings" });
    const detailOne = await app.inject({ method: "GET", url: "/api/public/findings/sample.md" });
    const detailTwo = await app.inject({ method: "GET", url: "/api/public/findings/sample.md" });

    expect(list.statusCode).toBe(200);
    expect(detailOne.statusCode).toBe(200);
    expect(detailTwo.statusCode).toBe(200);
    expect(gitMocks.init).toHaveBeenCalledTimes(1);
    expect(gitMocks.pullLatest).toHaveBeenCalledTimes(1);
    delete process.env["AI_MEMORY_REPO"];
  });

  describe("public feed CORS", () => {
    const ORIGIN = "https://sid.dev";

    beforeAll(() => {
      process.env["PUBLIC_FEED_ALLOWED_ORIGINS"] = `${ORIGIN},https://www.sid.dev`;
    });

    afterAll(() => {
      delete process.env["PUBLIC_FEED_ALLOWED_ORIGINS"];
    });

    it("echoes an allowed Origin on public routes", async () => {
      const res = await app.inject({ method: "GET", url: "/api/public/findings", headers: { origin: ORIGIN } });

      expect(res.statusCode).toBe(200);
      expect(res.headers["access-control-allow-origin"]).toBe(ORIGIN);
      expect(res.headers["vary"]).toContain("Origin");
    });

    it("omits CORS headers for disallowed or absent Origins", async () => {
      const disallowed = await app.inject({ method: "GET", url: "/api/public/findings", headers: { origin: "https://evil.example" } });
      const absent = await app.inject({ method: "GET", url: "/api/public/findings" });

      for (const res of [disallowed, absent]) {
        expect(res.statusCode).toBe(200);
        expect(res.headers).not.toHaveProperty("access-control-allow-origin");
      }
    });

    it("never uses a wildcard origin", async () => {
      const res = await app.inject({ method: "GET", url: "/api/public/findings", headers: { origin: ORIGIN } });

      expect(res.headers["access-control-allow-origin"]).not.toBe("*");
    });

    it("never adds CORS headers to private routes", async () => {
      process.env["AUTH_TOKEN"] = "cors-private-token";
      const privateFindings = await app.inject({ method: "GET", url: "/api/findings", headers: { origin: ORIGIN } });
      const runs = await app.inject({ method: "GET", url: "/runs", headers: { origin: ORIGIN } });
      delete process.env["AUTH_TOKEN"];

      for (const res of [privateFindings, runs]) {
        expect(res.statusCode).toBe(401);
        expect(res.headers).not.toHaveProperty("access-control-allow-origin");
      }
    });

    it("answers OPTIONS preflight on public routes with 204 and GET only", async () => {
      const res = await app.inject({
        method: "OPTIONS",
        url: "/api/public/findings",
        headers: { origin: ORIGIN, "access-control-request-method": "GET" },
      });

      expect(res.statusCode).toBe(204);
      expect(res.headers["access-control-allow-origin"]).toBe(ORIGIN);
      expect(res.headers["access-control-allow-methods"]).toBe("GET");
      expect(res.body).toBe("");
    });

    it("answers OPTIONS preflight without CORS grants for disallowed Origins", async () => {
      const res = await app.inject({
        method: "OPTIONS",
        url: "/api/public/findings",
        headers: { origin: "https://evil.example", "access-control-request-method": "GET" },
      });

      expect(res.statusCode).toBe(204);
      expect(res.headers).not.toHaveProperty("access-control-allow-origin");
    });
  });

  describe("Telegram webhook", () => {
    beforeEach(() => {
      vi.mocked(runnerMock.runPipeline).mockClear();
      delete process.env["TELEGRAM_WEBHOOK_SECRET"];
      delete process.env["TELEGRAM_CHAT_ID"];
    });

    it("rejects webhook updates when owner chat is configured but the webhook secret is missing", async () => {
      process.env["TELEGRAM_CHAT_ID"] = "123";

      const res = await app.inject({
        method: "POST",
        url: "/telegram/webhook",
        payload: {
          message: {
            chat: { id: 123 },
            text: "https://example.com/untrusted",
          },
        },
      });

      expect(res.statusCode).toBe(503);
      expect(runnerMock.runPipeline).not.toHaveBeenCalled();
    });

    it("accepts webhook updates only with the configured Telegram secret", async () => {
      process.env["TELEGRAM_CHAT_ID"] = "123";
      process.env["TELEGRAM_WEBHOOK_SECRET"] = "telegram-secret";

      const unauthorized = await app.inject({
        method: "POST",
        url: "/telegram/webhook",
        headers: { "x-telegram-bot-api-secret-token": "wrong" },
        payload: {
          message: {
            chat: { id: 123 },
            text: "https://example.com/rejected",
          },
        },
      });
      const authorized = await app.inject({
        method: "POST",
        url: "/telegram/webhook",
        headers: { "x-telegram-bot-api-secret-token": "telegram-secret" },
        payload: {
          message: {
            chat: { id: 123 },
            text: "https://example.com/accepted",
          },
        },
      });

      expect(unauthorized.statusCode).toBe(401);
      expect(authorized.statusCode).toBe(200);
      expect(runnerMock.runPipeline).toHaveBeenCalledTimes(1);
      expect(runnerMock.runPipeline).toHaveBeenCalledWith("https://example.com/accepted", {
        intent: "auto",
        origin: { channel: "telegram", chatId: "123", messageId: undefined },
      });
    });
  });

  describe("StockBot completion callback", () => {
    const secret = "stockbot-callback-secret";
    const event = {
      eventId: "callback-event-1",
      runId: "finance-run",
      analysisId: "analysis-1",
      status: "completed",
      detailUrl: "https://stockbot.test/analyses/analysis-1",
      results: [{ symbol: "NVDA", claimGrade: "supported", opinion: "watch", confidence: 0.8 }],
    };

    beforeEach(() => {
      process.env["STOCKBOT_CALLBACK_SECRET"] = secret;
      vi.mocked(runnerMock.applyStockBotCompletion).mockClear();
    });

    afterAll(() => {
      delete process.env["STOCKBOT_CALLBACK_SECRET"];
    });

    function headers(raw: string, timestamp = String(Math.floor(Date.now() / 1_000))) {
      return {
        "content-type": "application/json",
        "x-stockbot-timestamp": timestamp,
        "x-stockbot-signature": createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex"),
      };
    }

    it("accepts a signed callback and applies it once", async () => {
      const raw = JSON.stringify(event);
      const res = await app.inject({ method: "POST", url: "/api/internal/stockbot/completion", headers: headers(raw), payload: raw });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true, deduplicated: false });
      expect(runnerMock.applyStockBotCompletion).toHaveBeenCalledWith(event);
    });

    it("rejects invalid signatures and stale callbacks", async () => {
      const raw = JSON.stringify({ ...event, eventId: "invalid-event" });
      const invalid = await app.inject({
        method: "POST",
        url: "/api/internal/stockbot/completion",
        headers: { ...headers(raw), "x-stockbot-signature": "00" },
        payload: raw,
      });
      const staleTimestamp = String(Math.floor((Date.now() - 301_000) / 1_000));
      const stale = await app.inject({ method: "POST", url: "/api/internal/stockbot/completion", headers: headers(raw, staleTimestamp), payload: raw });
      expect(invalid.statusCode).toBe(401);
      expect(stale.statusCode).toBe(401);
      expect(runnerMock.applyStockBotCompletion).not.toHaveBeenCalled();
    });

    it("deduplicates callback event IDs before side effects", async () => {
      const duplicateEvent = { ...event, eventId: `dedupe-${Date.now()}` };
      const raw = JSON.stringify(duplicateEvent);
      const first = await app.inject({ method: "POST", url: "/api/internal/stockbot/completion", headers: headers(raw), payload: raw });
      const second = await app.inject({ method: "POST", url: "/api/internal/stockbot/completion", headers: headers(raw), payload: raw });
      expect(first.json()).toEqual({ ok: true, deduplicated: false });
      expect(second.json()).toEqual({ ok: true, deduplicated: true });
      expect(runnerMock.applyStockBotCompletion).toHaveBeenCalledTimes(1);
    });

    it("returns retryable non-2xx while the same callback event is still pending", async () => {
      const pendingEvent = { ...event, eventId: `pending-${Date.now()}` };
      const raw = JSON.stringify(pendingEvent);
      let release!: () => void;
      vi.mocked(runnerMock.applyStockBotCompletion).mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve({ id: "finance-run", status: "processed" } as never); }));
      const firstPromise = app.inject({ method: "POST", url: "/api/internal/stockbot/completion", headers: headers(raw), payload: raw });
      await vi.waitFor(() => expect(runnerMock.applyStockBotCompletion).toHaveBeenCalledTimes(1));
      const overlap = await app.inject({ method: "POST", url: "/api/internal/stockbot/completion", headers: headers(raw), payload: raw });
      expect(overlap.statusCode).toBe(425);
      release();
      expect((await firstPromise).statusCode).toBe(200);
    });

    it("keeps a slow callback pending beyond the reservation TTL", async () => {
      const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "callback-slow-http-"));
      const isolated = buildServer({ callbackEvents: new StockBotEventDeduper(100, path.join(stateDir, "events.json"), 50) });
      const slowEvent = { ...event, eventId: `slow-${Date.now()}` };
      const raw = JSON.stringify(slowEvent);
      let release!: () => void;
      vi.mocked(runnerMock.applyStockBotCompletion).mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve({ id: "finance-run", status: "processed" } as never); }));
      try {
        const firstPromise = isolated.inject({ method: "POST", url: "/api/internal/stockbot/completion", headers: headers(raw), payload: raw });
        await vi.waitFor(() => expect(runnerMock.applyStockBotCompletion).toHaveBeenCalledTimes(1));
        await new Promise((resolve) => setTimeout(resolve, 140));
        const overlap = await isolated.inject({ method: "POST", url: "/api/internal/stockbot/completion", headers: headers(raw), payload: raw });
        expect(overlap.statusCode).toBe(425);
        release();
        expect((await firstPromise).statusCode).toBe(200);
      } finally {
        await isolated.close();
        fs.rmSync(stateDir, { recursive: true, force: true });
      }
    });

    it("retries the same callback event when applying it fails", async () => {
      const retryEvent = { ...event, eventId: `retry-${Date.now()}` };
      const raw = JSON.stringify(retryEvent);
      vi.mocked(runnerMock.applyStockBotCompletion).mockRejectedValueOnce(new Error("durable write failed") as never).mockResolvedValueOnce({ id: "finance-run", status: "processed" } as never);
      const first = await app.inject({ method: "POST", url: "/api/internal/stockbot/completion", headers: headers(raw), payload: raw });
      const second = await app.inject({ method: "POST", url: "/api/internal/stockbot/completion", headers: headers(raw), payload: raw });
      expect(first.statusCode).toBe(500);
      expect(second.json()).toEqual({ ok: true, deduplicated: false });
      expect(runnerMock.applyStockBotCompletion).toHaveBeenCalledTimes(2);
    });
  });

  describe("with AUTH_TOKEN set", () => {
    const TOKEN = "test-secret-token";

    beforeAll(() => {
      process.env["AUTH_TOKEN"] = TOKEN;
      process.env["STOCKBOT_DISPATCH_TOKEN"] = "dispatch-secret";
    });

    afterAll(() => {
      delete process.env["AUTH_TOKEN"];
      delete process.env["STOCKBOT_DISPATCH_TOKEN"];
    });

    it("GET /runs returns 401 without token", async () => {
      const res = await app.inject({ method: "GET", url: "/runs" });
      expect(res.statusCode).toBe(401);
      expectSecurityHeaders(res.headers);
      expect(res.headers["cache-control"]).toBe(EXPECTED_CACHE_CONTROL);
    });

    it("private finding and admin endpoints return 401 without auth", async () => {
      const privateFindings = await app.inject({ method: "GET", url: "/api/findings" });
      const privateDetail = await app.inject({ method: "GET", url: "/api/findings/sample.md" });
      const privateAudit = await app.inject({ method: "GET", url: "/api/audit" });
      const adminEnrich = await app.inject({ method: "POST", url: "/api/admin/enrich/sample.md" });
      const adminEnrichWeak = await app.inject({ method: "POST", url: "/api/admin/enrich-weak", payload: { limit: 1 } });

      for (const res of [privateFindings, privateDetail, privateAudit, adminEnrich, adminEnrichWeak]) {
        expect(res.statusCode).toBe(401);
        expectSecurityHeaders(res.headers);
        expect(res.headers["cache-control"]).toBe(EXPECTED_CACHE_CONTROL);
      }
    });

    it("GET /api/session reports private lock state without exposing token", async () => {
      const locked = await app.inject({ method: "GET", url: "/api/session" });
      const unlocked = await app.inject({
        method: "GET",
        url: "/api/session",
        headers: { cookie: `auth_token=${TOKEN}` },
      });

      expect(locked.statusCode).toBe(200);
      expect(locked.headers["cache-control"]).toBe(EXPECTED_CACHE_CONTROL);
      expect(locked.json()).toEqual({ privateUnlocked: false });
      expect(unlocked.statusCode).toBe(200);
      expect(unlocked.headers["cache-control"]).toBe(EXPECTED_CACHE_CONTROL);
      expect(unlocked.json()).toEqual({ privateUnlocked: true });
      expect(JSON.stringify(unlocked.json())).not.toContain(TOKEN);
    });

    it("GET /runs returns run list with valid Bearer token", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/runs",
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers["cache-control"]).toBe(EXPECTED_CACHE_CONTROL);
      const body = res.json();
      expect(Array.isArray(body)).toBe(true);
    });

    it("GET /runs returns run list with valid auth_token cookie", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/runs",
        headers: { cookie: `theme=light; auth_token=${TOKEN}; other=value` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(expect.arrayContaining([expect.objectContaining({ url: "https://x.com" })]));
    });

    it("GET /runs/:id returns 404 for unknown id", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/runs/nonexistent",
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it("GET /runs/:id returns run for known id", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/runs/existing",
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe("existing");
    });

    it("POST /runs validates intent and returns the actual registered runId", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/runs",
        headers: {
          authorization: "Bearer dispatch-secret",
          "content-type": "application/json",
          "idempotency-key": "dispatch-key",
        },
        body: JSON.stringify({ url: "https://www.youtube.com/shorts/abc123", intent: "finance" }),
      });
      expect(res.statusCode).toBe(202);
      expect(res.json()).toEqual({ runId: "mock-run-id", status: "pending", deduplicated: false });
      expect(runnerMock.runPipeline).toHaveBeenCalledWith("https://www.youtube.com/watch?v=abc123", expect.objectContaining({ intent: "finance", idempotencyKey: "dispatch-key" }));
    });

    it("POST /runs returns an idempotent canonical duplicate as accepted", async () => {
      const ExistingDuplicate = runnerMock.DuplicateRunError as any;
      vi.mocked(runnerMock.runPipeline).mockImplementationOnce(() => { throw new ExistingDuplicate({ id: "existing-id", status: "processed" }, true); });
      const res = await app.inject({ method: "POST", url: "/runs", headers: { authorization: "Bearer dispatch-secret", "idempotency-key": "same-key" }, payload: { url: "https://youtu.be/abc123?si=x", intent: "finance" } });
      expect(res.statusCode).toBe(202);
      expect(res.json()).toEqual({ runId: "existing-id", status: "processed", deduplicated: true });
    });

    it("POST /runs accepts the owner bearer for iOS Shortcut submissions", async () => {
      const res = await app.inject({ method: "POST", url: "/runs", headers: { authorization: `Bearer ${TOKEN}` }, payload: { url: "https://youtu.be/auth-boundary", intent: "finance" } });
      expect(res.statusCode).toBe(202);
    });

    it("POST /runs accepts the owner dashboard cookie but not a query token", async () => {
      const cookie = await app.inject({ method: "POST", url: "/runs", headers: { cookie: `auth_token=${TOKEN}` }, payload: { url: "https://youtu.be/dashboard-cookie", intent: "finance" } });
      const query = await app.inject({ method: "POST", url: `/runs?token=${TOKEN}`, payload: { url: "https://youtu.be/query-token", intent: "finance" } });
      expect(cookie.statusCode).toBe(202);
      expect(query.statusCode).toBe(401);
    });

    it("POST /runs accepts a strict force boolean and forwards it", async () => {
      const accepted = await app.inject({ method: "POST", url: "/runs", headers: { authorization: `Bearer ${TOKEN}` }, payload: { url: "https://youtu.be/force-retry", intent: "finance", force: true } });
      const rejected = await app.inject({ method: "POST", url: "/runs", headers: { authorization: `Bearer ${TOKEN}` }, payload: { url: "https://youtu.be/force-bad", intent: "finance", force: "yes" } });
      expect(accepted.statusCode).toBe(202);
      expect(runnerMock.runPipeline).toHaveBeenCalledWith("https://www.youtube.com/watch?v=force-retry", expect.objectContaining({ force: true }));
      expect(rejected.statusCode).toBe(400);
    });

    it("POST /runs/upload streams a bounded authenticated file and returns its run id", async () => {
      const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), "server-upload-"));
      process.env["MEDIA_UPLOAD_DIR"] = mediaDir;
      const boundary = "----tech-radar-boundary";
      const payload = Buffer.from([
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="clip.mp4"\r\nContent-Type: video/mp4\r\n\r\nvideo-bytes\r\n`,
        `--${boundary}\r\nContent-Disposition: form-data; name="intent"\r\n\r\nfinance\r\n`,
        `--${boundary}\r\nContent-Disposition: form-data; name="origin"\r\n\r\ndashboard\r\n`,
        `--${boundary}\r\nContent-Disposition: form-data; name="idempotencyKey"\r\n\r\nstockbot-key\r\n`,
        `--${boundary}\r\nContent-Disposition: form-data; name="analysisId"\r\n\r\nanalysis-upload\r\n`,
        `--${boundary}--\r\n`,
      ].join(""));
      try {
        const res = await app.inject({ method: "POST", url: "/runs/upload", headers: { authorization: "Bearer dispatch-secret", "content-type": `multipart/form-data; boundary=${boundary}` }, payload });
        expect(res.statusCode).toBe(202);
        expect(res.json()).toEqual({ runId: "mock-upload-run", status: "pending" });
        expect(runnerMock.runMediaPipeline).toHaveBeenCalledWith(expect.objectContaining({ intent: "finance", origin: { channel: "dashboard" }, mimeType: "video/mp4", idempotencyKey: "stockbot-key", analysisId: "analysis-upload" }));
      } finally {
        delete process.env["MEDIA_UPLOAD_DIR"];
        fs.rmSync(mediaDir, { recursive: true, force: true });
      }
    });

    it("POST /runs/upload rejects unknown and repeated singleton multipart fields", async () => {
      const boundary = "----invalid-fields";
      const request = async (fields: Array<[string, string]>) => app.inject({ method: "POST", url: "/runs/upload", headers: { authorization: "Bearer dispatch-secret", "content-type": `multipart/form-data; boundary=${boundary}` }, payload: Buffer.from([
        ...fields.map(([name, value]) => `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`),
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="clip.mp4"\r\nContent-Type: video/mp4\r\n\r\nx\r\n--${boundary}--\r\n`,
      ].join("")) });
      expect((await request([["mystery", "x"]])).statusCode).toBe(400);
      expect((await request([["intent", "finance"], ["intent", "finance"]])).statusCode).toBe(400);
    });

    it("accepts one matching signed dashboard upload and rejects replay and mismatch", async () => {
      const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), "signed-upload-"));
      process.env["MEDIA_UPLOAD_DIR"] = mediaDir;
      process.env["STOCKBOT_UPLOAD_SECRET"] = "upload-secret";
      const boundary = "----signed-upload";
      const claims = { analysisId: "signed-analysis", idempotencyKey: "signed-key", origin: "dashboard", intent: "finance", exp: Math.floor(Date.now() / 1000) + 300, size: 11 };
      const body = Buffer.from([
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="clip.mp4"\r\nContent-Type: video/mp4\r\n\r\nvideo-bytes\r\n`,
        `--${boundary}\r\nContent-Disposition: form-data; name="intent"\r\n\r\nfinance\r\n`,
        `--${boundary}\r\nContent-Disposition: form-data; name="origin"\r\n\r\ndashboard\r\n`,
        `--${boundary}\r\nContent-Disposition: form-data; name="idempotencyKey"\r\n\r\nsigned-key\r\n`,
        `--${boundary}\r\nContent-Disposition: form-data; name="analysisId"\r\n\r\nsigned-analysis\r\n`,
        `--${boundary}--\r\n`,
      ].join(""));
      const headers = { "content-type": `multipart/form-data; boundary=${boundary}`, "x-stockbot-upload-token": uploadToken(claims, "upload-secret"), origin: "https://stocks.example" };
      process.env["STOCKBOT_UPLOAD_ALLOWED_ORIGINS"] = "https://stocks.example";
      try {
        vi.mocked(runnerMock.runMediaPipeline).mockImplementationOnce(() => { throw new Error("durable registration failed"); });
        expect((await app.inject({ method: "POST", url: "/runs/upload", headers, payload: body })).statusCode).toBe(400);
        const allowed = await app.inject({ method: "POST", url: "/runs/upload", headers, payload: body });
        expect(allowed.statusCode).toBe(202);
        expect(allowed.headers["access-control-allow-origin"]).toBe("https://stocks.example");
        expect((await app.inject({ method: "POST", url: "/runs/upload", headers, payload: body })).statusCode).toBe(409);
        const mismatchHeaders = { ...headers, "x-stockbot-upload-token": uploadToken({ ...claims, analysisId: "mismatch", idempotencyKey: "mismatch", size: 12 }, "upload-secret") };
        expect((await app.inject({ method: "POST", url: "/runs/upload", headers: mismatchHeaders, payload: body })).statusCode).toBe(400);
      } finally {
        delete process.env["MEDIA_UPLOAD_DIR"]; delete process.env["STOCKBOT_UPLOAD_SECRET"]; delete process.env["STOCKBOT_UPLOAD_ALLOWED_ORIGINS"];
        fs.rmSync(mediaDir, { recursive: true, force: true });
      }
    });

    it("deduplicates a signed upload from durable run identity before reserving its token", async () => {
      const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), "durable-upload-replay-"));
      process.env["MEDIA_UPLOAD_DIR"] = mediaDir;
      process.env["STOCKBOT_UPLOAD_SECRET"] = "replay-secret";
      process.env["STOCKBOT_UPLOAD_ALLOWED_ORIGINS"] = "https://stocks.example";
      const reservation = { begin: vi.fn(() => { throw new Error("stale reservation was consulted"); }), state: vi.fn(), markApplied: vi.fn(), forget: vi.fn() };
      const isolated = buildServer({ consumedUploadTokens: reservation });
      const boundary = "----durable-replay";
      const claims = { analysisId: "durable-analysis", idempotencyKey: "durable-key", origin: "dashboard", intent: "finance", exp: Math.floor(Date.now() / 1000) + 300, size: 1 };
      const body = Buffer.from([
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="clip.mp4"\r\nContent-Type: video/mp4\r\n\r\nx\r\n`,
        `--${boundary}\r\nContent-Disposition: form-data; name="intent"\r\n\r\nfinance\r\n`,
        `--${boundary}\r\nContent-Disposition: form-data; name="origin"\r\n\r\ndashboard\r\n`,
        `--${boundary}\r\nContent-Disposition: form-data; name="idempotencyKey"\r\n\r\ndurable-key\r\n`,
        `--${boundary}\r\nContent-Disposition: form-data; name="analysisId"\r\n\r\ndurable-analysis\r\n`,
        `--${boundary}--\r\n`,
      ].join(""));
      vi.mocked(runnerMock.findMediaRunBySubmission).mockReturnValueOnce({ id: "existing-upload", status: "partial" } as never);
      vi.mocked(runnerMock.runMediaPipeline).mockClear();
      try {
        const response = await isolated.inject({ method: "POST", url: "/runs/upload", headers: { origin: "https://stocks.example", "content-type": `multipart/form-data; boundary=${boundary}`, "x-stockbot-upload-token": uploadToken(claims, "replay-secret") }, payload: body });
        expect(response.statusCode).toBe(202);
        expect(response.json()).toEqual({ runId: "existing-upload", status: "partial", deduplicated: true });
        expect(reservation.begin).not.toHaveBeenCalled();
        expect(runnerMock.runMediaPipeline).not.toHaveBeenCalled();
        expect(fs.readdirSync(mediaDir)).toEqual([]);
      } finally {
        await isolated.close();
        delete process.env["MEDIA_UPLOAD_DIR"]; delete process.env["STOCKBOT_UPLOAD_SECRET"]; delete process.env["STOCKBOT_UPLOAD_ALLOWED_ORIGINS"];
        fs.rmSync(mediaDir, { recursive: true, force: true });
      }
    });

    it("requires an exact Origin for signed uploads but not service-Bearer uploads", async () => {
      process.env["STOCKBOT_UPLOAD_SECRET"] = "origin-secret"; process.env["STOCKBOT_UPLOAD_ALLOWED_ORIGINS"] = "https://stocks.example";
      const claims = { analysisId: "origin-analysis", idempotencyKey: "origin-key", origin: "dashboard", intent: "finance", exp: Math.floor(Date.now() / 1000) + 300, size: 1 };
      const boundary = "----origin-upload";
      const payload = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="x.mp4"\r\nContent-Type: video/mp4\r\n\r\nx\r\n--${boundary}\r\nContent-Disposition: form-data; name="intent"\r\n\r\nfinance\r\n--${boundary}\r\nContent-Disposition: form-data; name="origin"\r\n\r\ndashboard\r\n--${boundary}\r\nContent-Disposition: form-data; name="idempotencyKey"\r\n\r\norigin-key\r\n--${boundary}\r\nContent-Disposition: form-data; name="analysisId"\r\n\r\norigin-analysis\r\n--${boundary}--\r\n`);
      const base = { "content-type": `multipart/form-data; boundary=${boundary}`, "x-stockbot-upload-token": uploadToken(claims, "origin-secret") };
      try {
        expect((await app.inject({ method: "POST", url: "/runs/upload", headers: base, payload })).statusCode).toBe(403);
        expect((await app.inject({ method: "POST", url: "/runs/upload", headers: { ...base, origin: "https://evil.example" }, payload })).statusCode).toBe(403);
        expect((await app.inject({ method: "POST", url: "/runs/upload", headers: { authorization: "Bearer dispatch-secret", "content-type": `multipart/form-data; boundary=${boundary}` }, payload })).statusCode).toBe(202);
      } finally { delete process.env["STOCKBOT_UPLOAD_SECRET"]; delete process.env["STOCKBOT_UPLOAD_ALLOWED_ORIGINS"]; }
    });

    it("POST /runs rejects an unknown intent", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/runs",
        headers: { authorization: "Bearer dispatch-secret" },
        payload: { url: "https://example.com/video", intent: "verdict" },
      });
      expect(res.statusCode).toBe(400);
      expect(runnerMock.runPipeline).not.toHaveBeenCalled();
    });

    it("POST /runs rejects malformed and non-http URLs", async () => {
      for (const url of ["not-a-url", "file:///etc/passwd"]) {
        const res = await app.inject({
          method: "POST",
          url: "/runs",
          headers: { authorization: "Bearer dispatch-secret" },
          payload: { url, intent: "auto" },
        });
        expect(res.statusCode).toBe(400);
      }
      expect(runnerMock.runPipeline).not.toHaveBeenCalled();
    });

    it("POST /runs returns 400 without url", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/runs",
        headers: {
          authorization: "Bearer dispatch-secret",
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(400);
    });

    it("POST /api/unlock accepts the password and sets auth cookie", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/unlock",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: TOKEN }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers["set-cookie"]).toContain("auth_token=");
    });

    it("GET /api/findings returns parsed findings with valid Bearer token", async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "server-findings-"));
      const findingsDir = path.join(dir, "tech-radar", "findings");
      fs.mkdirSync(findingsDir, { recursive: true });
      fs.writeFileSync(
        path.join(findingsDir, "20260615-video-by-shawnchee.md"),
        [
          "# Ponytail agent rubric",
          "",
          "**Source:** instagram · [Shawn](https://www.instagram.com/reel/DZmyMFoqCRm/)",
          "**Saved:** 20260615",
          "**Tags:** instagram, tech",
          "",
          "## TL;DR",
          "",
          "Useful agent rubric.",
          "",
          "## What the post showed",
          "",
          "> Caption: save tokens",
          "",
          "On-screen text / OCR:",
          "smallest useful diff",
          "",
          "## Links",
          "",
          "- Repo: https://github.com/example/ponytail",
          "",
          "## Fit for Sid",
          "",
          "- Target project: ai-memory",
          "- Verdict: `#try-soon`",
        ].join("\n"),
      );
      process.env["AI_MEMORY_LOCAL_DIR"] = dir;

      const res = await app.inject({
        method: "GET",
        url: "/api/findings",
        headers: { authorization: `Bearer ${TOKEN}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.findings).toHaveLength(1);
      expect(body.findings[0].title).toBe("Ponytail agent rubric");
      expect(body.findings[0].quality.score).toBeGreaterThan(70);
    });

    it("GET /api/findings clusters duplicate source posts for the dashboard", async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "server-clustered-findings-"));
      const findingsDir = path.join(dir, "tech-radar", "findings");
      fs.mkdirSync(findingsDir, { recursive: true });
      for (const [filename, route] of [
        ["a.md", "reel"],
        ["b.md", "p"],
      ] as const) {
        fs.writeFileSync(
          path.join(findingsDir, filename),
          [
            `# Duplicate ${filename}`,
            "",
            `**Source:** instagram · [Creator](https://www.instagram.com/${route}/SameMedia/?igsh=tracking)`,
            "**Saved:** 20260720",
            "**Tags:** instagram",
            "",
            "## TL;DR",
            "",
            "Same source post.",
          ].join("\n"),
        );
      }
      process.env["AI_MEMORY_LOCAL_DIR"] = dir;

      const res = await app.inject({
        method: "GET",
        url: "/api/findings",
        headers: { authorization: `Bearer ${TOKEN}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().findings).toEqual([
        expect.objectContaining({
          id: "a.md",
          diagnostics: {
            extractionWarnings: [],
            duplicateGroup: expect.objectContaining({ count: 2, canonicalFindingId: "a.md" }),
          },
        }),
      ]);
    });

    it("GET /api/audit returns private action counts with valid auth", async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "server-audit-"));
      const findingsDir = path.join(dir, "tech-radar", "findings");
      fs.mkdirSync(findingsDir, { recursive: true });
      fs.writeFileSync(
        path.join(findingsDir, "sample.md"),
        [
          "# Private Audit Sample",
          "",
          "**Source:** instagram",
          "**Saved:** 20260615",
          "**Tags:** instagram, ai",
          "",
          "## TL;DR",
          "",
          "A sample that should be skipped.",
          "",
          "## What the post showed",
          "",
          "> Caption: useful but not a fit",
          "",
          "## Fit for Sid",
          "",
          "- Target project: none",
          "- Verdict: `#skip`",
        ].join("\n"),
      );
      process.env["AI_MEMORY_LOCAL_DIR"] = dir;

      const res = await app.inject({
        method: "GET",
        url: "/api/audit",
        headers: { authorization: `Bearer ${TOKEN}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.audit.actions.Skip).toBe(1);
      expect(body.filters.skip).toBe(1);
    });

    it("GET /api/findings/:id returns markdown for a selected finding", async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "server-finding-"));
      const findingsDir = path.join(dir, "tech-radar", "findings");
      fs.mkdirSync(findingsDir, { recursive: true });
      fs.writeFileSync(path.join(findingsDir, "sample.md"), "# Sample\n\n## TL;DR\n\nHello");
      process.env["AI_MEMORY_LOCAL_DIR"] = dir;

      const res = await app.inject({
        method: "GET",
        url: "/api/findings/sample.md",
        headers: { authorization: `Bearer ${TOKEN}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().markdown).toContain("# Sample");
    });

    it("POST /api/admin/enrich/:id force-requeues the finding source URL", async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "server-enrich-one-"));
      const findingsDir = path.join(dir, "tech-radar", "findings");
      fs.mkdirSync(findingsDir, { recursive: true });
      fs.writeFileSync(
        path.join(findingsDir, "sample.md"),
        [
          "# Sample",
          "",
          "**Source:** instagram · [Creator](https://www.instagram.com/p/sample/)",
          "**Saved:** 20260619",
          "**Tags:** instagram",
          "",
          "## TL;DR",
          "",
          "Weak sample.",
        ].join("\n"),
      );
      process.env["AI_MEMORY_LOCAL_DIR"] = dir;

      const res = await app.inject({
        method: "POST",
        url: "/api/admin/enrich/sample.md",
        headers: { authorization: `Bearer ${TOKEN}` },
      });

      expect(res.statusCode).toBe(202);
      expect(runnerMock.runPipeline).toHaveBeenCalledWith("https://www.instagram.com/p/sample/", { force: true });
      expect(res.json()).toMatchObject({ queued: true, runId: "mock-run-id" });
    });

    it("POST /api/admin/enrich-weak dry-run returns retryable candidates without queueing", async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "server-enrich-dry-"));
      const findingsDir = path.join(dir, "tech-radar", "findings");
      fs.mkdirSync(findingsDir, { recursive: true });
      fs.writeFileSync(
        path.join(findingsDir, "concept.md"),
        [
          "# 8 AI words everyone pretends to understand",
          "",
          "**Source:** instagram · [Creator](https://www.instagram.com/p/concept/)",
          "**Saved:** 20260620",
          "**Tags:** instagram, explainer",
          "",
          "## TL;DR",
          "",
          "A useful concept explainer with no expected public artifact.",
          "",
          "## What the post showed",
          "",
          "> Caption: 8 AI words everyone pretends to understand.",
          "",
          "## Fit for Sid",
          "",
          "- Target project: tech-radar-api",
          "- Verdict: `#watch`",
        ].join("\n"),
      );
      fs.writeFileSync(
        path.join(findingsDir, "shortlink.md"),
        [
          "# Shortlink workflow",
          "",
          "**Source:** x · [Post](https://t.co/abc123)",
          "**Saved:** 20260621",
          "**Tags:** x, workflow",
          "",
          "## TL;DR",
          "",
          "A workflow with an unresolved shortlink.",
          "",
          "## What the post showed",
          "",
          "> Caption: Try the workflow: https://t.co/abc123",
          "",
          "Source links found:",
          "- https://t.co/abc123",
          "",
          "## Fit for Sid",
          "",
          "- Target project: tech-radar-api",
          "- Verdict: `#try-soon`",
        ].join("\n"),
      );
      process.env["AI_MEMORY_LOCAL_DIR"] = dir;

      const res = await app.inject({
        method: "POST",
        url: "/api/admin/enrich-weak",
        headers: { authorization: `Bearer ${TOKEN}` },
        payload: { limit: 10, dryRun: true },
      });

      expect(res.statusCode).toBe(200);
      expect(runnerMock.runPipeline).not.toHaveBeenCalled();
      expect(res.json()).toMatchObject({
        dryRun: true,
        limit: 10,
        matched: 1,
        queued: 0,
        runs: [],
        candidates: [
          {
            id: "shortlink.md",
            sourceUrl: "https://t.co/abc123",
            triage: {
              kind: "unresolved_shortlink",
              retryable: true,
              reasons: expect.arrayContaining(["shortlink_unresolved"]),
            },
            enrichment: {
              status: "needs-enrichment",
              reasons: expect.arrayContaining(["shortlink_unresolved"]),
            },
          },
        ],
      });
    });

    it("POST /api/admin/enrich-weak force-requeues retryable weak non-skip findings only", async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "server-enrich-weak-"));
      const findingsDir = path.join(dir, "tech-radar", "findings");
      fs.mkdirSync(findingsDir, { recursive: true });
      fs.writeFileSync(
        path.join(findingsDir, "weak.md"),
        [
          "# Weak",
          "",
          "**Source:** instagram · [Creator](https://www.instagram.com/p/weak/)",
          "**Saved:** 20260619",
          "**Tags:** instagram",
          "",
          "## TL;DR",
          "",
          "Weak sample.",
          "",
          "## What the post showed",
          "",
          "> Caption: weak",
        ].join("\n"),
      );
      fs.writeFileSync(
        path.join(findingsDir, "skip.md"),
        [
          "# Skip",
          "",
          "**Source:** instagram · [Creator](https://www.instagram.com/p/skip/)",
          "**Saved:** 20260618",
          "**Tags:** instagram",
          "",
          "## TL;DR",
          "",
          "Skipped sample.",
          "",
          "## Fit for Sid",
          "",
          "- Target project: none",
          "- Verdict: `#skip`",
        ].join("\n"),
      );
      process.env["AI_MEMORY_LOCAL_DIR"] = dir;

      const res = await app.inject({
        method: "POST",
        url: "/api/admin/enrich-weak",
        headers: { authorization: `Bearer ${TOKEN}` },
        payload: { limit: 10 },
      });

      expect(res.statusCode).toBe(202);
      expect(res.json()).toMatchObject({
        dryRun: false,
        limit: 10,
        matched: 1,
        queued: 1,
        candidates: [],
        skippedDuplicates: [],
      });
      expect(runnerMock.runPipeline).toHaveBeenCalledWith("https://www.instagram.com/p/weak/", { force: true });
    });

    it("POST /api/admin/enrich-weak skips same-source duplicate candidates", async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "server-enrich-duplicate-"));
      const findingsDir = path.join(dir, "tech-radar", "findings");
      fs.mkdirSync(findingsDir, { recursive: true });
      for (const [filename, saved] of [
        ["newer.md", "20260530"],
        ["older.md", "20260516"],
      ] as const) {
        fs.writeFileSync(
          path.join(findingsDir, filename),
          [
            `# Duplicate ${saved}`,
            "",
            "**Source:** instagram · [Creator](https://www.instagram.com/p/duplicate/?igsh=tracking)",
            `**Saved:** ${saved}`,
            "**Tags:** instagram",
            "",
            "## TL;DR",
            "",
            "Weak duplicate sample.",
            "",
            "## What the post showed",
            "",
            "> Caption: duplicate",
            "",
            "## Links",
            "",
            "- Repo: https://github.com/example/duplicate",
            "",
            "## Fit for Sid",
            "",
            "- Target project: unknown",
            "- Verdict: `#try-soon`",
          ].join("\n"),
        );
      }
      fs.writeFileSync(
        path.join(findingsDir, "unique.md"),
        [
          "# Unique weak",
          "",
          "**Source:** instagram · [Creator](https://www.instagram.com/p/unique/)",
          "**Saved:** 20260401",
          "**Tags:** instagram",
          "",
          "## TL;DR",
          "",
          "Weak unique sample.",
          "",
          "## What the post showed",
          "",
          "> Caption: unique",
        ].join("\n"),
      );
      process.env["AI_MEMORY_LOCAL_DIR"] = dir;

      const dryRun = await app.inject({
        method: "POST",
        url: "/api/admin/enrich-weak",
        headers: { authorization: `Bearer ${TOKEN}` },
        payload: { limit: 10, dryRun: true },
      });

      expect(dryRun.statusCode).toBe(200);
      expect(dryRun.json()).toMatchObject({
        matched: 1,
        queued: 0,
        candidates: [{ id: "unique.md" }],
        skippedDuplicates: expect.arrayContaining([
          expect.objectContaining({ id: "newer.md", reason: "same_source_duplicate" }),
          expect.objectContaining({ id: "older.md", reason: "same_source_duplicate" }),
        ]),
      });

      const live = await app.inject({
        method: "POST",
        url: "/api/admin/enrich-weak",
        headers: { authorization: `Bearer ${TOKEN}` },
        payload: { limit: 10 },
      });

      expect(live.statusCode).toBe(202);
      expect(live.json()).toMatchObject({
        matched: 1,
        queued: 1,
        skippedDuplicates: expect.arrayContaining([
          expect.objectContaining({ id: "newer.md", reason: "same_source_duplicate" }),
          expect.objectContaining({ id: "older.md", reason: "same_source_duplicate" }),
        ]),
      });
      expect(runnerMock.runPipeline).toHaveBeenCalledTimes(1);
      expect(runnerMock.runPipeline).toHaveBeenCalledWith("https://www.instagram.com/p/unique/", { force: true });
    });
  });
});
