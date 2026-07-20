import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHmac } from "node:crypto";

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
}));

vi.mock("../src/git.js", () => ({
  setupSshKey: gitMocks.setupSshKey,
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
  });

  it("keeps token-query HTML responses no-store", async () => {
    const res = await app.inject({ method: "GET", url: "/?token=preview" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe(EXPECTED_CACHE_CONTROL);
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
  });

  describe("with AUTH_TOKEN set", () => {
    const TOKEN = "test-secret-token";

    beforeAll(() => {
      process.env["AUTH_TOKEN"] = TOKEN;
    });

    afterAll(() => {
      delete process.env["AUTH_TOKEN"];
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
      expect(Array.isArray(res.json())).toBe(true);
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
          authorization: `Bearer ${TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ url: "https://www.youtube.com/shorts/abc123", intent: "finance" }),
      });
      expect(res.statusCode).toBe(202);
      expect(res.json()).toEqual({ runId: "mock-run-id" });
      expect(runnerMock.runPipeline).toHaveBeenCalledWith("https://www.youtube.com/watch?v=abc123", expect.objectContaining({ intent: "finance" }));
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
        const res = await app.inject({ method: "POST", url: "/runs/upload", headers: { authorization: `Bearer ${TOKEN}`, "content-type": `multipart/form-data; boundary=${boundary}` }, payload });
        expect(res.statusCode).toBe(202);
        expect(res.json()).toEqual({ runId: "mock-upload-run", status: "pending" });
        expect(runnerMock.runMediaPipeline).toHaveBeenCalledWith(expect.objectContaining({ intent: "finance", origin: { channel: "dashboard" }, mimeType: "video/mp4", idempotencyKey: "stockbot-key", analysisId: "analysis-upload" }));
      } finally {
        delete process.env["MEDIA_UPLOAD_DIR"];
        fs.rmSync(mediaDir, { recursive: true, force: true });
      }
    });

    it("POST /runs rejects an unknown intent", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/runs",
        headers: { authorization: `Bearer ${TOKEN}` },
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
          headers: { authorization: `Bearer ${TOKEN}` },
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
          authorization: `Bearer ${TOKEN}`,
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
