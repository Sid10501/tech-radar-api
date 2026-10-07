import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LabStore, BriefInputSchema } from "../src/lab.js";
const dirs: string[] = [];
function store() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-test-")); dirs.push(dir); return { dir, db: new LabStore(dir) }; }
afterEach(() => { vi.restoreAllMocks(); dirs.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true })); });
const evidence = { id: "github:example", source: "github" as const, url: "https://github.com/a/b/issues/1", title: "Late frames missing", body: "A private raw source body", comments: [], retrievedAt: "2026-09-12T00:00:00.000Z", status: "ok" as const, warnings: [] };
const input = { title: "Cover the full video", problem: "Late visual facts are missed", workarounds: [], disagreements: [], existingSolutions: [], projectSlug: "tech-radar", findingIds: [], evidenceIds: [evidence.id], experiment: { question: "Do late frames survive?", successCriteria: "Recover the final labeled frame", status: "planned", result: null, evidenceUrls: [] }, visibility: "private" };
describe("Community Lab records", () => {
  it("persists edits across instances and publishes only explicitly public linked metadata", () => {
    const { dir, db } = store(); db.saveEvidence(evidence);
    const brief = db.createBrief(input);
    expect(new LabStore(dir).read().briefs[0].title).toBe(input.title);
    expect(db.publicFeed().briefs).toEqual([]);
    const published = db.updateBrief(brief.id, { ...input, visibility: "public" }, brief.updatedAt);
    const feed = new LabStore(dir).publicFeed();
    expect(feed.briefs[0].id).toBe(published.id);
    expect(feed.evidence[0].url).toBe(evidence.url);
    expect(JSON.stringify(feed)).not.toContain(evidence.body);
    expect(feed.evidence[0]).not.toHaveProperty("comments");
    db.updateBrief(brief.id, input, published.updatedAt);
    expect(db.publicFeed()).toMatchObject({ briefs: [], evidence: [] });
  });
  it("rejects missing evidence, stale edits and completed experiments without a result and evidence", () => {
    const { db } = store();
    expect(() => db.createBrief(input)).toThrow(/evidence/i);
    db.saveEvidence(evidence); const brief = db.createBrief(input);
    const changed = db.updateBrief(brief.id, { ...input, title: "New title" }, brief.updatedAt);
    expect(() => db.updateBrief(brief.id, input, brief.updatedAt)).toThrow(/changed/i);
    expect(changed.title).toBe("New title");
    expect(BriefInputSchema.safeParse({ ...input, experiment: { ...input.experiment, status: "passed" } }).success).toBe(false);
    expect(BriefInputSchema.safeParse({ ...input, experiment: { ...input.experiment, status: "passed", result: "Recovered frame at 118 seconds", evidenceUrls: ["https://github.com/a/b/pull/2"] } }).success).toBe(true);
  });
  it("rejects executable links and refuses to overwrite corrupt state", () => {
    expect(BriefInputSchema.safeParse({ ...input, experiment: { ...input.experiment, evidenceUrls: ["javascript:alert(1)"] } }).success).toBe(false);
    const { db, dir } = store(); fs.writeFileSync(path.join(dir, "community-lab.json"), "broken");
    expect(() => db.saveEvidence(evidence)).toThrow(/corrupt/i);
    expect(fs.readFileSync(path.join(dir, "community-lab.json"), "utf8")).toBe("broken");
  });
  it("does not acknowledge a durable save when directory sync fails after rename", () => {
    const { db } = store();
    const fsync = fs.fsyncSync;
    vi.spyOn(fs, "fsyncSync").mockImplementation((fd) => {
      if (fs.fstatSync(fd).isDirectory()) throw new Error("directory sync failed");
      fsync(fd);
    });
    expect(() => db.saveEvidence(evidence)).toThrow("directory sync failed");
  });
});
