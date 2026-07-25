import { describe, expect, it } from "vitest";

import {
  DASHBOARD_HTML,
  dashboardReasonKey,
  dedupeDashboardReasons,
} from "../src/dashboard.js";

describe("dashboard reason presentation", () => {
  it("treats triage prefixes and case as presentation-only", () => {
    expect(dashboardReasonKey("triage Shortlink unresolved")).toBe("shortlink unresolved");
    expect(dashboardReasonKey("  SOURCE UNCERTAINTY ")).toBe("source uncertainty");
  });

  it("keeps the first highest-priority label for equivalent reasons", () => {
    expect(dedupeDashboardReasons([
      "triage Shortlink unresolved",
      "shortlink unresolved",
      "Source uncertainty",
      "source uncertainty",
    ])).toEqual(["triage Shortlink unresolved", "Source uncertainty"]);
  });
});

describe("dashboard HTML", () => {
  it("keeps primary mobile filters visible and secondary filters behind More", () => {
    const html = DASHBOARD_HTML([]);

    expect(html).toContain('class="primary-filters"');
    expect(html).toContain('id="more-filters"');
    expect(html).toContain('aria-controls="secondary-filters"');
    expect(html).toContain('id="secondary-filters" class="secondary-filters" aria-hidden="false"');
    expect(html).toContain("grid-template-columns: repeat(4, minmax(0, 1fr))");
    expect(html).toContain("function setSecondaryFiltersOpen(open)");
    expect(html).toContain("secondaryFilters.has(state.filter)");
  });

  it("provides separate desktop and compact mobile mode copy", () => {
    const html = DASHBOARD_HTML([]);

    expect(html).toContain('id="mode-note-wide"');
    expect(html).toContain('id="mode-note-compact"');
    expect(html).toContain(".mode-note-compact { display: none; }");
    expect(html).toContain("Public view · Unlock for project fit");
    expect(html).toContain("Sid view · Project fit visible");
  });

  it("renders audit count hooks without tabs", () => {
    const html = DASHBOARD_HTML([]);

    expect(html).toContain('data-filter="enrich"');
    expect(html).toContain('data-filter="skip"');
    expect(html).toContain('data-count-for="repo"');
    expect(html).toContain("batch-health");
    expect(html).not.toContain('class="tabs"');
  });

  it("renders compact expandable mobile batch health without changing desktop data", () => {
    const html = DASHBOARD_HTML([]);

    expect(html).toContain('class="batch-health-region"');
    expect(html).toContain('id="batch-health" class="batch-health"');
    expect(html).toContain('id="batch-health-mobile" class="batch-health-mobile"');
    expect(html).toContain('id="batch-health-summary"');
    expect(html).toContain('id="batch-health-details"');
    expect(html).toContain("function renderBatchHealth()");
    expect(html).toContain("value > 0");
    expect(html).toContain("No flagged reasons");
  });

  it("keeps the desktop split explorer hooks", () => {
    const html = DASHBOARD_HTML([]);

    expect(html).toContain('class="workspace"');
    expect(html).toContain('class="queue"');
    expect(html).toContain('id="detail" class="content"');
    expect(html).toContain("grid-template-columns: minmax(300px, 390px) minmax(0, 1fr)");
  });

  it("defines mobile drill-in hooks without changing frameworks", () => {
    const html = DASHBOARD_HTML([]);

    expect(html).toContain('id="mobile-back"');
    expect(html).toContain("mobile-detail-open");
    expect(html).toContain("isMobileViewport");
    expect(html).toContain("setMobileDetailOpen");
    expect(html).toContain("data-mobile-primary");
    expect(html).not.toContain("react");
    expect(html).not.toContain("next/");
  });

  it("renders mobile triage affordance hooks", () => {
    const html = DASHBOARD_HTML([]);

    expect(html).toContain("evidence-chip");
    expect(html).toContain("mobile-detail-bar");
    expect(html).toContain("mobile-back");
  });

  it("uses a one-screen mobile queue and detail layout", () => {
    const html = DASHBOARD_HTML([]);

    expect(html).toContain("height: 100dvh");
    expect(html).toContain("grid-template-rows: auto auto auto auto minmax(0, 1fr)");
    expect(html).toContain("position: sticky");
    expect(html).toContain("top: 0");
  });

  it("does not link public users to raw unsanitized markdown", () => {
    const html = DASHBOARD_HTML([]);

    expect(html).not.toContain("Open markdown");
    expect(html).not.toContain("github.com/Sid10501/ai-memory/blob/master");
  });

  it("renders enrichment reason count hooks from audit data", () => {
    const html = DASHBOARD_HTML([]);

    expect(html).toContain("enrichmentReasons");
    expect(html).toContain("const reasonCountLabels");
    expect(html).toContain("Missing links");
    expect(html).toContain("Weak quality");
    expect(html).toContain("Concept only");
    expect(html).toContain("No artifact expected");
    expect(html).toContain("Shortlink unresolved");
    expect(html).toContain("Source uncertainty");
    expect(html).toContain("enrichmentReasons[key] ?? 0");
  });

  it("does not filter source-backed public artifacts into Needs enrichment only for missing repo/docs", () => {
    const html = DASHBOARD_HTML([]);

    expect(html).toContain("isSourceBackedPublicArtifact");
    expect(html).toContain('state.filter === "repo"');
    expect(html).toContain('state.filter === "enrich"');
  });

  it("renders retry history and extraction warning diagnostics in the existing detail explorer", () => {
    const html = DASHBOARD_HTML([]);

    expect(html).toContain("retryHistory");
    expect(html).toContain("Extraction warnings");
    expect(html).toContain("extractionWarnings");
    expect(html).not.toContain("createRoot");
  });

  it("resets stale quality filters when users start a text search", () => {
    const html = DASHBOARD_HTML([]);

    expect(html).toContain("function resetFilterToAll()");
    expect(html).toContain('if (state.query.trim() && state.filter !== "all") resetFilterToAll();');
    expect(html).toContain("emptyListMessage");
  });

  it("owns mobile history entries without changing the URL", () => {
    const html = DASHBOARD_HTML([]);

    expect(html).toContain('const mobileHistoryMarker = "tech-radar-dashboard"');
    expect(html).toContain("function ensureMobileHistoryRoot()");
    expect(html).toContain("history.replaceState(mobileHistorySnapshot");
    expect(html).toContain("history.pushState(nextEntry, \"\", location.href)");
    expect(html).toContain('window.addEventListener("popstate"');
  });

  it("restores mobile list controls and scroll from history", () => {
    const html = DASHBOARD_HTML([]);

    expect(html).toContain("function mobileHistorySnapshot(overrides = {})");
    expect(html).toContain("filter: state.filter");
    expect(html).toContain("query: state.query");
    expect(html).toContain('scrollTop: $("finding-list").scrollTop');
    expect(html).toContain("requestAnimationFrame(() =>");
    expect(html).toContain("list.scrollTop = entry.scrollTop || 0");
  });

  it("routes finding, workflow, release-note, and in-page back actions through mobile history", () => {
    const html = DASHBOARD_HTML([]);

    expect(html).toContain('selectFinding(button.dataset.id, { openDetail: true, historyMode: "push" })');
    expect(html).toContain('selectFinding(link.dataset.workflowFinding, { openDetail: true, historyMode: "push" })');
    expect(html).toContain('loadReleaseNotes({ historyMode: "push" })');
    expect(html).toContain("function closeMobileView()");
    expect(html).toContain("function restoreMobileListFallback(message)");
    expect(html).toContain("history.back()");
  });

  it("keeps startup finding reloads from stomping an open release notes view", () => {
    const html = DASHBOARD_HTML([]);

    expect(html).toContain("async function loadFindings(options = {})");
    expect(html).toContain('if (!options.preserveView) state.view = "findings";');
    expect(html).toContain("await loadFindings({ preserveView: true });");
  });

  it("loads private run state only after the authenticated session is unlocked", () => {
    const html = DASHBOARD_HTML([]);

    expect(html).toContain('fetch("/runs", { headers: requestHeaders(), credentials: "same-origin" })');
    expect(html).toContain("if (!state.privateUnlocked)");
    expect(html).toContain("await loadRuns();");
  });

  it("uses compact mobile action labels that cannot wrap over the brand", () => {
    const html = DASHBOARD_HTML([]);

    expect(html).toContain('class="wide-label"');
    expect(html).toContain('class="short-label"');
    expect(html).toContain("repeat(4, minmax(0, 1fr))");
    expect(html).toContain(".filter span {");
    expect(html).toContain("margin-left: 3px");
  });

  it("opens release notes in the mobile detail pane and closes them through mobile history", () => {
    const html = DASHBOARD_HTML([]);

    expect(html).toContain("async function loadReleaseNotes(options = {})");
    expect(html).toContain("if (isMobileViewport()) setMobileDetailOpen(true);");
    expect(html).toContain("closeMobileView();");
  });

  it("renders duplicate and quality reason chips on finding cards", () => {
    const html = DASHBOARD_HTML([]);

    expect(html).toContain("function prioritizedQualityReasons(f)");
    expect(html).toContain("function qualityReasonChips(f)");
    expect(html).toContain("f.diagnostics?.duplicateGroup");
    expect(html).toContain('reason.startsWith("triage ")');
    expect(html).toContain("duplicate");
    expect(html).toContain("duplicate/retry history");
    expect(html).toContain("repo found, source weak");
    expect(html).toContain("data-triage-chip");
    expect(html).toContain("data-reason-chip");
    expect(html).toContain("${qualityReasonChips(f)}");
  });

  it("renders triage reason labels in the detail explorer", () => {
    const html = DASHBOARD_HTML([]);

    expect(html).toContain("triageReasonLabels");
    expect(html).toContain("function triageChips(f)");
    expect(html).toContain("Triage");
    expect(html).toContain("Retryable");
    expect(html).toContain("${triageChips(f)}");
  });

  it("renders workflow map hooks for parent and child artifact findings", () => {
    const html = DASHBOARD_HTML([]);

    expect(html).toContain("function workflowMapPanel(f)");
    expect(html).toContain("Workflow map");
    expect(html).toContain("data-workflow-finding");
    expect(html).toContain("workflow.children");
    expect(html).toContain("workflow.parent");
  });
});
