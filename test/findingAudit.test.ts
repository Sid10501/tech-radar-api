import { describe, expect, it } from "vitest";
import type { FindingSummary, PublicFindingSummary } from "../src/findings.js";
import { auditFindings, auditPublicFindings, enrichmentProfile, enrichmentStatus, filterCounts, filterCountsFromPublic } from "../src/findingAudit.js";

function finding(overrides: Partial<FindingSummary> = {}): FindingSummary {
  return {
    id: "sample.md",
    filename: "sample.md",
    path: "tech-radar/findings/sample.md",
    title: "Sample",
    saved: "2026-06-28",
    tags: ["instagram"],
    source: { platform: "instagram", label: "Creator", url: "https://example.com/post", classification: "unknown" },
    targetProject: "tech-radar-api",
    verdict: "#try-soon",
    summary: "Summary",
    evidence: { caption: true, transcript: false, ocr: false, repo: false, docs: false },
    quality: { score: 42, level: "weak", reasons: ["caption", "source uncertainty"] },
    recommendedAction: "Retry",
    ...overrides,
  };
}

function publicFinding(overrides: Partial<PublicFindingSummary> = {}): PublicFindingSummary {
  return {
    id: "public.md",
    filename: "public.md",
    path: "tech-radar/findings/public.md",
    title: "Public",
    saved: "2026-06-28",
    tags: ["github"],
    source: { platform: "github", label: "Repo", url: "https://github.com/example/tool", classification: "public_artifact" },
    summary: "Summary",
    evidence: { caption: true, transcript: false, ocr: false, repo: true, docs: false },
    quality: { score: 60, level: "review", reasons: ["caption", "repo"] },
    isPrivate: false,
    ...overrides,
  };
}

describe("finding audit helpers", () => {
  it("computes latest batch health and evidence counts for FindingSummary rows", () => {
    const rows = [
      finding({
        id: "a.md",
        quality: { score: 85, level: "strong", reasons: [] },
        evidence: { caption: true, transcript: true, ocr: true, repo: true, docs: false },
        recommendedAction: "Create task",
      }),
      finding({
        id: "b.md",
        quality: { score: 63, level: "review", reasons: [] },
        evidence: { caption: true, transcript: false, ocr: false, repo: true, docs: true },
        recommendedAction: "Review",
      }),
      finding({
        id: "c.md",
        quality: { score: 20, level: "weak", reasons: [] },
        evidence: { caption: true, transcript: false, ocr: false, repo: false, docs: false },
      }),
    ];

    expect(auditFindings(rows, 3)).toEqual({
      total: 3,
      quality: { strong: 1, review: 1, weak: 1 },
      evidence: { caption: 3, transcript: 1, ocr: 1, repo: 2, docs: 1 },
      actions: { "Create task": 1, Backlog: 0, Skip: 0, Retry: 1, Review: 1 },
      needsEnrichment: 1,
      missingTranscript: 2,
      missingRepoOrDocs: 1,
      enrichmentReasons: {
        weak_quality: 1,
        missing_repo_or_docs: 1,
        missing_transcript: 2,
        missing_ocr: 2,
        source_uncertainty: 0,
        low_repo_signal: 0,
      },
    });
  });

  it("computes public audit without private action or project fields", () => {
    const rows = [
      publicFinding(),
      publicFinding({
        id: "weak.md",
        evidence: { caption: true, transcript: false, ocr: true, repo: false, docs: false },
        quality: { score: 40, level: "weak", reasons: ["caption", "OCR"] },
      }),
    ];

    const audit = auditPublicFindings(rows);

    expect(audit).toEqual({
      total: 2,
      quality: { strong: 0, review: 1, weak: 1 },
      evidence: { caption: 2, transcript: 0, ocr: 1, repo: 1, docs: 0 },
      needsEnrichment: 1,
      missingTranscript: 2,
      missingRepoOrDocs: 1,
      enrichmentReasons: {
        weak_quality: 1,
        missing_repo_or_docs: 1,
        missing_transcript: 2,
        missing_ocr: 1,
        source_uncertainty: 0,
        low_repo_signal: 0,
      },
    });
    expect(audit).not.toHaveProperty("actions");
    expect(filterCountsFromPublic(rows)).toEqual({
      all: 2,
      strong: 0,
      review: 1,
      weak: 1,
      repo: 1,
      ocr: 1,
      enrich: 1,
    });
    expect(filterCountsFromPublic(rows)).not.toHaveProperty("project");
    expect(filterCountsFromPublic(rows)).not.toHaveProperty("skip");
  });

  it("returns private enrichment states from evidence and project decision fields", () => {
    expect(enrichmentStatus(finding({ targetProject: "Cross-Tax" }))).toBe("needs-enrichment");
    expect(enrichmentStatus(finding({ targetProject: "none", verdict: "#try-soon" }))).toBe("skip");
    expect(enrichmentStatus(finding({ verdict: "#skip-after-review" }))).toBe("skip");
    expect(enrichmentStatus(finding({ recommendedAction: "Skip" }))).toBe("skip");
    expect(
      enrichmentStatus(
        finding({
          evidence: { caption: true, transcript: true, ocr: false, repo: true, docs: false },
          quality: { score: 82, level: "strong", reasons: ["caption", "transcript", "repo"] },
        }),
      ),
    ).toBe("ready");
  });

  it("returns public-safe enrichment reasons separately from private skip reasons", () => {
    const profile = enrichmentProfile(
      finding({
        targetProject: "none",
        verdict: "#skip",
        recommendedAction: "Skip",
        quality: { score: 12, level: "weak", reasons: ["source uncertainty", "low repo signal"] },
      }),
    );

    expect(profile).toEqual({
      status: "skip",
      publicStatus: "needs-enrichment",
      reasons: ["weak_quality", "missing_repo_or_docs", "missing_transcript", "missing_ocr", "source_uncertainty", "low_repo_signal"],
      privateReasons: ["target_project_none", "skip_verdict", "recommended_skip"],
    });
  });

  it("computes filter counts used by the dashboard", () => {
    const counts = filterCounts([
      finding({
        id: "a.md",
        quality: { score: 85, level: "strong", reasons: [] },
        evidence: { caption: true, transcript: true, ocr: true, repo: true, docs: false },
      }),
      finding({ id: "b.md", targetProject: "none", verdict: "#skip", recommendedAction: "Skip" }),
      finding({
        id: "c.md",
        targetProject: "unknown",
        quality: { score: 65, level: "review", reasons: [] },
        evidence: { caption: true, transcript: true, ocr: false, repo: false, docs: true },
        recommendedAction: "Review",
      }),
      finding({ id: "d.md", targetProject: "unknown" }),
    ]);

    expect(counts).toEqual({
      all: 4,
      strong: 1,
      review: 1,
      weak: 2,
      repo: 2,
      project: 1,
      ocr: 1,
      enrich: 1,
      skip: 1,
    });
  });
});
