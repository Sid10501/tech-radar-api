# Dashboard Finder Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the Tech Radar dashboard so desktop filtering and audit metrics no longer consume the left finding-list column.

**Architecture:** Keep the current server-rendered `DASHBOARD_HTML` architecture. Move existing filter markup into a new main-content toolbar, keep the mobile filter disclosure pattern, and render batch/audit metrics inside an `Audit` disclosure instead of as permanent desktop sidebar chrome.

**Tech Stack:** TypeScript, server-rendered HTML string, vanilla browser JavaScript, CSS media queries, Vitest.

## Global Constraints

- No API behavior, data model, enrichment, triage, or audit calculation changes.
- No new dependencies or frontend framework.
- Preserve mobile drill-in/history behavior.
- Preserve filter behavior and count updates for public and private modes.
- The left desktop column must become primarily a scrollable findings navigator.
- Detailed latest-batch health/reason counts must be hidden by default behind an explicit `Audit` disclosure/control.
- Browser verification must check desktop and mobile widths for no horizontal overflow and no console errors.

---

### Task 1: Finder Layout Tests

**Files:**
- Modify: `test/dashboard.test.ts`

**Interfaces:**
- Consumes: `DASHBOARD_HTML([]): string`
- Produces: failing tests that require finder toolbar, audit disclosure, and compact desktop sidebar hooks.

- [ ] **Step 1: Write failing tests for the desktop finder structure**

Add these tests in the `describe("dashboard HTML", ...)` block near the existing layout/filter tests:

```ts
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
```

- [ ] **Step 2: Update existing tests that intentionally described the old sidebar**

Change the old tests as follows:

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

  it("keeps the More disclosure hidden in the desktop toolbar", () => {
    const html = DASHBOARD_HTML([]);

    expect(html).toContain(".filter.more-filter { display: none; }");
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
    expect(html).toContain("No flagged reasons");
  });
```

- [ ] **Step 3: Run the focused test and verify it fails for the expected missing layout**

Run:

```bash
npm test -- test/dashboard.test.ts --no-file-parallelism --testTimeout=30000
```

Expected: FAIL because `detail-shell`, `filter-toolbar`, `audit-toggle`, `audit-panel`, and compact queue selectors do not exist yet.

- [ ] **Step 4: Commit only the failing tests**

Run:

```bash
git add test/dashboard.test.ts
git commit -m "test: specify dashboard finder layout"
```

---

### Task 2: Implement Finder Toolbar and Audit Disclosure

**Files:**
- Modify: `src/dashboard.ts`
- Test: `test/dashboard.test.ts`

**Interfaces:**
- Consumes: filter buttons with `data-filter`, count badges with `data-count-for`, `state.filter`, `state.filterCounts`, `state.audit`, `syncFilterControls()`, `setSecondaryFiltersOpen(open)`, `renderBatchHealth()`.
- Produces: `detail-shell`, `filter-toolbar`, `queue-filter-summary`, `audit-toggle`, `audit-panel`, `audit-metrics`, `audit-summary-mobile`, `audit-mobile-details`, and `setAuditPanelOpen(open)`.

- [ ] **Step 1: Replace permanent sidebar chrome with compact queue header**

In `src/dashboard.ts`, change `.queue` desktop grid rows from:

```css
grid-template-rows: auto auto auto auto minmax(0, 1fr);
```

to:

```css
grid-template-rows: auto minmax(0, 1fr);
```

Change the queue header markup from the current multi-section header, mode note, batch health region, and filters to:

```html
<aside class="queue">
  <div class="queue-head compact">
    <div class="queue-title"><span>Findings</span><span id="count" class="count">0 total</span></div>
    <div class="queue-status-line">
      <span id="mode-note-compact">Public view</span>
      <span aria-hidden="true">·</span>
      <span id="active-filter-label">All</span>
    </div>
    <div id="queue-filter-summary" class="queue-filter-summary" aria-label="Finding quality summary">
      <span><strong id="strong-count">0</strong> Strong</span>
      <span><strong id="review-count">0</strong> Review</span>
      <span><strong id="weak-count">0</strong> Weak</span>
    </div>
  </div>
  <div id="finding-list" class="list"></div>
</aside>
```

Remove the desktop `.mode-note`, `.batch-health-region`, and `.filters` markup from inside the queue.

- [ ] **Step 2: Add the main detail shell and filter toolbar markup**

Wrap the detail content with a shell:

```html
<main id="detail" class="content">
  <div class="detail-shell">
    <div id="filter-toolbar" class="filter-toolbar" aria-label="Filter findings">
      <div class="toolbar-filter-group primary-filters">
        <button class="filter primary-filter active" data-filter="all">All <span data-count-for="all">0</span></button>
        <button class="filter primary-filter" data-filter="strong">Strong <span data-count-for="strong">0</span></button>
        <button class="filter primary-filter" data-filter="review">Review <span data-count-for="review">0</span></button>
        <button class="filter primary-filter" data-filter="weak">Weak <span data-count-for="weak">0</span></button>
      </div>
      <button id="more-filters" class="filter more-filter" type="button" aria-expanded="false" aria-controls="secondary-filters">More</button>
      <div id="secondary-filters" class="toolbar-filter-group secondary-filters" aria-hidden="false">
        <button class="filter secondary-filter" data-filter="enrich">Needs enrichment <span data-count-for="enrich">0</span></button>
        <button class="filter secondary-filter" data-filter="repo">Repo/docs <span data-count-for="repo">0</span></button>
        <button class="filter secondary-filter" data-filter="ocr">OCR <span data-count-for="ocr">0</span></button>
        <button class="filter secondary-filter private-only-filter" data-filter="project">Project fit <span data-count-for="project">0</span></button>
        <button class="filter secondary-filter private-only-filter" data-filter="skip">Skip <span data-count-for="skip">0</span></button>
      </div>
      <button id="audit-toggle" class="filter audit-toggle" type="button" aria-expanded="false" aria-controls="audit-panel">Audit</button>
    </div>
    <section id="audit-panel" class="audit-panel" hidden>
      <div id="audit-summary-mobile" class="audit-summary-mobile">Latest batch health unavailable</div>
      <div id="audit-metrics" class="audit-metrics" aria-label="Latest batch health"></div>
      <div id="audit-mobile-details" class="audit-mobile-details"></div>
    </section>
    <div id="detail-body"></div>
  </div>
</main>
```

Update every function that writes to `$("detail")` so it writes to `$("detail-body")` instead. The functions to inspect include `renderDetail()`, `renderReleaseNotes()`, and empty/loading states.

- [ ] **Step 3: Add CSS for the finder toolbar and audit panel**

Add desktop CSS:

```css
.queue-head.compact {
  padding: 14px 16px 12px;
}
.queue-status-line {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--muted);
  font-size: 12px;
  font-weight: 760;
  min-width: 0;
}
.queue-filter-summary {
  display: flex;
  gap: 10px;
  margin-top: 9px;
  color: var(--muted);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.queue-filter-summary strong {
  color: var(--ink);
  font-size: 13px;
}
.detail-shell {
  min-height: 100%;
}
.filter-toolbar {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  align-items: center;
  padding: 12px 24px;
  border-bottom: 1px solid var(--line);
  background: rgba(238, 242, 236, .94);
}
.toolbar-filter-group {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  min-width: 0;
}
.audit-toggle {
  margin-left: auto;
}
.audit-panel {
  margin: 12px 24px 0;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
  box-shadow: var(--shadow);
}
.audit-metrics {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 6px;
  padding: 12px;
}
.audit-summary-mobile,
.audit-mobile-details {
  display: none;
}
```

Reduce `.detail` top padding from `24px` to `14px 24px 24px` or equivalent so the selected finding starts higher.

- [ ] **Step 4: Preserve mobile layout with toolbar controls inside the queue**

Inside the existing `@media (max-width: 980px)` block:

```css
.queue {
  grid-template-rows: auto auto minmax(0, 1fr);
}
.content {
  display: none;
}
.detail-shell {
  min-height: 100%;
}
.filter-toolbar {
  position: static;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 6px;
  min-height: 44px;
  padding: 8px 12px;
  border-bottom: 1px solid #edf1ec;
  background: #fbfcf8;
}
.mobile-detail-open .filter-toolbar,
.mobile-detail-open .audit-panel {
  display: none;
}
.primary-filters {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 4px;
}
.audit-toggle {
  margin-left: 0;
}
.audit-panel {
  margin: 0;
  border-width: 0 0 1px;
  border-radius: 0;
  box-shadow: none;
}
.audit-panel[hidden] {
  display: none;
}
.audit-summary-mobile {
  display: block;
  min-height: 34px;
  padding: 9px 12px;
  color: #314138;
  font-size: 11px;
  font-weight: 850;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.audit-metrics {
  display: none;
}
.audit-mobile-details {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
  padding: 0 12px 9px;
}
```

Move the `filter-toolbar` and `audit-panel` into the mobile visible area by CSS grid ordering if needed:

```css
.filter-toolbar,
.audit-panel {
  grid-column: 1;
}
```

Keep `more-filters`, `secondary-filters`, `setSecondaryFiltersOpen(open)`, and mobile history behavior intact.

- [ ] **Step 5: Update audit rendering and filter summary JavaScript**

Change `renderBatchHealth()` so it writes desktop metrics to `audit-metrics`, mobile summary to `audit-summary-mobile`, and mobile detail chips to `audit-mobile-details`.

Add:

```js
function setAuditPanelOpen(open) {
  const panel = $("audit-panel");
  const button = $("audit-toggle");
  panel.hidden = !open;
  button.setAttribute("aria-expanded", String(open));
}
```

In `updateStats()`, after setting mode copy, update:

```js
$("active-filter-label").textContent = filterLabel();
$("mode-note-compact").textContent = state.privateUnlocked ? "Sid view" : "Public view";
```

At event setup, add:

```js
$("audit-toggle").addEventListener("click", () => setAuditPanelOpen($("audit-panel").hidden));
setAuditPanelOpen(false);
```

- [ ] **Step 6: Run the focused dashboard tests**

Run:

```bash
npm test -- test/dashboard.test.ts --no-file-parallelism --testTimeout=30000
```

Expected: PASS.

- [ ] **Step 7: Commit the implementation**

Run:

```bash
git add src/dashboard.ts test/dashboard.test.ts
git commit -m "feat: add dashboard finder layout"
```

---

### Task 3: Browser Polish and Full Verification

**Files:**
- Modify if needed: `src/dashboard.ts`
- Test: browser smoke via Playwright CLI

**Interfaces:**
- Consumes: local built server at `http://127.0.0.1:<port>/`.
- Produces: verified desktop and mobile dashboard with no horizontal overflow and no console errors.

- [ ] **Step 1: Build the app**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 2: Start a local production server**

Run:

```bash
PORT=3031 AI_MEMORY_LOCAL_DIR=/Users/work/Repositories/ai-memory npm start
```

Keep this process running until browser smoke finishes.

- [ ] **Step 3: Smoke desktop in a browser**

Use the Playwright CLI wrapper:

```bash
PLAYWRIGHT_CLI_SESSION=tech-radar-finder /Users/work/.codex/skills/playwright/scripts/playwright_cli.sh open http://127.0.0.1:3031/
PLAYWRIGHT_CLI_SESSION=tech-radar-finder /Users/work/.codex/skills/playwright/scripts/playwright_cli.sh resize 1440 900
PLAYWRIGHT_CLI_SESSION=tech-radar-finder /Users/work/.codex/skills/playwright/scripts/playwright_cli.sh snapshot
PLAYWRIGHT_CLI_SESSION=tech-radar-finder /Users/work/.codex/skills/playwright/scripts/playwright_cli.sh eval '() => ({ overflow: document.body.scrollWidth > window.innerWidth + 1, hasToolbar: !!document.querySelector("#filter-toolbar"), hasAudit: !!document.querySelector("#audit-toggle"), listTop: document.querySelector("#finding-list")?.getBoundingClientRect().top, firstItemTop: document.querySelector(".item")?.getBoundingClientRect().top })'
PLAYWRIGHT_CLI_SESSION=tech-radar-finder /Users/work/.codex/skills/playwright/scripts/playwright_cli.sh console error
```

Expected: toolbar and audit exist, `overflow` is false, first finding starts materially higher than the old layout, and console errors are zero.

- [ ] **Step 4: Smoke mobile in a browser**

Run:

```bash
PLAYWRIGHT_CLI_SESSION=tech-radar-finder /Users/work/.codex/skills/playwright/scripts/playwright_cli.sh resize 390 844
PLAYWRIGHT_CLI_SESSION=tech-radar-finder /Users/work/.codex/skills/playwright/scripts/playwright_cli.sh snapshot
PLAYWRIGHT_CLI_SESSION=tech-radar-finder /Users/work/.codex/skills/playwright/scripts/playwright_cli.sh eval '() => ({ overflow: document.body.scrollWidth > window.innerWidth + 1, hasMore: !!document.querySelector("#more-filters"), hasAudit: !!document.querySelector("#audit-toggle"), hasList: !!document.querySelector("#finding-list .item") })'
PLAYWRIGHT_CLI_SESSION=tech-radar-finder /Users/work/.codex/skills/playwright/scripts/playwright_cli.sh console error
```

Expected: `overflow` is false, More filters exists, Audit exists, findings list exists, and console errors are zero.

- [ ] **Step 5: Run the full verification suite**

Run:

```bash
npm test
npm run build
git diff --check
```

Expected: all pass.

- [ ] **Step 6: Commit polish fixes if any were needed**

If Step 3 or Step 4 required CSS/JS changes, run:

```bash
git add src/dashboard.ts test/dashboard.test.ts
git commit -m "fix: polish dashboard finder layout"
```

Skip this commit if no changes were needed.
