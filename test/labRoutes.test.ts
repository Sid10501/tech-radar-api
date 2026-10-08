import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildServer } from "../src/server.js";
import { LabStore } from "../src/lab.js";
import Fastify from "fastify";
import { registerLabRoutes } from "../src/labRoutes.js";
const dirs: string[] = [];
afterEach(() => { delete process.env.AUTH_TOKEN; dirs.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true })); });
describe("Community Lab route boundary", () => {
  it("authenticates review routes, checks current findings, and deduplicates experiment requests", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-routes-")); dirs.push(dir);
    const app = Fastify(); const store = new LabStore(dir);
    registerLabRoutes(app, store, request => request.headers.authorization === "Bearer owner", async () => { throw new Error("capture unused"); },
      async id => id === "signal.md" ? { title: "Real finding", summary: "Real observed problem" } : null);
    const url = "/api/lab/reviews/signal.md"; const headers = { authorization: "Bearer owner" };
    const review = { decision: "Try", rationale: "Useful to test", projectSlug: "radar", expectedUpdatedAt: null };
    try {
      expect((await app.inject({ url })).statusCode).toBe(401);
      expect((await app.inject({ method: "PUT", url, payload: review })).statusCode).toBe(401);
      expect((await app.inject({ method: "POST", url: url + "/experiment", payload: { question: "Q", successCriteria: "S" } })).statusCode).toBe(401);
      expect((await app.inject({ method: "PUT", url: "/api/lab/reviews/unknown.md", headers, payload: review })).statusCode).toBe(404);
      expect((await app.inject({ method: "PUT", url: "/api/lab/reviews/%2e%2e%2fsecret.md", headers, payload: review })).statusCode).toBe(400);
      expect((await app.inject({ method: "POST", url: url + "/experiment", headers, payload: { question: "Q", successCriteria: "S" } })).statusCode).toBe(400);
      const saved = await app.inject({ method: "PUT", url, headers, payload: review });
      expect(saved.statusCode).toBe(200);
      expect((await app.inject({ method: "PUT", url, headers, payload: review })).statusCode).toBe(409);
      expect((await app.inject({ url, headers })).json().review.rationale).toBe("Useful to test");
      const payload = { question: "Does it work?", successCriteria: "Demonstrate a real improvement" };
      const responses = await Promise.all(Array.from({ length: 4 }, () => app.inject({ method: "POST", url: url + "/experiment", headers, payload })));
      expect(new Set(responses.map(response => response.json().brief.id)).size).toBe(1);
      expect(responses[0].json().brief).toMatchObject({ title: "Real finding", problem: "Real observed problem", visibility: "private", evidenceIds: [] });
      const brief = responses[0].json().brief;
      const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...draftInput } = brief;
      const updated = await app.inject({ method: "PATCH", url: `/api/lab/briefs/${brief.id}`, headers, payload: { ...draftInput, problem: "Refined problem", expectedUpdatedAt: brief.updatedAt } });
      expect(updated.statusCode).toBe(200);
      expect(updated.json().brief.problem).toBe("Refined problem");
      const publish = await app.inject({ method: "PATCH", url: `/api/lab/briefs/${brief.id}`, headers, payload: { ...draftInput, visibility: "public", expectedUpdatedAt: updated.json().brief.updatedAt } });
      expect(publish.statusCode).toBe(400);
      expect(publish.json().error).toMatch(/captured discussion/i);
      expect(store.read().briefs).toHaveLength(1);
      expect((await app.inject({ url: "/api/public/lab" })).json()).toEqual({ schemaVersion: 1, briefs: [], evidence: [] });
    } finally { await app.close(); }
  });
  it("fails closed without an owner token, exposes no private records, and supports authorized capture", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-routes-")); dirs.push(dir);
    const evidence = { id: "github:1", source: "github" as const, url: "https://github.com/a/b/issues/1", title: "Reported issue", body: "private raw text", comments: [], retrievedAt: new Date().toISOString(), status: "ok" as const, warnings: [] };
    const app = buildServer({ labStore: new LabStore(dir), captureDiscussion: async () => evidence });
    try {
      expect((await app.inject({ url: "/api/lab" })).statusCode).toBe(401);
      expect((await app.inject({ method: "POST", url: "/api/lab/capture", payload: { url: evidence.url } })).statusCode).toBe(401);
      process.env.AUTH_TOKEN = "test-owner";
      const headers = { authorization: "Bearer test-owner" };
      const capture = await app.inject({ method: "POST", url: "/api/lab/capture", headers, payload: { url: evidence.url } });
      expect(capture.statusCode).toBe(201);
      expect(capture.json().evidence.body).toBe(evidence.body);
      const feed = await app.inject({ url: "/api/public/lab" });
      expect(feed.json()).toEqual({ schemaVersion: 1, briefs: [], evidence: [] });
      expect(feed.headers["cache-control"]).toContain("no-store");
      expect((await app.inject({ method: "POST", url: "/api/lab/briefs", headers, payload: { title: "bad" } })).statusCode).toBe(400);
      const page = await app.inject({ url: "/lab" });
      expect(page.statusCode).toBe(200);
      expect(page.body).not.toContain(evidence.body);
      expect(page.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    } finally { await app.close(); }
  });
});

it("requires owner authorization for mutations and removes unpublished briefs on the next public read", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-routes-")); dirs.push(dir);
  process.env.AUTH_TOKEN = "test-owner";
  const store = new LabStore(dir);
  store.saveEvidence({ id: "github:1", source: "github", url: "https://github.com/a/b/issues/1", title: "Public source", body: "OWNER RAW TEXT", comments: [], retrievedAt: new Date().toISOString(), status: "ok", warnings: [] });
  const app = buildServer({ labStore: store }); const headers = { authorization: "Bearer test-owner" };
  const input = { title: "Reviewed brief", problem: "A reported problem", workarounds: [], disagreements: ["Not reproduced"], existingSolutions: [], projectSlug: null, findingIds: [], evidenceIds: ["github:1"], visibility: "public", experiment: { question: "Can it work?", successCriteria: "Fixture passes", status: "planned", result: null, evidenceUrls: [] } };
  try {
    expect((await app.inject({ method: "POST", url: "/api/lab/briefs", payload: input })).statusCode).toBe(401);
    const created = await app.inject({ method: "POST", url: "/api/lab/briefs", headers, payload: input });
    expect(created.statusCode).toBe(201); const { brief } = created.json();
    const publicResponse = await app.inject({ url: "/api/public/lab" });
    expect(publicResponse.json().briefs).toHaveLength(1); expect(publicResponse.body).not.toContain("OWNER RAW TEXT");
    const patch = { ...input, visibility: "private", expectedUpdatedAt: brief.updatedAt };
    expect((await app.inject({ method: "PATCH", url: `/api/lab/briefs/${brief.id}`, payload: patch })).statusCode).toBe(401);
    expect((await app.inject({ method: "PATCH", url: `/api/lab/briefs/${brief.id}`, headers, payload: patch })).statusCode).toBe(200);
    expect((await app.inject({ method: "PATCH", url: `/api/lab/briefs/${brief.id}`, headers, payload: patch })).statusCode).toBe(409);
    expect((await app.inject({ url: "/api/public/lab" })).json()).toEqual({ schemaVersion: 1, briefs: [], evidence: [] });
    expect((await app.inject({ url: "/api/lab", headers })).json().briefs).toHaveLength(1);
  } finally { await app.close(); }
});

it("refuses an explicitly temporary production Lab directory", () => {
  const saved = { NODE_ENV: process.env.NODE_ENV, RUN_STATE_DIR: process.env.RUN_STATE_DIR, LAB_STATE_DIR: process.env.LAB_STATE_DIR, AUTH_TOKEN: process.env.AUTH_TOKEN };
  try {
    process.env.NODE_ENV = "production"; process.env.RUN_STATE_DIR = path.join(process.cwd(), "data"); process.env.LAB_STATE_DIR = "/tmp/community-lab"; process.env.AUTH_TOKEN = "owner";
    expect(() => buildServer()).toThrow(/LAB_STATE_DIR.*persistent/);
  } finally { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
});
