import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const gitMocks = vi.hoisted(() => ({
  init: vi.fn(async () => {}),
  pullLatest: vi.fn(async () => {}),
  setupSshKey: vi.fn(() => "/tmp/mock-key"),
}));

// Mock runner before importing server so the routes work without a real pipeline
vi.mock("../src/runner.js", () => ({
  runPipeline: vi.fn(async () => ({ runId: "mock-run-id", findingPath: "tech-radar/findings/test.md" })),
  getRun: vi.fn((id: string) => id === "existing" ? { id, url: "https://x.com", status: "processed", startedAt: new Date().toISOString() } : undefined),
  listRuns: vi.fn(() => [{ id: "existing", url: "https://x.com", status: "processed", startedAt: new Date().toISOString() }]),
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
    process.env["AI_MEMORY_LOCAL_DIR"] = dir;

    const res = await app.inject({ method: "GET", url: "/api/public/findings" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.findings).toHaveLength(1);
    expect(body.findings[0].title).toBe("Public Sample");
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

    it("POST /runs accepts a URL and returns 202 with runId", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/runs",
        headers: {
          authorization: `Bearer ${TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ url: "https://www.youtube.com/shorts/abc123" }),
      });
      expect(res.statusCode).toBe(202);
      expect(res.json()).toHaveProperty("runId");
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

    it("POST /api/admin/enrich-weak force-requeues weak non-skip findings only", async () => {
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
      expect(res.json()).toMatchObject({ queued: 1 });
      expect(runnerMock.runPipeline).toHaveBeenCalledWith("https://www.instagram.com/p/weak/", { force: true });
    });
  });
});
