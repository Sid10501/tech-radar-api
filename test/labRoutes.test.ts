import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildServer } from "../src/server.js";
import { LabStore } from "../src/lab.js";
const dirs: string[] = [];
afterEach(() => { delete process.env.AUTH_TOKEN; dirs.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true })); });
describe("Community Lab route boundary", () => {
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
