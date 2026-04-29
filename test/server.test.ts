import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

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
    expect(res.body).toContain("<form");
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
  });
});
