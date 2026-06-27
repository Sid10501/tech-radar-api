import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listFindings, parseFindingMarkdown } from "../src/findings.js";

const SAMPLE_FINDING = `# Ponytail agent rubric

**Source:** instagram · [Shawn](https://www.instagram.com/reel/DZmyMFoqCRm/)
**Saved:** 20260615
**Tags:** instagram, computerscience, skill, tech

## TL;DR

Ponytail is useful as operating-system guidance, not a replacement for Superpowers.

## What the post showed

> Caption: this skill mimics that one senior dev with glasses and ponytail

Key claims from transcript:
It helps save tokens and make better architecture decisions.

On-screen text / OCR:
Token usage down
smallest useful diff

## What it actually is

- What: A reusable senior-dev prompt/rubric.
- Who built it / maintained by: Shawn
- Status: unknown
- Why it matters: It improves signal-to-noise in AI code review.
- GitHub stars: 120 · License: MIT · Archived: no

## Links

- Repo: https://github.com/example/ponytail

## Fit for Sid

- Target project: ai-memory
- Verdict: \`#try-soon\`
`;

describe("parseFindingMarkdown()", () => {
  it("extracts dashboard metadata, evidence flags, and quality from a finding", () => {
    const finding = parseFindingMarkdown("20260615-video-by-shawnchee.md", SAMPLE_FINDING);

    expect(finding.id).toBe("20260615-video-by-shawnchee.md");
    expect(finding.title).toBe("Ponytail agent rubric");
    expect(finding.source.platform).toBe("instagram");
    expect(finding.source.url).toBe("https://www.instagram.com/reel/DZmyMFoqCRm/");
    expect(finding.saved).toBe("2026-06-15");
    expect(finding.tags).toEqual(["instagram", "computerscience", "skill", "tech"]);
    expect(finding.targetProject).toBe("ai-memory");
    expect(finding.verdict).toBe("#try-soon");
    expect(finding.evidence.caption).toBe(true);
    expect(finding.evidence.transcript).toBe(true);
    expect(finding.evidence.ocr).toBe(true);
    expect(finding.evidence.repo).toBe(true);
    expect(finding.quality.score).toBeGreaterThanOrEqual(80);
    expect(finding.quality.level).toBe("strong");
    expect(finding.recommendedAction).toBe("Create task");
  });
});

describe("listFindings()", () => {
  it("reads findings from an ai-memory checkout newest first", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-findings-"));
    const findingsDir = path.join(dir, "tech-radar", "findings");
    fs.mkdirSync(findingsDir, { recursive: true });
    fs.writeFileSync(path.join(findingsDir, "20260615-video-by-shawnchee.md"), SAMPLE_FINDING);
    fs.writeFileSync(
      path.join(findingsDir, "20260501-low-confidence.md"),
      SAMPLE_FINDING.replace("**Saved:** 20260615", "**Saved:** 20260501").replace("On-screen text / OCR:", "No visual text:"),
    );

    const findings = listFindings(dir);

    expect(findings).toHaveLength(2);
    expect(findings[0].saved).toBe("2026-06-15");
    expect(findings[1].saved).toBe("2026-05-01");
  });
});
