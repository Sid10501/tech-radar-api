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
  enrichmentReasons: Record<EnrichmentReason, number>;
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
export type PublicEnrichmentStatus = "ready" | "needs-enrichment";
export type EnrichmentReason =
  | "weak_quality"
  | "missing_repo_or_docs"
  | "missing_transcript"
  | "missing_ocr"
  | "source_uncertainty"
  | "low_repo_signal";
export type PrivateEnrichmentReason = "target_project_none" | "skip_verdict" | "recommended_skip";

export interface EnrichmentProfile {
  status: EnrichmentStatus;
  publicStatus: PublicEnrichmentStatus;
  reasons: EnrichmentReason[];
  privateReasons: PrivateEnrichmentReason[];
}

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

function emptyReasonCounts(): Record<EnrichmentReason, number> {
  return {
    weak_quality: 0,
    missing_repo_or_docs: 0,
    missing_transcript: 0,
    missing_ocr: 0,
    source_uncertainty: 0,
    low_repo_signal: 0,
  };
}

function hasPublicArtifactEvidence(finding: FindingSummary | PublicFindingSummary): boolean {
  return finding.evidence.repo || finding.evidence.docs || finding.source.classification === "public_artifact";
}

function publicNeedsEnrichment(finding: PublicFindingSummary): boolean {
  return finding.quality.level === "weak" || !hasPublicArtifactEvidence(finding);
}

export function enrichmentStatus(finding: FindingSummary): EnrichmentStatus {
  return enrichmentProfile(finding).status;
}

export function enrichmentProfile(finding: FindingSummary): EnrichmentProfile {
  const reasons = enrichmentReasonsFor(finding);
  const privateReasons: PrivateEnrichmentReason[] = [];
  if (finding.targetProject === "none") privateReasons.push("target_project_none");
  if (finding.verdict.includes("#skip")) privateReasons.push("skip_verdict");
  if (finding.recommendedAction === "Skip") privateReasons.push("recommended_skip");
  const blocked = hasEnrichmentBlockingReason(reasons);
  const status = privateReasons.length ? "skip" : blocked ? "needs-enrichment" : "ready";
  return {
    status,
    publicStatus: blocked ? "needs-enrichment" : "ready",
    reasons,
    privateReasons,
  };
}

function enrichmentReasonsFor(finding: FindingSummary | PublicFindingSummary): EnrichmentReason[] {
  const reasons: EnrichmentReason[] = [];
  if (finding.quality.level === "weak") reasons.push("weak_quality");
  if (!hasPublicArtifactEvidence(finding)) reasons.push("missing_repo_or_docs");
  if (!finding.evidence.transcript) reasons.push("missing_transcript");
  if (!finding.evidence.ocr) reasons.push("missing_ocr");
  if (finding.quality.reasons.includes("source uncertainty")) reasons.push("source_uncertainty");
  if (finding.quality.reasons.includes("low repo signal")) reasons.push("low_repo_signal");
  return reasons;
}

function hasEnrichmentBlockingReason(reasons: EnrichmentReason[]): boolean {
  return reasons.some((reason) =>
    reason === "weak_quality" ||
    reason === "missing_repo_or_docs" ||
    reason === "source_uncertainty" ||
    reason === "low_repo_signal"
  );
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
    enrichmentReasons: emptyReasonCounts(),
  };

  for (const finding of findings.slice(0, limit)) {
    summary.total += 1;
    summary.quality[finding.quality.level] += 1;
    summary.actions[finding.recommendedAction] += 1;
    countEvidence(summary, finding);
    const profile = enrichmentProfile(finding);
    if (profile.status === "needs-enrichment") summary.needsEnrichment += 1;
    countReasons(summary, profile.reasons);
    if (!finding.evidence.transcript) summary.missingTranscript += 1;
    if (!hasPublicArtifactEvidence(finding)) summary.missingRepoOrDocs += 1;
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
    enrichmentReasons: emptyReasonCounts(),
  };

  for (const finding of findings.slice(0, limit)) {
    summary.total += 1;
    summary.quality[finding.quality.level] += 1;
    countEvidence(summary, finding);
    if (publicNeedsEnrichment(finding)) summary.needsEnrichment += 1;
    countReasons(summary, enrichmentReasonsFor(finding));
    if (!finding.evidence.transcript) summary.missingTranscript += 1;
    if (!hasPublicArtifactEvidence(finding)) summary.missingRepoOrDocs += 1;
  }

  return summary;
}

export function filterCounts(findings: FindingSummary[]): FindingFilterCounts {
  const counts = emptyFilterCounts();

  for (const finding of findings) {
    counts.all += 1;
    counts[finding.quality.level] += 1;
    if (hasPublicArtifactEvidence(finding)) counts.repo += 1;
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
    if (hasPublicArtifactEvidence(finding)) counts.repo += 1;
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

function countReasons(summary: FindingAuditSummary, reasons: EnrichmentReason[]): void {
  for (const reason of reasons) {
    summary.enrichmentReasons[reason] += 1;
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
