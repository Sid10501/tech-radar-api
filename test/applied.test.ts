import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadAppliedMap } from "../src/applied.js";
import { getPublicFindingDetail, listPublicFindings } from "../src/findings.js";

const SAMPLE_FINDING = `# Ponytail agent rubric

**Source:** instagram · [Shawn](https://www.instagram.com/reel/DZmyMFoqCRm/)
**Saved:** 20260615
**Tags:** instagram, skill

## TL;DR

Ponytail is useful as operating-system guidance.

## Links

- Repo: https://github.com/example/ponytail

## Fit for Sid

- Target project: ai-memory
- Verdict: \`#try-soon\`
`;

function makeAiMemoryDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const findingsDir = path.join(dir, "tech-radar", "findings");
  fs.mkdirSync(findingsDir, { recursive: true });
  fs.writeFileSync(path.join(findingsDir, "20260615-video-by-shawnchee.md"), SAMPLE_FINDING);
  return dir;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadAppliedMap()", () => {
  it("reads applied entries keyed by finding filename from tech-radar/applied.json", () => {
    const dir = makeAiMemoryDir("applied-map-valid-");
    fs.writeFileSync(
      path.join(dir, "tech-radar", "applied.json"),
      JSON.stringify({
        "20260615-video-by-shawnchee.md": {
          appliedAt: "2026-07-06",
          link: "https://github.com/Sid10501/ai-memory",
          note: "adopted the rubric",
        },
      }),
    );

    const map = loadAppliedMap(dir);

    expect(map["20260615-video-by-shawnchee.md"]).toEqual({
      appliedAt: "2026-07-06",
      link: "https://github.com/Sid10501/ai-memory",
      note: "adopted the rubric",
    });
  });

  it("returns an empty map when applied.json is missing", () => {
    const dir = makeAiMemoryDir("applied-map-missing-");

    expect(loadAppliedMap(dir)).toEqual({});
  });

  it("warns and returns an empty map when applied.json is invalid JSON", () => {
    const dir = makeAiMemoryDir("applied-map-corrupt-");
    fs.writeFileSync(path.join(dir, "tech-radar", "applied.json"), "{not json");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(loadAppliedMap(dir)).toEqual({});
    expect(warn).toHaveBeenCalledOnce();
  });

  it("warns and returns an empty map when applied.json is not an object", () => {
    const dir = makeAiMemoryDir("applied-map-array-");
    fs.writeFileSync(path.join(dir, "tech-radar", "applied.json"), JSON.stringify(["nope"]));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(loadAppliedMap(dir)).toEqual({});
    expect(warn).toHaveBeenCalledOnce();
  });

  it("drops entries that are missing appliedAt or link", () => {
    const dir = makeAiMemoryDir("applied-map-partial-");
    fs.writeFileSync(
      path.join(dir, "tech-radar", "applied.json"),
      JSON.stringify({
        "20260615-video-by-shawnchee.md": { appliedAt: "2026-07-06", link: "https://example.com" },
        "broken.md": { appliedAt: "2026-07-06" },
        "worse.md": "not an object",
      }),
    );

    const map = loadAppliedMap(dir);

    expect(Object.keys(map)).toEqual(["20260615-video-by-shawnchee.md"]);
  });
});

describe("applied mapping in public findings", () => {
  it("exposes applied entries on public summaries and details", () => {
    const dir = makeAiMemoryDir("applied-public-");
    fs.writeFileSync(
      path.join(dir, "tech-radar", "applied.json"),
      JSON.stringify({
        "20260615-video-by-shawnchee.md": {
          appliedAt: "2026-07-06",
          link: "https://github.com/Sid10501/ai-memory",
        },
      }),
    );

    const [summary] = listPublicFindings(dir);
    const detail = getPublicFindingDetail("20260615-video-by-shawnchee.md", dir);

    expect(summary.applied).toEqual({
      appliedAt: "2026-07-06",
      link: "https://github.com/Sid10501/ai-memory",
    });
    expect(detail?.finding.applied).toEqual({
      appliedAt: "2026-07-06",
      link: "https://github.com/Sid10501/ai-memory",
    });
  });

  it("defaults applied to null for unmapped findings", () => {
    const dir = makeAiMemoryDir("applied-null-");
    fs.writeFileSync(
      path.join(dir, "tech-radar", "applied.json"),
      JSON.stringify({ "other-finding.md": { appliedAt: "2026-07-06", link: "https://example.com" } }),
    );

    const [summary] = listPublicFindings(dir);

    expect(summary.applied).toBeNull();
  });

  it("degrades to applied null for all findings when applied.json is corrupt", () => {
    const dir = makeAiMemoryDir("applied-corrupt-public-");
    fs.writeFileSync(path.join(dir, "tech-radar", "applied.json"), "{not json");
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const findings = listPublicFindings(dir);
    const detail = getPublicFindingDetail("20260615-video-by-shawnchee.md", dir);

    expect(findings.map((finding) => finding.applied)).toEqual([null]);
    expect(detail?.finding.applied).toBeNull();
  });

  it("degrades to applied null when applied.json is missing", () => {
    const dir = makeAiMemoryDir("applied-missing-public-");

    const [summary] = listPublicFindings(dir);

    expect(summary.applied).toBeNull();
  });
});
