# Dashboard Mobile Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reclaim mobile list space, keep every dashboard filter reachable, remove duplicate reason chips, and make mobile drill-in obey browser history without changing triage or desktop behavior.

**Architecture:** Keep the server-rendered single-file dashboard and existing APIs. Add two small exported pure helpers for testable reason normalization, then enhance the inline dashboard markup/CSS/state with mobile-only progressive disclosure and application-owned History API entries. Preserve the desktop split explorer and use the existing Vitest HTML-contract style plus real-browser verification for layout and navigation behavior.

**Tech Stack:** TypeScript, Fastify server-rendered HTML, browser DOM/History APIs, Vitest, Playwright CLI

## Global Constraints

- Keep the change inside `src/dashboard.ts` and `test/dashboard.test.ts`; introduce no runtime dependency or frontend framework.
- Preserve finding files, API contracts, audit calculations, authentication, private-field boundaries, quality scores, triage retryability, enrichment decisions, and recommendations.
- Preserve the desktop split explorer and keep desktop selection out of browser history.
- At widths up to 980px, keep `All`, `Strong`, `Review`, and `Weak` immediately visible; put every other permitted filter behind `More`.
- At 390 × 844 with disclosures closed, the first finding must begin at or above y=325px.
- Do not add finding deep links or alter the current URL/query string; never expose auth tokens.
- Browser Back from the first mobile finding or release-notes view must restore list filter, query, selection, and scroll instead of leaving the dashboard.
- Use test-first changes and commit each task separately.

## File map

- `src/dashboard.ts`: exported reason helpers; dashboard HTML, responsive CSS, progressive disclosure rendering, and mobile History API state.
- `test/dashboard.test.ts`: direct unit tests for reason helpers and HTML-contract assertions for filters, batch health, and history hooks.
- `docs/superpowers/specs/2026-07-20-dashboard-mobile-polish-design.md`: approved requirements; do not alter unless implementation exposes a contradiction.

---

### Task 1: Normalize duplicate reason chips

**Files:**
- Modify: `src/dashboard.ts:1-5,909-943`
- Modify: `test/dashboard.test.ts:1-4,147-162`

**Interfaces:**
- Produces: `dashboardReasonKey(reason: string): string`
- Produces: `dedupeDashboardReasons(reasons: string[]): string[]`
- Consumes: the existing ordered reason array built by `prioritizedQualityReasons(f)`

- [ ] **Step 1: Write direct failing unit tests for semantic reason equality**

Update the import and add a focused describe block:

```ts
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
```

- [ ] **Step 2: Run the focused tests and confirm the helpers are missing**

Run:

```bash
npm test -- --run test/dashboard.test.ts
```

Expected: FAIL because `dashboardReasonKey` and `dedupeDashboardReasons` are not exported.

- [ ] **Step 3: Implement the pure helpers and embed them in the dashboard script**

Add before `DASHBOARD_HTML`:

```ts
export function dashboardReasonKey(reason: string): string {
  return reason.trim().replace(/^triage\s+/i, "").toLowerCase();
}

export function dedupeDashboardReasons(reasons: string[]): string[] {
  const seen = new Set<string>();
  return reasons.filter((reason) => {
    const key = dashboardReasonKey(reason);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
```

Embed both definitions near the start of the inline script so the browser uses the same source:

```ts
const dashboardReasonKey = ${dashboardReasonKey.toString()};
const dedupeDashboardReasons = ${dedupeDashboardReasons.toString()};
```

Change the end of `prioritizedQualityReasons(f)` to preserve priority and the existing cap:

```js
return dedupeDashboardReasons(chips.filter(Boolean)).slice(0, 3);
```

- [ ] **Step 4: Run focused tests and inspect the generated HTML**

Run:

```bash
npm test -- --run test/dashboard.test.ts
git diff --check
```

Expected: all dashboard tests pass; the generated HTML still contains `qualityReasonChips(f)` and now contains both embedded helper names.

- [ ] **Step 5: Commit the independently testable reason change**

```bash
git add src/dashboard.ts test/dashboard.test.ts
git commit -m "fix: dedupe dashboard reason chips"
```

---

### Task 2: Add compact mobile filters and mode status

**Files:**
- Modify: `src/dashboard.ts:195-233,647-690,804-824,830-853,1000-1105,1475-1496`
- Modify: `test/dashboard.test.ts:5-18,115-139`

**Interfaces:**
- Produces: `setSecondaryFiltersOpen(open: boolean): void`
- Produces: `syncFilterControls(): void`
- Consumes: existing `state.filter`, `state.filterCounts`, `state.privateUnlocked`, `resetFilterToAll()`, and `renderList()`

- [ ] **Step 1: Add failing HTML-contract tests for primary and secondary controls**

Add assertions that require the new structure and mobile rules:

```ts
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
```

- [ ] **Step 2: Run the focused test and verify the new hooks are absent**

```bash
npm test -- --run test/dashboard.test.ts
```

Expected: FAIL on `primary-filters`, `more-filters`, `secondary-filters`, and compact mode-copy assertions.

- [ ] **Step 3: Group the existing filter buttons without changing their data-filter values**

Replace the flat filter markup with this structure:

```html
<div class="filters" aria-label="Filter findings">
  <div class="primary-filters">
    <button class="filter primary-filter active" data-filter="all">All <span data-count-for="all">0</span></button>
    <button class="filter primary-filter" data-filter="strong">Strong <span data-count-for="strong">0</span></button>
    <button class="filter primary-filter" data-filter="review">Review <span data-count-for="review">0</span></button>
    <button class="filter primary-filter" data-filter="weak">Weak <span data-count-for="weak">0</span></button>
  </div>
  <button id="more-filters" class="filter more-filter" type="button" aria-expanded="false" aria-controls="secondary-filters">More</button>
  <div id="secondary-filters" class="secondary-filters" aria-hidden="false">
    <button class="filter secondary-filter" data-filter="repo">Repo/docs <span data-count-for="repo">0</span></button>
    <button class="filter secondary-filter" data-filter="enrich">Needs enrichment <span data-count-for="enrich">0</span></button>
    <button class="filter secondary-filter" data-filter="ocr">OCR <span data-count-for="ocr">0</span></button>
    <button class="filter secondary-filter private-only-filter" data-filter="project">Project fit <span data-count-for="project">0</span></button>
    <button class="filter secondary-filter private-only-filter" data-filter="skip">Skip <span data-count-for="skip">0</span></button>
  </div>
</div>
```

Replace the mode note with separate copy spans:

```html
<div id="mode-note" class="mode-note">
  <span id="mode-note-wide">Public research is open. Unlock Sid view only when you want project fit and next actions.</span>
  <span id="mode-note-compact" class="mode-note-compact">Public view · Unlock for project fit</span>
</div>
```

- [ ] **Step 4: Implement desktop-transparent wrappers and the fixed mobile control grid**

Add desktop defaults:

```css
.primary-filters,
.secondary-filters { display: contents; }
.more-filter,
.mode-note-compact { display: none; }
```

Replace the mobile horizontal rail rules with:

```css
.mode-note {
  padding: 6px 12px;
  line-height: 1.25;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mode-note-wide { display: none; }
.mode-note-compact { display: inline; }
.filters {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 6px;
  min-height: 44px;
  padding: 8px 12px;
  overflow: visible;
}
.primary-filters {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 4px;
  min-width: 0;
}
.primary-filter {
  width: 100%;
  min-width: 0;
  padding-inline: 5px;
}
.primary-filter [data-count-for] { display: none; }
.more-filter { display: inline-flex; }
.secondary-filters {
  grid-column: 1 / -1;
  display: none;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
  padding-top: 2px;
}
.secondary-filters.open { display: grid; }
.secondary-filter { width: 100%; }
```

- [ ] **Step 5: Add disclosure state and synchronize active/accessible state**

Extend dashboard state with `secondaryFiltersOpen: false`, then add:

```js
const secondaryFilters = new Set(["repo", "enrich", "ocr", "project", "skip"]);

function setSecondaryFiltersOpen(open) {
  state.secondaryFiltersOpen = Boolean(open);
  const tray = $("secondary-filters");
  const button = $("more-filters");
  const mobile = isMobileViewport();
  tray.classList.toggle("open", mobile && state.secondaryFiltersOpen);
  tray.setAttribute("aria-hidden", String(mobile && !state.secondaryFiltersOpen));
  button.setAttribute("aria-expanded", String(state.secondaryFiltersOpen));
  syncFilterControls();
}

function syncFilterControls() {
  document.querySelectorAll(".filter[data-filter]").forEach((button) => {
    button.classList.toggle("active", button.dataset.filter === state.filter);
  });
  const secondaryActive = secondaryFilters.has(state.filter);
  const more = $("more-filters");
  more.classList.toggle("active", secondaryActive);
  more.setAttribute("aria-label", secondaryActive ? "More filters, " + filterLabel() + " active" : "More filters");
}
```

Make `resetFilterToAll()` call `syncFilterControls()` instead of manually toggling classes. In `updateStats()`, set both mode spans and call `syncFilterControls()` after disabled-state handling:

```js
$("mode-note-wide").textContent = state.privateUnlocked
  ? "Sid view is unlocked. Project fit and next action are shown inside each finding."
  : "Public research is open. Unlock Sid view only when you want project fit and next actions.";
$("mode-note-compact").textContent = state.privateUnlocked
  ? "Sid view · Project fit visible"
  : "Public view · Unlock for project fit";
```

Add the More handler and close the tray after any filter selection:

```js
$("more-filters").addEventListener("click", () => setSecondaryFiltersOpen(!state.secondaryFiltersOpen));
setSecondaryFiltersOpen(false);

document.querySelectorAll(".filter[data-filter]").forEach((button) => button.addEventListener("click", () => {
  if (button.disabled) return;
  state.filter = button.dataset.filter || "all";
  setSecondaryFiltersOpen(false);
  const previousId = state.selectedId;
  setMobileDetailOpen(false);
  renderList();
  if (state.selectedId && state.selectedId !== previousId) selectFinding(state.selectedId);
}));
```

- [ ] **Step 6: Run focused tests and verify no old horizontal filter rail remains**

```bash
npm test -- --run test/dashboard.test.ts
rg -n "filters::-webkit-scrollbar|\.filters.*overflow-x" src/dashboard.ts
git diff --check
```

Expected: dashboard tests pass; `rg` finds no hidden-scrollbar or horizontal-overflow rule for `.filters`.

Also call `setSecondaryFiltersOpen(isMobileViewport() ? state.secondaryFiltersOpen : false)` from the existing resize handler so the desktop wrapper always returns to `aria-hidden="false"`.

- [ ] **Step 7: Commit compact filters and mode status**

```bash
git add src/dashboard.ts test/dashboard.test.ts
git commit -m "feat: compact mobile dashboard filters"
```

---

### Task 3: Collapse batch health on mobile

**Files:**
- Modify: `src/dashboard.ts:174-194,663-673,809,1046-1092`
- Modify: `test/dashboard.test.ts:5-18,61-77`

**Interfaces:**
- Produces: `renderBatchHealth(): void`
- Consumes: `state.audit`, `reasonCountLabels`, `escapeHtml(value)`, and existing audit/filter data only

- [ ] **Step 1: Add failing tests for separate desktop and mobile batch-health presentations**

```ts
it("renders compact expandable mobile batch health without changing desktop data", () => {
  const html = DASHBOARD_HTML([]);

  expect(html).toContain('class="batch-health-region"');
  expect(html).toContain('id="batch-health" class="batch-health"');
  expect(html).toContain('id="batch-health-mobile" class="batch-health-mobile"');
  expect(html).toContain('id="batch-health-summary"');
  expect(html).toContain('id="batch-health-details"');
  expect(html).toContain("function renderBatchHealth()");
  expect(html).toContain('value > 0');
  expect(html).toContain("No flagged reasons");
});
```

- [ ] **Step 2: Run the focused test and confirm the disclosure hooks are absent**

```bash
npm test -- --run test/dashboard.test.ts
```

Expected: FAIL on `batch-health-region`, `batch-health-mobile`, and `renderBatchHealth`.

- [ ] **Step 3: Replace the single batch container with one grid-row wrapper**

```html
<div class="batch-health-region">
  <div id="batch-health" class="batch-health" aria-label="Latest batch health"></div>
  <details id="batch-health-mobile" class="batch-health-mobile">
    <summary id="batch-health-summary">Latest batch health</summary>
    <div id="batch-health-details" class="batch-health-details"></div>
  </details>
</div>
```

- [ ] **Step 4: Add desktop/mobile display rules without introducing an extra queue row**

```css
.batch-health-region { min-width: 0; }
.batch-health-mobile { display: none; }
```

Inside the mobile media query, replace the old scroll rail with:

```css
.batch-health { display: none; }
.batch-health-mobile {
  display: block;
  border-bottom: 1px solid #edf1ec;
  background: #fbfcf8;
  color: #314138;
  font-size: 11px;
}
.batch-health-mobile summary {
  min-height: 34px;
  padding: 9px 12px;
  font-weight: 850;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.batch-health-details {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
  padding: 0 12px 9px;
}
```

- [ ] **Step 5: Render the unchanged desktop chips and concise mobile disclosure from the same audit payload**

Move the existing batch rendering out of `updateStats()` into:

```js
function renderBatchHealth() {
  const audit = state.audit;
  const enrichmentReasons = audit?.enrichmentReasons || {};
  if (!audit) {
    $("batch-health").innerHTML = "";
    $("batch-health-summary").textContent = "Latest batch health unavailable";
    $("batch-health-details").innerHTML = '<div class="health-chip">No audit data</div>';
    return;
  }

  const repoDocs = (audit.evidence?.repo ?? 0) + (audit.evidence?.docs ?? 0);
  const desktopEntries = [
    ["Latest", audit.total ?? 0],
    ["Repo/docs", repoDocs],
    ["Transcript", audit.evidence?.transcript ?? 0],
    ["Enrich", audit.needsEnrichment ?? 0],
    ...reasonCountLabels.map(([key, label]) => [label, enrichmentReasons[key] ?? 0]),
  ];
  $("batch-health").innerHTML = desktopEntries
    .map(([label, value]) => '<div class="health-chip">' + escapeHtml(label) + ": " + escapeHtml(value) + "</div>")
    .join("");
  $("batch-health-summary").textContent = "Latest " + (audit.total ?? 0) + " · Repo/docs " + repoDocs + " · Enrich " + (audit.needsEnrichment ?? 0);

  const mobileEntries = [
    ["Transcript", audit.evidence?.transcript ?? 0],
    ...reasonCountLabels.map(([key, label]) => [label, enrichmentReasons[key] ?? 0]),
  ].filter(([, value]) => value > 0);
  $("batch-health-details").innerHTML = mobileEntries.length
    ? mobileEntries.map(([label, value]) => '<div class="health-chip">' + escapeHtml(label) + ": " + escapeHtml(value) + "</div>").join("")
    : '<div class="health-chip">No flagged reasons</div>';
}
```

Call `renderBatchHealth()` once from `updateStats()` and remove the old inline rendering block.

- [ ] **Step 6: Run focused tests and confirm the mobile rail is gone**

```bash
npm test -- --run test/dashboard.test.ts
rg -n "batch-health.*overflow-x|repeat\(4, max-content\)" src/dashboard.ts
git diff --check
```

Expected: dashboard tests pass; `rg` finds no mobile horizontal batch-health rail.

- [ ] **Step 7: Commit the mobile health disclosure**

```bash
git add src/dashboard.ts test/dashboard.test.ts
git commit -m "feat: collapse mobile batch health"
```

---

### Task 4: Add history-backed mobile drill-in and restoration

**Files:**
- Modify: `src/dashboard.ts:830-850,1250-1275,1286-1373,1413-1469,1497-1542`
- Modify: `test/dashboard.test.ts:20-58,99-146`

**Interfaces:**
- Produces: `mobileHistorySnapshot(overrides?: object): object`
- Produces: `ensureMobileHistoryRoot(): void`
- Produces: `pushMobileView(view: "finding" | "release-notes", findingId?: string | null): void`
- Produces: `closeMobileView(): void`
- Produces: `restoreMobileListFallback(message: string): void`
- Produces: `restoreMobileHistory(entry: object): Promise<void>`
- Extends: `selectFinding(id, { openDetail?, historyMode? })` where `historyMode` is `"push" | "restore" | "none"`
- Extends: `loadReleaseNotes({ historyMode? })` with the same modes

- [ ] **Step 1: Replace old release-note string assertions with failing history-contract assertions**

Add focused assertions:

```ts
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
  expect(html).toContain("scrollTop: $(\"finding-list\").scrollTop");
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
```

- [ ] **Step 2: Run the focused tests and verify history hooks are absent**

```bash
npm test -- --run test/dashboard.test.ts
```

Expected: FAIL for all new history functions and handlers.

- [ ] **Step 3: Add application-owned state snapshots and root initialization**

Add after `isMobileViewport()`:

```js
const mobileHistoryMarker = "tech-radar-dashboard";

function mobileHistorySnapshot(overrides = {}) {
  return {
    marker: mobileHistoryMarker,
    view: state.view,
    findingId: state.selectedId,
    selectedId: state.selectedId,
    filter: state.filter,
    query: state.query,
    scrollTop: $("finding-list").scrollTop,
    ...overrides,
  };
}

function ensureMobileHistoryRoot() {
  if (!isMobileViewport()) return;
  if (history.state?.marker === mobileHistoryMarker) return;
  history.replaceState(mobileHistorySnapshot({ view: "findings" }), "", location.href);
}

function pushMobileView(view, findingId = null) {
  if (!isMobileViewport()) return;
  ensureMobileHistoryRoot();
  history.replaceState(mobileHistorySnapshot({ view: history.state?.view || "findings" }), "", location.href);
  const nextEntry = mobileHistorySnapshot({ view, findingId, scrollTop: 0 });
  history.pushState(nextEntry, "", location.href);
}
```

- [ ] **Step 4: Centralize in-page back behavior and list restoration**

```js
function closeMobileView() {
  if (isMobileViewport() && history.state?.marker === mobileHistoryMarker && history.state.view !== "findings") {
    history.back();
    return;
  }
  state.view = "findings";
  setMobileDetailOpen(false);
  renderDetail();
}

function restoreMobileListFallback(message) {
  state.view = "findings";
  state.detail = null;
  state.selectedId = visibleFindings()[0]?.id || null;
  setMobileDetailOpen(false);
  history.replaceState(mobileHistorySnapshot({ view: "findings" }), "", location.href);
  renderList();
  renderDetail();
  showToast(message);
}

async function restoreMobileHistory(entry) {
  if (!entry || entry.marker !== mobileHistoryMarker) return;
  state.filter = entry.filter || "all";
  state.query = entry.query || "";
  state.selectedId = entry.selectedId || null;
  $("search").value = state.query;
  syncFilterControls();

  if (entry.view === "release-notes") {
    await loadReleaseNotes({ historyMode: "restore" });
    return;
  }
  if (entry.view === "finding" && entry.findingId) {
    if (!state.findings.some((finding) => finding.id === entry.findingId)) {
      restoreMobileListFallback("Finding is no longer available.");
      return;
    }
    state.view = "findings";
    await selectFinding(entry.findingId, { openDetail: true, historyMode: "restore" });
    return;
  }

  state.view = "findings";
  setMobileDetailOpen(false);
  renderList();
  renderDetail();
  const list = $("finding-list");
  requestAnimationFrame(() => {
    list.scrollTop = entry.scrollTop || 0;
  });
}
```

Wire both detail back controls to `closeMobileView()` instead of directly mutating state.

- [ ] **Step 5: Push history only for user-initiated mobile drill-in**

At the start of `selectFinding`:

```js
async function selectFinding(id, options = {}) {
  const historyMode = options.historyMode || "none";
  if (options.openDetail && isMobileViewport() && historyMode === "push") {
    pushMobileView("finding", id);
  }
  state.view = "findings";
  state.selectedId = id;
  if (options.openDetail && isMobileViewport()) setMobileDetailOpen(true);
```

After the detail request returns and the request-id guards pass, make restore failures return to the list instead of leaving an optimistic or empty detail visible:

```js
if (detail) {
  state.detail = detail;
  renderDetail();
  prefetchNextFindings();
  return true;
}
if (historyMode === "restore") {
  restoreMobileListFallback("Could not restore finding.");
}
return false;
```

Change list and workflow listeners to pass `historyMode: "push"`. Change release notes to accept options:

```js
async function loadReleaseNotes(options = {}) {
  const historyMode = options.historyMode || "none";
  if (isMobileViewport() && historyMode === "push") pushMobileView("release-notes");
  state.view = "release-notes";
  if (isMobileViewport()) setMobileDetailOpen(true);
```

Use `loadReleaseNotes({ historyMode: "push" })` for the top action, `loadReleaseNotes({ historyMode: "none" })` for Refresh, and `historyMode: "restore"` from `restoreMobileHistory`.

- [ ] **Step 6: Register popstate and initialize only on mobile**

Add near the resize handler:

```js
window.addEventListener("popstate", (event) => {
  void restoreMobileHistory(event.state);
});

ensureMobileHistoryRoot();
```

On resize into desktop, keep the existing pane reset and do not push or replace history. `pushMobileView()` will establish a root later if a user returns to mobile and drills in.

- [ ] **Step 7: Run focused tests and inspect auth/URL invariants**

```bash
npm test -- --run test/dashboard.test.ts
rg -n "pushState|replaceState" src/dashboard.ts
rg -n "token.*pushState|pushState.*token|#finding|#release" src/dashboard.ts
git diff --check
```

Expected: dashboard tests pass; every history write uses `location.href`; the auth/deep-link scan returns no matches.

- [ ] **Step 8: Commit mobile history behavior**

```bash
git add src/dashboard.ts test/dashboard.test.ts
git commit -m "fix: restore mobile dashboard history"
```

---

### Task 5: Verify the complete mobile/desktop experience and open the PR

**Files:**
- Modify only if verification finds a defect: `src/dashboard.ts`, `test/dashboard.test.ts`
- Reference: `docs/superpowers/specs/2026-07-20-dashboard-mobile-polish-design.md`

**Interfaces:**
- Consumes: all prior task behavior
- Produces: a verified branch and one narrow dashboard-mobile PR with evidence

- [ ] **Step 1: Run the complete local verification suite**

```bash
npm test -- --no-file-parallelism
npm run build
npm audit --omit=dev
git diff --check
git status --short --branch
```

Expected: all tests and TypeScript build pass; audit result is recorded and does not introduce a dependency diff; only the design, plan, dashboard, and dashboard-test files differ from `origin/main`.

- [ ] **Step 2: Start the local production build on a non-AirPlay port**

```bash
PORT=3101 \
NODE_ENV=development \
AUTH_TOKEN=local-mobile-smoke \
AI_MEMORY_LOCAL_DIR=/Users/work/Repositories/ai-memory \
npm start
```

Expected: Fastify listens on `http://127.0.0.1:3101` and reads the local Tech Radar findings without mutating them.

- [ ] **Step 3: Run the public browser matrix with Playwright CLI**

Use `/Users/work/.codex/skills/playwright/scripts/playwright_cli.sh` against `http://127.0.0.1:3101` at 320 × 568, 390 × 844, 430 × 932, 980 × 900, and 1280 × 900. At each mobile width verify:

```text
list → primary filter → More → secondary filter → search → empty result
list → finding → browser Back → browser Forward → in-page Findings
list → release notes → browser Back → Back to findings
finding → workflow child → browser Back → parent → browser Back → list
```

Capture measurements with browser evaluation:

```js
({
  firstItemY: document.querySelector(".item")?.getBoundingClientRect().y,
  bodyOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  filtersOverflow: document.querySelector(".filters")?.scrollWidth - document.querySelector(".filters")?.clientWidth,
  batchOverflow: document.querySelector(".batch-health-region")?.scrollWidth - document.querySelector(".batch-health-region")?.clientWidth,
})
```

Expected at 390 × 844 with disclosures closed: `firstItemY <= 325`, and all three overflow values are `0`.

- [ ] **Step 4: Verify Sid view and safe prompts**

Set an HttpOnly `auth_token=local-mobile-smoke` cookie through the Playwright context, then verify:

```text
Sid list → More → Project fit → detail → browser Back
Sid list → More → Skip → empty/non-empty state
Add URL → prompt appears → dismiss without submitting
```

Expected: private filters appear only in Sid view, private detail fields render, the prompt dismisses without a POST, and browser console has zero errors/warnings.

- [ ] **Step 5: Verify desktop preservation**

At 1280 × 900 verify all permitted filters remain visible, the split queue/detail explorer stays present, selecting several findings does not add history entries, release notes render, and no control overlaps or horizontal page overflow occurs.

- [ ] **Step 6: Fix only verified regressions test-first, then repeat affected checks**

For each observed defect, first add one failing assertion to `test/dashboard.test.ts`, run it to confirm failure, make the smallest `src/dashboard.ts` correction, rerun the focused test, then repeat the affected Playwright path. Do not weaken the y=325 or zero-overflow acceptance criteria.

- [ ] **Step 7: Commit any verification-driven correction**

If Step 6 changed files:

```bash
git add src/dashboard.ts test/dashboard.test.ts
git commit -m "fix: close mobile dashboard verification gaps"
```

If Step 6 changed nothing, do not create an empty commit.

- [ ] **Step 8: Push and open one clean draft PR with exact evidence**

```bash
git push -u origin codex/dashboard-mobile-polish
gh pr create --draft \
  --base main \
  --head codex/dashboard-mobile-polish \
  --title "Polish Tech Radar mobile triage"
```

Provide the body non-interactively during execution. It must summarize the four shipped behaviors, state the exact focused and full Vitest counts printed in Step 1, state the exact audit result and that package files are unchanged, list all five verified viewports, report the measured 390×844 first-finding y value, report page/filter/batch overflow in pixels, enumerate the public and Sid interaction paths that passed, and state the observed console error/warning counts. Do not create the PR until every value is known from Steps 1–5.

---

## Plan self-review record

- Spec coverage: compact filters, concise mode status, expandable batch health, reason deduplication, history restoration, failure fallback, desktop preservation, auth boundaries, viewport matrix, and y/overflow acceptance criteria are each assigned to a task.
- Placeholder scan: the plan contains no TBD fields or deferred implementation details; runtime verification values are required to come directly from the named commands before PR creation.
- Type consistency: `dashboardReasonKey`, `dedupeDashboardReasons`, `setSecondaryFiltersOpen`, `syncFilterControls`, `mobileHistorySnapshot`, `pushMobileView`, `closeMobileView`, `restoreMobileListFallback`, and `restoreMobileHistory` use the same names and roles across all tasks.
