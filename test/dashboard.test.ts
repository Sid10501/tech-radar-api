import vm from "node:vm";

import { describe, expect, it } from "vitest";

import {
  DASHBOARD_HTML,
  dashboardReasonKey,
  dedupeDashboardReasons,
} from "../src/dashboard.js";

const findingFixture = (id: string, title: string, workflow: Record<string, unknown> = {}) => ({
  id,
  title,
  summary: `${title} summary`,
  saved: "2026-07-24",
  source: {
    platform: "github",
    url: `https://example.com/${id}`,
    classification: "public_artifact",
  },
  quality: { level: "strong", score: 90, reasons: [] },
  evidence: { caption: true, transcript: true, ocr: false, repo: true, docs: false },
  tags: [],
  triage: { kind: "artifact", retryable: false, reasons: [] },
  enrichment: { status: "complete" },
  workflow,
});

const parentFinding = findingFixture("parent.md", "Parent workflow", {
  kind: "workflow",
  children: [{
    filename: "child.md",
    title: "Child artifact",
    type: "repository",
    role: "implementation",
    url: "https://example.com/child",
    status: "processed",
  }],
});
const childFinding = findingFixture("child.md", "Child artifact", {
  kind: "artifact",
  parent: {
    filename: "parent.md",
    title: "Parent workflow",
    type: "workflow",
    role: "source",
  },
});

function detailFixture(finding: ReturnType<typeof findingFixture>) {
  return {
    finding,
    sections: {
      tldr: finding.summary,
      shown: "",
      workflow: "",
      research: finding.summary,
      links: "",
      kickstarter: "",
      fit: "",
      implementation: "",
      childArtifacts: "",
      followups: "",
      retryHistory: "",
      extractionWarnings: "",
    },
    markdown: "",
  };
}

function createDashboardHarness(options: {
  initialHistoryState?: unknown;
  mobile?: boolean;
  findingsResponse?: Promise<unknown>;
  detailResponse?: (id: string) => Promise<unknown>;
  releaseNotesResponse?: Promise<unknown>;
  fetch?: (url: string) => Promise<unknown>;
} = {}) {
  const html = DASHBOARD_HTML([]);
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  if (!script) throw new Error("Dashboard inline script not found");

  const listeners: Record<string, (event: any) => void> = {};
  class FakeClassList {
    values = new Set<string>();
    toggle(name: string, force?: boolean) {
      const enabled = force ?? !this.values.has(name);
      if (enabled) this.values.add(name);
      else this.values.delete(name);
      return enabled;
    }
    contains(name: string) {
      return this.values.has(name);
    }
  }
  class FakeElement {
    id: string;
    dataset: Record<string, string> = {};
    classList = new FakeClassList();
    attributes: Record<string, string> = {};
    style: Record<string, string> = {};
    textContent: any = "";
    innerHTML = "";
    scrollTop = 0;
    disabled = false;
    hidden = false;
    value = "";
    handlers: Record<string, (event: any) => void> = {};
    children = new Map<string, FakeElement>();
    constructor(id: string) {
      this.id = id;
    }
    addEventListener(type: string, handler: (event: any) => void) {
      this.handlers[type] = handler;
    }
    setAttribute(name: string, value: string) {
      this.attributes[name] = value;
    }
    querySelector(selector: string) {
      return this.children.get(selector) || null;
    }
    querySelectorAll() {
      return [];
    }
  }

  const elements = new Map<string, FakeElement>();
  for (const id of html.matchAll(/\sid="([^"]+)"/g)) {
    elements.set(id[1], new FakeElement(id[1]));
  }
  const unlock = elements.get("unlock")!;
  unlock.children.set(".wide-label", new FakeElement("unlock-wide"));
  unlock.children.set(".short-label", new FakeElement("unlock-short"));
  const filters = ["all", "strong", "review", "weak", "repo", "enrich", "ocr", "project", "skip"].map((key) => {
    const element = new FakeElement(`filter-${key}`);
    element.dataset.filter = key;
    if (key === "all") element.classList.toggle("active", true);
    return element;
  });
  const countElements = filters.map((filter) => {
    const element = new FakeElement(`count-${filter.dataset.filter}`);
    element.dataset.countFor = filter.dataset.filter;
    return element;
  });
  const document = {
    getElementById(id: string) {
      return elements.get(id) || null;
    },
    querySelectorAll(selector: string) {
      if (selector === ".filter[data-filter]" || selector === ".filter") return filters;
      if (selector === "[data-count-for]") return countElements;
      return [];
    },
  };

  const entries: Array<{ state: unknown; url: string }> = [{
    state: options.initialHistoryState ?? null,
    url: "http://dashboard.test/",
  }];
  let historyIndex = 0;
  const history = {
    get state() {
      return entries[historyIndex].state;
    },
    replaceState(state: unknown, _title: string, url: string) {
      entries[historyIndex] = { state, url };
    },
    pushState(state: unknown, _title: string, url: string) {
      entries.splice(historyIndex + 1);
      entries.push({ state, url });
      historyIndex += 1;
    },
    back() {
      if (historyIndex === 0) return;
      historyIndex -= 1;
      listeners.popstate?.({ state: entries[historyIndex].state });
    },
    entries,
    get index() {
      return historyIndex;
    },
  };

  const findings = [parentFinding, childFinding];
  const defaultFetch = async (url: string) => {
    if (url === "/api/session") return { ok: true, json: async () => ({ privateUnlocked: false }) };
    if (url === "/api/public/findings") {
      return options.findingsResponse || { ok: true, json: async () => ({ findings }) };
    }
    if (url === "/api/public/audit") {
      return {
        ok: true,
        json: async () => ({
          audit: {
            total: findings.length,
            evidence: { repo: 2, docs: 0, transcript: 2 },
            needsEnrichment: 0,
            enrichmentReasons: {},
          },
          filters: { all: 2, strong: 2 },
        }),
      };
    }
    if (url.startsWith("/api/public/findings/")) {
      const id = decodeURIComponent(url.slice("/api/public/findings/".length));
      if (options.detailResponse) return options.detailResponse(id);
      const finding = findings.find((candidate) => candidate.id === id);
      return { ok: Boolean(finding), json: async () => detailFixture(finding!) };
    }
    if (url === "/api/public/release-notes") {
      if (options.releaseNotesResponse) return options.releaseNotesResponse;
      return { ok: true, json: async () => ({ releases: [] }) };
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  let mobile = options.mobile ?? true;
  const context = vm.createContext({
    console,
    document,
    history,
    location: { href: "http://dashboard.test/", search: "" },
    navigator: {},
    URLSearchParams,
    fetch: options.fetch || defaultFetch,
    requestAnimationFrame: (callback: () => void) => callback(),
    setTimeout: () => 0,
    clearTimeout: () => {},
  });
  Object.assign(context, {
    window: {
      __RUNS__: [],
      matchMedia: () => ({ matches: mobile }),
      addEventListener: (type: string, handler: (event: any) => void) => {
        listeners[type] = handler;
      },
    },
  });
  vm.runInContext(script, context);

  return {
    context,
    elements,
    history,
    async evaluate<T>(expression: string): Promise<T> {
      return await vm.runInContext(expression, context);
    },
    async settle() {
      for (let index = 0; index < 12; index += 1) await Promise.resolve();
    },
    setMobile(value: boolean) {
      mobile = value;
      listeners.resize?.({});
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

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
  it("renders desktop filters in the detail toolbar instead of permanent sidebar chrome", () => {
    const html = DASHBOARD_HTML([]);

    expect(html).toContain('class="detail-shell"');
    expect(html).toContain('id="filter-toolbar" class="filter-toolbar" aria-label="Filter findings"');
    expect(html).toContain('id="queue-filter-summary"');
    expect(html).toContain('id="active-filter-label"');
    expect(html).toContain('id="audit-toggle"');
    expect(html).toContain('id="audit-panel"');
    expect(html).not.toContain('class="batch-health-region"');
  });

  it("orders keyboard flow as filters, findings list, then detail body", () => {
    const html = DASHBOARD_HTML([]);

    const toolbarIndex = html.indexOf('id="filter-toolbar"');
    const listIndex = html.indexOf('id="finding-list"');
    const detailIndex = html.indexOf('id="detail-body"');

    expect(toolbarIndex).toBeGreaterThan(-1);
    expect(listIndex).toBeGreaterThan(-1);
    expect(detailIndex).toBeGreaterThan(-1);
    expect(toolbarIndex).toBeLessThan(listIndex);
    expect(listIndex).toBeLessThan(detailIndex);
    expect(html).toContain("grid-template-areas:");
    expect(html).toContain('"queue toolbar"');
  });

  it("keeps the desktop queue chrome compact so the finding list starts high", () => {
    const html = DASHBOARD_HTML([]);

    expect(html).toContain("grid-template-rows: auto minmax(0, 1fr)");
    expect(html).toContain(".queue-filter-summary");
    expect(html).toContain(".queue-head.compact");
    expect(html).not.toContain("grid-template-rows: auto auto auto auto minmax(0, 1fr)");
  });

  it("renders audit metrics inside a hidden-by-default disclosure panel", () => {
    const html = DASHBOARD_HTML([]);

    expect(html).toContain('button id="audit-toggle"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-controls="audit-panel"');
    expect(html).toContain('id="audit-panel" class="audit-panel" hidden');
    expect(html).toContain('id="audit-metrics"');
    expect(html).toContain("function setAuditPanelOpen(open)");
  });

  it("keeps primary mobile filters visible and secondary filters behind More", () => {
    const html = DASHBOARD_HTML([]);

    expect(html).toContain('class="toolbar-filter-group primary-filters"');
    expect(html).toContain('id="more-filters"');
    expect(html).toContain('aria-controls="secondary-filters"');
    expect(html).toContain('id="secondary-filters" class="toolbar-filter-group secondary-filters" aria-hidden="false"');
    expect(html).toContain("grid-template-columns: repeat(4, minmax(0, 1fr))");
    expect(html).toContain('"toolbar"');
    expect(html).toContain("function setSecondaryFiltersOpen(open)");
    expect(html).toContain("secondaryFilters.has(state.filter)");
  });

  it("keeps the More disclosure hidden in the desktop toolbar", () => {
    const html = DASHBOARD_HTML([]);

    expect(html).toContain(".filter.more-filter { display: none; }");
  });

  it("provides separate desktop and compact mobile mode copy", () => {
    const html = DASHBOARD_HTML([]);

    expect(html).toContain('id="mode-note-wide"');
    expect(html).toContain('id="mode-note-compact"');
    expect(html).toContain(".mode-note-wide { display: none; }");
    expect(html).toContain('id="active-filter-label"');
    expect(html).toContain('state.privateUnlocked ? "Sid view" : "Public view"');
  });

  it("renders audit count hooks inside the toolbar disclosure without tabs", () => {
    const html = DASHBOARD_HTML([]);

    expect(html).toContain('data-filter="enrich"');
    expect(html).toContain('data-filter="skip"');
    expect(html).toContain('data-count-for="repo"');
    expect(html).toContain("audit-metrics");
    expect(html).not.toContain('class="tabs"');
  });

  it("renders compact expandable mobile batch health through the audit panel data", () => {
    const html = DASHBOARD_HTML([]);

    expect(html).toContain('id="audit-summary-mobile"');
    expect(html).toContain('id="audit-mobile-details"');
    expect(html).toContain("function renderBatchHealth()");
    expect(html).toContain("value > 0");
    expect(html).toContain("max-height: 92px");
    expect(html).toContain("No flagged reasons");
  });

  it("keeps the mobile More and Audit disclosures mutually exclusive through button handlers", async () => {
    const harness = createDashboardHarness();
    await harness.settle();

    harness.elements.get("more-filters")?.handlers.click({});
    expect(await harness.evaluate(`
      ({
        secondaryOpen: state.secondaryFiltersOpen,
        moreExpanded: $("more-filters").attributes["aria-expanded"],
        auditExpanded: $("audit-toggle").attributes["aria-expanded"],
        auditHidden: $("audit-panel").hidden
      })
    `)).toEqual({
      secondaryOpen: true,
      moreExpanded: "true",
      auditExpanded: "false",
      auditHidden: true,
    });

    harness.elements.get("audit-toggle")?.handlers.click({});
    expect(await harness.evaluate(`
      ({
        secondaryOpen: state.secondaryFiltersOpen,
        moreExpanded: $("more-filters").attributes["aria-expanded"],
        auditExpanded: $("audit-toggle").attributes["aria-expanded"],
        auditHidden: $("audit-panel").hidden
      })
    `)).toEqual({
      secondaryOpen: false,
      moreExpanded: "false",
      auditExpanded: "true",
      auditHidden: false,
    });

    harness.elements.get("more-filters")?.handlers.click({});
    expect(await harness.evaluate(`
      ({
        secondaryOpen: state.secondaryFiltersOpen,
        moreExpanded: $("more-filters").attributes["aria-expanded"],
        auditExpanded: $("audit-toggle").attributes["aria-expanded"],
        auditHidden: $("audit-panel").hidden
      })
    `)).toEqual({
      secondaryOpen: true,
      moreExpanded: "true",
      auditExpanded: "false",
      auditHidden: true,
    });
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
    expect(html).toContain("grid-template-rows: auto auto minmax(0, 1fr)");
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

  it("does not restore mobile history entries while desktop layout is active", () => {
    const html = DASHBOARD_HTML([]);

    expect(html).toContain('window.addEventListener("popstate", (event) => {\n      if (!isMobileViewport()) return;\n      void restoreMobileHistory(event.state);\n    });');
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
    expect(html).toContain("canonicalFindingId");
    expect(html).toContain("duplicateGroup.count");
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

  it("normalizes stale detail history on startup before parent-child drill-in and Back", async () => {
    const harness = createDashboardHarness({
      initialHistoryState: {
        marker: "tech-radar-dashboard",
        view: "finding",
        findingId: "child.md",
        selectedId: "child.md",
        filter: "all",
        query: "",
        scrollTop: 0,
      },
    });
    await harness.settle();

    expect(harness.history.state).toMatchObject({
      marker: "tech-radar-dashboard",
      view: "findings",
    });

    await harness.evaluate(`selectFinding("parent.md", { openDetail: true, historyMode: "push" })`);
    await harness.evaluate(`selectFinding("child.md", { openDetail: true, historyMode: "push" })`);
    harness.history.back();
    await harness.settle();
    expect(await harness.evaluate(`({ selectedId: state.selectedId, mobileDetailOpen: state.mobileDetailOpen })`)).toEqual({
      selectedId: "parent.md",
      mobileDetailOpen: true,
    });

    harness.history.back();
    await harness.settle();
    expect(await harness.evaluate(`({ view: state.view, mobileDetailOpen: state.mobileDetailOpen })`)).toEqual({
      view: "findings",
      mobileDetailOpen: false,
    });
  });

  it("restores the visible mobile list after desktop release notes, resize, and finding drill-in", async () => {
    const harness = createDashboardHarness({ mobile: false });
    await harness.settle();
    await harness.evaluate(`loadReleaseNotes({ historyMode: "push" })`);

    harness.setMobile(true);
    await harness.evaluate(`selectFinding("parent.md", { openDetail: true, historyMode: "push" })`);
    harness.history.back();
    await harness.settle();

    expect(await harness.evaluate(`({ view: state.view, mobileDetailOpen: state.mobileDetailOpen })`)).toEqual({
      view: "findings",
      mobileDetailOpen: false,
    });
    expect(harness.elements.get("detail-body")?.innerHTML).not.toContain("Release notes");
  });

  it("restores the visible list after search closes mobile notes and a finding opens", async () => {
    const harness = createDashboardHarness();
    await harness.settle();
    await harness.evaluate(`loadReleaseNotes({ historyMode: "push" })`);

    harness.elements.get("search")?.handlers.input?.({ target: { value: "Parent" } });
    expect(await harness.evaluate(`state.mobileDetailOpen`)).toBe(false);
    await harness.evaluate(`selectFinding("parent.md", { openDetail: true, historyMode: "push" })`);
    harness.history.back();
    await harness.settle();

    expect(await harness.evaluate(`({ view: state.view, mobileDetailOpen: state.mobileDetailOpen })`)).toEqual({
      view: "findings",
      mobileDetailOpen: false,
    });
    expect(harness.elements.get("detail-body")?.innerHTML).not.toContain("Release notes");
  });

  it("keeps release notes open when the deferred initial findings load completes", async () => {
    const findingsResponse = deferred<unknown>();
    const harness = createDashboardHarness({ findingsResponse: findingsResponse.promise });
    await harness.settle();

    await harness.evaluate(`loadReleaseNotes({ historyMode: "push" })`);
    findingsResponse.resolve({
      ok: true,
      json: async () => ({ findings: [parentFinding, childFinding] }),
    });
    await harness.settle();

    expect(await harness.evaluate(`state.view`)).toBe("release-notes");
    expect(harness.elements.get("detail-body")?.innerHTML).toContain("Release notes");
  });

  it.each([
    [
      "rejected fetch",
      () => Promise.reject(new Error("network unavailable")),
    ],
    [
      "malformed JSON",
      () => Promise.resolve({
        ok: true,
        json: async () => {
          throw new SyntaxError("invalid JSON");
        },
      }),
    ],
    [
      "non-2xx response",
      () => Promise.resolve({
        ok: false,
        json: async () => ({}),
      }),
    ],
  ])("falls back to the findings list when restored detail has %s", async (_caseName, failingResponse) => {
    let parentRequests = 0;
    const harness = createDashboardHarness({
      detailResponse: async (id) => {
        const finding = id === "parent.md" ? parentFinding : childFinding;
        if (id === "parent.md" && ++parentRequests > 1) return failingResponse();
        return { ok: true, json: async () => detailFixture(finding) };
      },
    });
    await harness.settle();
    await harness.evaluate(`state.detailCache.clear()`);
    const restoredEntry = {
      marker: "tech-radar-dashboard",
      view: "finding",
      findingId: "parent.md",
      selectedId: "parent.md",
      filter: "all",
      query: "",
      scrollTop: 0,
    };
    harness.history.replaceState(restoredEntry, "", "http://dashboard.test/");

    await expect(harness.evaluate(`restoreMobileHistory(history.state)`)).resolves.toBeUndefined();
    expect(await harness.evaluate(`({ view: state.view, mobileDetailOpen: state.mobileDetailOpen })`)).toEqual({
      view: "findings",
      mobileDetailOpen: false,
    });
    expect(harness.elements.get("toast")?.textContent).toBe("Could not restore finding.");
  });

  it("shows a load error when the current non-restored finding receives a non-2xx response", async () => {
    let parentRequests = 0;
    const harness = createDashboardHarness({
      detailResponse: async (id) => {
        const finding = id === "parent.md" ? parentFinding : childFinding;
        if (id === "parent.md" && ++parentRequests > 1) {
          return { ok: false, json: async () => ({}) };
        }
        return { ok: true, json: async () => detailFixture(finding) };
      },
    });
    await harness.settle();
    await harness.evaluate(`state.detailCache.delete(detailCacheKey("parent.md"))`);

    await harness.evaluate(`selectFinding("parent.md")`);

    expect(harness.elements.get("toast")?.textContent).toBe("Could not load finding.");
  });

  it("ignores a restored-detail failure after a newer finding selection wins", async () => {
    const restoredFailure = deferred<unknown>();
    let parentRequests = 0;
    const harness = createDashboardHarness({
      detailResponse: async (id) => {
        const finding = id === "parent.md" ? parentFinding : childFinding;
        if (id === "parent.md" && ++parentRequests > 1) return restoredFailure.promise;
        return { ok: true, json: async () => detailFixture(finding) };
      },
    });
    await harness.settle();
    await harness.evaluate(`state.detailCache.delete(detailCacheKey("parent.md"))`);
    const restoredEntry = {
      marker: "tech-radar-dashboard",
      view: "finding",
      findingId: "parent.md",
      selectedId: "parent.md",
      filter: "all",
      query: "",
      scrollTop: 0,
    };
    harness.history.replaceState(restoredEntry, "", "http://dashboard.test/");

    const restorePromise = harness.evaluate(`restoreMobileHistory(history.state)`);
    await harness.settle();
    await harness.evaluate(`selectFinding("child.md", { openDetail: true, historyMode: "push" })`);
    restoredFailure.reject(new Error("late network failure"));

    await expect(restorePromise).resolves.toBeUndefined();
    expect(await harness.evaluate(`({ selectedId: state.selectedId, mobileDetailOpen: state.mobileDetailOpen })`)).toEqual({
      selectedId: "child.md",
      mobileDetailOpen: true,
    });
  });

  it("ignores a restored-detail non-2xx response after history returns to the list", async () => {
    const restoredResponse = deferred<unknown>();
    let parentRequests = 0;
    const harness = createDashboardHarness({
      detailResponse: async (id) => {
        const finding = id === "parent.md" ? parentFinding : childFinding;
        if (id === "parent.md" && ++parentRequests > 1) return restoredResponse.promise;
        return { ok: true, json: async () => detailFixture(finding) };
      },
    });
    await harness.settle();
    await harness.evaluate(`state.detailCache.delete(detailCacheKey("parent.md"))`);
    const restoredEntry = {
      marker: "tech-radar-dashboard",
      view: "finding",
      findingId: "parent.md",
      selectedId: "parent.md",
      filter: "all",
      query: "",
      scrollTop: 0,
    };
    harness.history.replaceState(restoredEntry, "", "http://dashboard.test/");
    const restorePromise = harness.evaluate(`restoreMobileHistory(history.state)`);
    await harness.settle();

    harness.history.replaceState({ ...restoredEntry, view: "findings", findingId: null }, "", "http://dashboard.test/");
    await harness.evaluate(`restoreMobileHistory(history.state)`);
    restoredResponse.resolve({ ok: false, json: async () => ({}) });

    await expect(restorePromise).resolves.toBeUndefined();
    expect(await harness.evaluate(`({ view: state.view, mobileDetailOpen: state.mobileDetailOpen })`)).toEqual({
      view: "findings",
      mobileDetailOpen: false,
    });
    expect(harness.elements.get("toast")?.textContent).toBe("");
  });

  it.each([
    [
      "success",
      {
        ok: true,
        json: async () => ({
          releases: [{
            date: "2026-07-24",
            title: "Late release",
            bodyMarkdown: "Late release body",
          }],
        }),
      },
    ],
    [
      "failure",
      {
        ok: false,
        json: async () => ({}),
      },
    ],
  ])("does not let stale release-note %s overwrite Back after switching to desktop", async (_caseName, response) => {
    const releaseNotesResponse = deferred<unknown>();
    const harness = createDashboardHarness({ releaseNotesResponse: releaseNotesResponse.promise });
    await harness.settle();

    const releaseNotesPromise = harness.evaluate(`loadReleaseNotes({ historyMode: "push" })`);
    await harness.settle();
    harness.history.back();
    await harness.settle();
    harness.setMobile(false);
    const restoredDetail = harness.elements.get("detail-body")?.innerHTML;
    expect(restoredDetail).not.toContain("Release notes");
    releaseNotesResponse.resolve(response);

    await expect(releaseNotesPromise).resolves.toBeUndefined();
    expect(await harness.evaluate(`state.view`)).toBe("findings");
    expect(harness.elements.get("detail-body")?.innerHTML).toBe(restoredDetail);
    expect(harness.elements.get("detail-body")?.innerHTML).not.toContain("Late release");
    expect(harness.elements.get("toast")?.textContent).toBe("");
  });

  it("always shows Transcript and bases No flagged reasons only on positive enrichment reasons", async () => {
    const harness = createDashboardHarness();
    await harness.settle();

    await harness.evaluate(`
      state.audit = {
        total: 2,
        evidence: { repo: 1, docs: 0, transcript: 0 },
        needsEnrichment: 0,
        enrichmentReasons: {},
      };
      renderBatchHealth();
    `);
    expect(harness.elements.get("audit-mobile-details")?.innerHTML).toContain("Transcript: 0");
    expect(harness.elements.get("audit-mobile-details")?.innerHTML).toContain("No flagged reasons");

    await harness.evaluate(`
      state.audit = {
        total: 2,
        evidence: { repo: 1, docs: 0, transcript: 2 },
        needsEnrichment: 1,
        enrichmentReasons: { weak_quality: 1, missing_repo_or_docs: 0 },
      };
      renderBatchHealth();
    `);
    const flaggedDetails = harness.elements.get("audit-mobile-details")?.innerHTML;
    expect(flaggedDetails).toContain("Transcript: 2");
    expect(flaggedDetails).toContain("Weak quality: 1");
    expect(flaggedDetails).not.toContain("Missing links");
    expect(flaggedDetails).not.toContain("No flagged reasons");
  });
});
