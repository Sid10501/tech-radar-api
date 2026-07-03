import type { FindingSummary, PublicFindingSummary } from "./findings.js";

type QualityLevel = FindingSummary["quality"]["level"];
type EvidenceKey = keyof FindingSummary["evidence"];
type Action = FindingSummary["recommendedAction"];

export interface FindingAuditSummary {
  total: number;
  quality: Record<QualityLevel, number>;
  evidence: Record<EvidenceKey, number>;
  needsEnrichment: number;
  missingTranscript: number;
  missingRepoOrDocs: number;
}

export interface PrivateFindingAuditSummary extends FindingAuditSummary {
  actions: Record<Action, number>;
}

export interface FindingFilterCounts {
  all: number;
  strong: number;
  review: number;
  weak: number;
  repo: number;
  project: number;
  ocr: number;
  enrich: number;
  skip: number;
}

export type PublicFindingFilterCounts = Omit<FindingFilterCounts, "project" | "skip">;

export type EnrichmentStatus = "ready" | "needs-enrichment" | "skip";

const evidenceKeys: EvidenceKey[] = ["caption", "transcript", "ocr", "repo", "docs"];

function emptyQualityCounts(): Record<QualityLevel, number> {
  return { strong: 0, review: 0, weak: 0 };
}

function emptyEvidenceCounts(): Record<EvidenceKey, number> {
  return { caption: 0, transcript: 0, ocr: 0, repo: 0, docs: 0 };
}

function emptyActionCounts(): Record<Action, number> {
  return { "Create task": 0, Backlog: 0, Skip: 0, Retry: 0, Review: 0 };
}

function publicNeedsEnrichment(finding: PublicFindingSummary): boolean {
  return finding.quality.level === "weak" || (!finding.evidence.repo && !finding.evidence.docs);
}

export function enrichmentStatus(finding: FindingSummary): EnrichmentStatus {
  if (finding.recommendedAction === "Skip" || finding.verdict.includes("#skip") || finding.targetProject === "none") {
    return "skip";
  }
  if (finding.quality.level === "weak" || (!finding.evidence.repo && !finding.evidence.docs)) {
    return "needs-enrichment";
  }
  return "ready";
}

export function auditFindings(findings: FindingSummary[], limit = 15): PrivateFindingAuditSummary {
  const summary: PrivateFindingAuditSummary = {
    total: 0,
    quality: emptyQualityCounts(),
    evidence: emptyEvidenceCounts(),
    actions: emptyActionCounts(),
    needsEnrichment: 0,
    missingTranscript: 0,
    missingRepoOrDocs: 0,
  };

  for (const finding of findings.slice(0, limit)) {
    summary.total += 1;
    summary.quality[finding.quality.level] += 1;
    summary.actions[finding.recommendedAction] += 1;
    countEvidence(summary, finding);
    if (enrichmentStatus(finding) === "needs-enrichment") summary.needsEnrichment += 1;
    if (!finding.evidence.transcript) summary.missingTranscript += 1;
    if (!finding.evidence.repo && !finding.evidence.docs) summary.missingRepoOrDocs += 1;
  }

  return summary;
}

export function auditPublicFindings(findings: PublicFindingSummary[], limit = 15): FindingAuditSummary {
  const summary: FindingAuditSummary = {
    total: 0,
    quality: emptyQualityCounts(),
    evidence: emptyEvidenceCounts(),
    needsEnrichment: 0,
    missingTranscript: 0,
    missingRepoOrDocs: 0,
  };

  for (const finding of findings.slice(0, limit)) {
    summary.total += 1;
    summary.quality[finding.quality.level] += 1;
    countEvidence(summary, finding);
    if (publicNeedsEnrichment(finding)) summary.needsEnrichment += 1;
    if (!finding.evidence.transcript) summary.missingTranscript += 1;
    if (!finding.evidence.repo && !finding.evidence.docs) summary.missingRepoOrDocs += 1;
  }

  return summary;
}

export function filterCounts(findings: FindingSummary[]): FindingFilterCounts {
  const counts = emptyFilterCounts();

  for (const finding of findings) {
    counts.all += 1;
    counts[finding.quality.level] += 1;
    if (finding.evidence.repo || finding.evidence.docs) counts.repo += 1;
    if (finding.targetProject && finding.targetProject !== "none" && finding.targetProject !== "unknown") counts.project += 1;
    if (finding.evidence.ocr) counts.ocr += 1;
    const status = enrichmentStatus(finding);
    if (status === "needs-enrichment") counts.enrich += 1;
    if (status === "skip") counts.skip += 1;
  }

  return counts;
}

export function filterCountsFromPublic(findings: PublicFindingSummary[]): PublicFindingFilterCounts {
  const counts: PublicFindingFilterCounts = {
    all: 0,
    strong: 0,
    review: 0,
    weak: 0,
    repo: 0,
    ocr: 0,
    enrich: 0,
  };

  for (const finding of findings) {
    counts.all += 1;
    counts[finding.quality.level] += 1;
    if (finding.evidence.repo || finding.evidence.docs) counts.repo += 1;
    if (finding.evidence.ocr) counts.ocr += 1;
    if (publicNeedsEnrichment(finding)) counts.enrich += 1;
  }

  return counts;
}

function countEvidence(summary: FindingAuditSummary, finding: FindingSummary | PublicFindingSummary): void {
  for (const key of evidenceKeys) {
    if (finding.evidence[key]) summary.evidence[key] += 1;
  }
}

function emptyFilterCounts(): FindingFilterCounts {
  return {
    all: 0,
    strong: 0,
    review: 0,
    weak: 0,
    repo: 0,
    project: 0,
    ocr: 0,
    enrich: 0,
    skip: 0,
  };
}
