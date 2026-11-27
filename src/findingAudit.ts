import type { FindingSummary, PublicFindingSummary } from "./findings.js";

import type { LabReview } from "./lab.js";
import type { CaptureCoverage } from "./lib/captureCoverage.js";

function describeSlideCounts(coverage?: CaptureCoverage): string {
  if (!coverage) return "No slide counts recorded.";
  if (coverage.listed === null) return "The extractor could not enumerate the slides.";
  return `${coverage.withText} of ${coverage.listed} listed media items returned OCR text.`;
}

// The queue uses the complete canonical archive. It is a read-only view of evidence and owner decisions.
export function recoveryQueue(findings: FindingSummary[], reviews: Pick<LabReview, "findingId" | "decision">[]) {
  const dismissed = new Set(reviews.filter(review => review.decision === "Dismiss").map(review => review.findingId));
  return findings.flatMap(finding => {
    const duplicate = finding.diagnostics.duplicateGroup;
    if (dismissed.has(finding.id) || (duplicate && duplicate.canonicalFindingId !== finding.id)) return [];
    const { status, reasons } = enrichmentProfile(finding);
    if (status !== "needs-enrichment") return [];
    let priority = 3;
    let reason = "Source evidence is weak";
    let nextAction = "Compare the saved claims with the original source and check for a first-party reference.";
    if (reasons.includes("incomplete_capture")) {
      priority = 0;
      reason = "Incomplete slide capture";
      nextAction = "Check the listed slides against the source and record which slides still need text or visual review.";
    } else if (reasons.includes("shortlink_unresolved")) {
      priority = 1;
      reason = "Unresolved source link";
      nextAction = "Open the original source and verify the destination before retrying extraction.";
    } else if (reasons.includes("missing_repo_or_docs")) {
      priority = 2;
      reason = "Missing repository or documentation";
      nextAction = "Check the original post for the named project's first-party repository or documentation.";
    }
    if (!finding.source.url) nextAction = "Recover the original source URL before checking this finding.";
    return [{ id: finding.id, priority, reason, nextAction,
      currentSlides: describeSlideCounts(finding.captureCoverage),
      previousSlides: describeSlideCounts(finding.retry?.previousCoverage),
      capturedSignals: evidenceKeys.filter(key => finding.evidence[key]) }];
  }).sort((a, b) => a.priority - b.priority);
}

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
  | "incomplete_capture"
  | "weak_quality"
  | "missing_repo_or_docs"
  | "missing_transcript"
  | "missing_ocr"
  | "source_uncertainty"
  | "low_repo_signal"
  | "concept_only"
  | "educational_post"
  | "no_artifact_expected"
  | "repo_found_source_weak"
  | "shortlink_unresolved"
  | "dm_gated_no_link";
export type PrivateEnrichmentReason = "target_project_none" | "skip_verdict" | "recommended_skip";

export interface EnrichmentProfile {
  status: EnrichmentStatus;
  publicStatus: PublicEnrichmentStatus;
  reasons: EnrichmentReason[];
  privateReasons: PrivateEnrichmentReason[];
}

export interface PublicEnrichmentProfile {
  status: PublicEnrichmentStatus;
  reasons: EnrichmentReason[];
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
    incomplete_capture: 0,
    weak_quality: 0,
    missing_repo_or_docs: 0,
    missing_transcript: 0,
    missing_ocr: 0,
    source_uncertainty: 0,
    low_repo_signal: 0,
    concept_only: 0,
    educational_post: 0,
    no_artifact_expected: 0,
    repo_found_source_weak: 0,
    shortlink_unresolved: 0,
    dm_gated_no_link: 0,
  };
}

function hasPublicArtifactEvidence(finding: FindingSummary | PublicFindingSummary): boolean {
  return finding.evidence.repo || finding.evidence.docs || finding.source.classification === "public_artifact";
}

function publicNeedsEnrichment(finding: PublicFindingSummary): boolean {
  return publicEnrichmentProfile(finding).status === "needs-enrichment";
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
  const blocked = hasEnrichmentBlockingReason(reasons, finding);
  const status = reasons.includes("incomplete_capture") ? "needs-enrichment" : privateReasons.length ? "skip" : blocked ? "needs-enrichment" : "ready";
  return {
    status,
    publicStatus: blocked ? "needs-enrichment" : "ready",
    reasons,
    privateReasons,
  };
}

export function publicEnrichmentProfile(finding: PublicFindingSummary): PublicEnrichmentProfile {
  const reasons = enrichmentReasonsFor(finding);
  return {
    status: hasEnrichmentBlockingReason(reasons, finding) ? "needs-enrichment" : "ready",
    reasons,
  };
}

function enrichmentReasonsFor(finding: FindingSummary | PublicFindingSummary): EnrichmentReason[] {
  const reasons: EnrichmentReason[] = [];
  const add = (reason: EnrichmentReason) => {
    if (!reasons.includes(reason)) reasons.push(reason);
  };
  if (finding.quality.level === "weak") add("weak_quality");
  if (!hasPublicArtifactEvidence(finding)) add("missing_repo_or_docs");
  if (!finding.evidence.transcript) add("missing_transcript");
  if (!finding.evidence.ocr) add("missing_ocr");
  if (finding.quality.reasons.includes("source uncertainty")) add("source_uncertainty");
  if (finding.quality.reasons.includes("low repo signal")) add("low_repo_signal");
  for (const reason of finding.triage?.reasons ?? []) add(reason);
  return reasons;
}

function hasEnrichmentBlockingReason(reasons: EnrichmentReason[], finding?: FindingSummary | PublicFindingSummary): boolean {
  if (finding?.triage && !finding.triage.retryable) return false;
  return reasons.some((reason) =>
    reason === "incomplete_capture" ||
    reason === "weak_quality" ||
    reason === "missing_repo_or_docs" ||
    reason === "source_uncertainty" ||
    reason === "low_repo_signal" ||
    reason === "repo_found_source_weak" ||
    reason === "shortlink_unresolved"
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
    const profile = publicEnrichmentProfile(finding);
    if (profile.status === "needs-enrichment") summary.needsEnrichment += 1;
    countReasons(summary, profile.reasons);
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
    if (status === "needs-enrichment" && !isSameSourceDuplicate(finding)) counts.enrich += 1;
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

function isSameSourceDuplicate(finding: FindingSummary): boolean {
  return finding.diagnostics.duplicateGroup?.reason === "same source URL";
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
