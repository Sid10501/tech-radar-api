import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Mock runner before importing server so the routes work without a real pipeline
vi.mock("../src/runner.js", () => ({
  runPipeline: vi.fn(async () => ({ runId: "mock-run-id", findingPath: "tech-radar/findings/test.md" })),
  getRun: vi.fn((id: string) => id === "existing" ? { id, url: "https://x.com", status: "processed", startedAt: new Date().toISOString() } : undefined),
  listRuns: vi.fn(() => [{ id: "existing", url: "https://x.com", status: "processed", startedAt: new Date().toISOString() }]),
}));

const { buildServer } = await import("../src/server.js");

describe("server routes", () => {
  const app = buildServer();

  beforeAll(() => app.ready());
  afterAll(() => app.close());

  it("GET /healthz returns 200 with { ok: true }", async () => {
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("GET / returns HTML page", async () => {
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("Tech Radar");
    expect(res.body).toContain("dashboard-root");
    expect(res.body).toContain("Raw extraction");
    expect(res.body).toContain("data-filter=\"repo\"");
    expect(res.body).toContain("data-filter=\"project\"");
    expect(res.body).toContain("data-filter=\"ocr\"");
    expect(res.body).not.toContain("class=\"tabs\"");
    expect(res.body).not.toContain("evidence-tab");
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
  });

  it("GET /api/public/findings/:id returns sanitized markdown without auth", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "server-public-detail-"));
    const findingsDir = path.join(dir, "tech-radar", "findings");
    fs.mkdirSync(findingsDir, { recursive: true });
    fs.writeFileSync(
      path.join(findingsDir, "sample.md"),
      "# Sample\n\n## TL;DR\n\nPublic\n\n## Fit for Sid\n\nPrivate project fit\n\n## Implementation Idea\n\nPrivate action",
    );
    process.env["AI_MEMORY_LOCAL_DIR"] = dir;

    const res = await app.inject({ method: "GET", url: "/api/public/findings/sample.md" });

    expect(res.statusCode).toBe(200);
    expect(res.json().markdown).toContain("## TL;DR");
    expect(res.json().markdown).not.toContain("Fit for Sid");
    expect(res.json().markdown).not.toContain("Implementation Idea");
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
    });

    it("GET /api/session reports private lock state without exposing token", async () => {
      const locked = await app.inject({ method: "GET", url: "/api/session" });
      const unlocked = await app.inject({
        method: "GET",
        url: "/api/session",
        headers: { cookie: `auth_token=${TOKEN}` },
      });

      expect(locked.statusCode).toBe(200);
      expect(locked.json()).toEqual({ privateUnlocked: false });
      expect(unlocked.statusCode).toBe(200);
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
  });
});
