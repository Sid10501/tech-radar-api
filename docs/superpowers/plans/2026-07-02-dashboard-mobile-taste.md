# Dashboard Mobile Taste Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Tech Radar dashboard feel like a polished mobile triage workbench while preserving the current desktop split explorer, public/private boundary, and single-file dashboard architecture.

**Architecture:** Keep `src/dashboard.ts` as the server-rendered HTML/CSS/JS shell. On desktop, preserve the two-pane split explorer. On phones, switch to a master-detail drill-in: the default view is the findings queue, tapping a row opens a full-screen detail view with a compact back control, and filters/search return the user to the list.

**Tech Stack:** Node.js 20, TypeScript, Fastify, Vitest, current inline dashboard in `src/dashboard.ts`, Playwright CLI for browser verification, Railway for deploy.

---

## Evidence From Planning Pass

- Live production audit on 2026-07-02:
  - Latest 15: `11 weak`, `3 review`, `1 strong`
  - Latest evidence gaps: `11` need enrichment, `7` missing transcript, `7` missing repo/docs
  - All public findings: `52` total, `37` weak, `11` review, `4` strong, `37` needs enrichment
- Real browser mobile check at `390x844` showed:
  - The queue and detail are stacked into one cramped mobile page.
  - The first viewport is mostly header, stat cards, copy, and filters.
  - `.list` can collapse to unusable height under the capped queue.
  - Detail starts below the queue, so row selection does not feel like a deliberate mobile navigation flow.
- Design direction:
  - Mobile should be list-first, detail-on-tap.
  - Filters should be a horizontal chip rail.
  - Mobile stats should be a compact operational strip.
  - Detail should have a sticky mobile back bar.
  - Desktop should remain the current split explorer.

---

## Execution Model

Use a fresh clean worktree from `origin/main`, not `/Users/work/Repositories/tech-radar-api`, because that checkout has unrelated YouTube/PDF intake edits.

Recommended branch:

```bash
cd /Users/work/Repositories/tech-radar-api
git fetch origin main
git worktree add /Users/work/Repositories/tech-radar-api-mobile-taste -b codex/dashboard-mobile-taste origin/main
cd /Users/work/Repositories/tech-radar-api-mobile-taste
npm install
npm test
```

Use subagents as follows:

- One implementer subagent per task because most changes touch `src/dashboard.ts`.
- After Task 4, dispatch parallel QA subagents:
  - Mobile browser QA at `390x844` and `430x932`
  - Desktop regression QA at `1440x900`
  - Public/private boundary QA against API and rendered UI

---

## File Map

| File | Purpose |
|------|---------|
| `src/dashboard.ts` | Single dashboard shell. Add mobile drill-in state, compact mobile layout, back control, and visual polish. |
| `test/dashboard.test.ts` | HTML/JS/CSS smoke tests for mobile hooks, no framework rewrite, public/private hooks, and desktop split hooks. |
| `test/server.test.ts` | Existing root dashboard smoke test. Extend only if root HTML contract changes. |
| `docs/superpowers/plans/2026-07-02-dashboard-mobile-taste.md` | This plan. |

---

## Task 1: Dashboard Shell Characterization

**Files:**
- Modify: `test/dashboard.test.ts`

Purpose: lock in the mobile hooks before changing layout. The test stays string-based because the dashboard is an HTML string and the repo does not currently have committed Playwright tests.

- [ ] **Step 1: Extend the dashboard shell test**

Replace `test/dashboard.test.ts` with:

```typescript
import { describe, expect, it } from "vitest";

import { DASHBOARD_HTML } from "../src/dashboard.js";

describe("dashboard HTML", () => {
  it("renders audit count hooks without tabs", () => {
    const html = DASHBOARD_HTML([]);

    expect(html).toContain('data-filter="enrich"');
    expect(html).toContain('data-filter="skip"');
    expect(html).toContain('data-count-for="repo"');
    expect(html).toContain("batch-health");
    expect(html).not.toContain('class="tabs"');
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
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
npm test -- test/dashboard.test.ts
```

Expected: fails because `mobile-back`, `mobile-detail-open`, `isMobileViewport`, `setMobileDetailOpen`, and `data-mobile-primary` do not exist yet.

- [ ] **Step 3: Commit the failing characterization test**

Do not commit a failing test by itself. Keep this as the red phase for Task 2.

---

## Task 2: Mobile Drill-In State And Back Control

**Files:**
- Modify: `src/dashboard.ts`
- Test: `test/dashboard.test.ts`

Purpose: make mobile navigation explicit. Desktop keeps auto-selected detail; mobile starts with the queue and only opens detail after a deliberate row tap.

- [ ] **Step 1: Add mobile state to the browser JS**

In the `state` object, add `mobileDetailOpen: false`:

```javascript
const state = { findings: [], selectedId: null, detail: null, query: "", filter: "all", privateUnlocked: false, requestSeq: 0, loading: true, detailCache: new Map(), audit: null, filterCounts: {}, mobileDetailOpen: false };
```

Add helpers after `requestHeaders()`:

```javascript
function isMobileViewport() {
  return window.matchMedia("(max-width: 980px)").matches;
}

function setMobileDetailOpen(open) {
  state.mobileDetailOpen = Boolean(open);
  $("dashboard-root").classList.toggle("mobile-detail-open", state.mobileDetailOpen);
}
```

- [ ] **Step 2: Add the mobile back bar to `renderDetail()`**

Inside the detail template, immediately after `<div class="detail">`, add:

```javascript
<div class="mobile-detail-bar">
  <button id="mobile-back" class="mobile-back" data-action="mobile-back">Findings</button>
  <div class="mobile-detail-context">
    <span>${escapeHtml(f.quality.level)} signal</span>
    <span>${escapeHtml(f.source.platform)}</span>
  </div>
</div>
```

Keep it inside the existing template string so it has access to `f`.

- [ ] **Step 3: Wire mobile back and row-open behavior**

Update the detail action listener in `renderDetail()`:

```javascript
detail.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => {
  if (button.dataset.action === "mobile-back") setMobileDetailOpen(false);
  if (button.dataset.action === "unlock") unlockPrivateView();
  if (button.dataset.action === "copy-next") {
    const text = nextTaskText(f);
    navigator.clipboard?.writeText(text).then(() => showToast("Next step copied."), () => showToast(text));
  }
}));
```

Update `selectFinding` signature:

```javascript
async function selectFinding(id, options = {}) {
  state.selectedId = id;
  if (options.openDetail && isMobileViewport()) setMobileDetailOpen(true);
  const requestId = ++state.requestSeq;
  renderList();
  // keep the existing body below this line
}
```

Update the row click handler in `renderList()`:

```javascript
list.querySelectorAll(".item").forEach((button) => button.addEventListener("click", () => selectFinding(button.dataset.id, { openDetail: true })));
```

In the search input handler, before `renderList()`:

```javascript
setMobileDetailOpen(false);
```

In the filter click handler, before `renderList()`:

```javascript
setMobileDetailOpen(false);
```

- [ ] **Step 4: Mark primary row/detail actions for mobile styling**

In each finding row button, add `data-mobile-primary="finding"`:

```javascript
<button class="item ${f.id === state.selectedId ? "selected" : ""}" data-id="${escapeHtml(f.id)}" data-mobile-primary="finding">
```

- [ ] **Step 5: Add resize handling**

Before initial `renderList()`:

```javascript
window.addEventListener("resize", () => {
  if (!isMobileViewport()) setMobileDetailOpen(false);
});
```

- [ ] **Step 6: Run focused tests**

```bash
npm test -- test/dashboard.test.ts
```

Expected: all dashboard tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/dashboard.ts test/dashboard.test.ts
git commit -m "feat: add mobile dashboard drill-in state"
```

---

## Task 3: Mobile Layout And Touch Ergonomics

**Files:**
- Modify: `src/dashboard.ts`
- Test: `test/dashboard.test.ts`

Purpose: stop stacking a desktop app on a phone. Make the phone viewport a stable one-screen queue or one-screen detail.

- [ ] **Step 1: Add mobile CSS hooks**

Add near the existing detail/action CSS:

```css
.mobile-detail-bar {
  display: none;
}
.mobile-back {
  border: 1px solid #d4ddd2;
  border-radius: 8px;
  background: var(--paper);
  color: #24352b;
  padding: 8px 10px;
  font-size: 12px;
  font-weight: 840;
}
.mobile-detail-context {
  min-width: 0;
  display: flex;
  gap: 8px;
  color: var(--muted);
  font-size: 11px;
  font-weight: 780;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

- [ ] **Step 2: Replace the mobile breakpoint rules**

Replace the current `@media (max-width: 980px)` block with:

```css
@media (max-width: 980px) {
  html,
  body {
    height: 100dvh;
    overflow: hidden;
  }
  .app {
    height: 100dvh;
    grid-template-rows: auto minmax(0, 1fr);
  }
  .topbar {
    grid-template-columns: auto 1fr;
    gap: 8px;
    padding: 10px 12px;
  }
  .logo {
    min-width: 0;
    gap: 8px;
  }
  .mark {
    width: 28px;
    height: 28px;
    border-radius: 7px;
  }
  .top-actions {
    gap: 6px;
  }
  .button {
    height: 32px;
    padding: 0 8px;
    font-size: 11px;
  }
  .search {
    grid-column: 1 / -1;
    grid-row: 2;
    height: 34px;
  }
  .workspace {
    grid-template-columns: 1fr;
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }
  .queue {
    height: 100%;
    max-height: none;
    min-height: 0;
    border-right: 0;
    border-bottom: 0;
    grid-template-rows: auto auto auto auto minmax(0, 1fr);
  }
  .content {
    display: none;
    height: 100%;
    min-height: 0;
    overflow: auto;
  }
  .mobile-detail-open .queue {
    display: none;
  }
  .mobile-detail-open .content {
    display: block;
  }
  .queue-head {
    padding: 10px 12px;
  }
  .queue-title {
    margin-bottom: 8px;
  }
  .stats {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 6px;
  }
  .stat {
    padding: 7px 8px;
    border-radius: 7px;
  }
  .stat-value {
    font-size: 15px;
    margin-bottom: 2px;
  }
  .mode-note {
    padding: 8px 12px;
    font-size: 11px;
  }
  .batch-health {
    grid-template-columns: repeat(4, max-content);
    overflow-x: auto;
    padding: 8px 12px;
    gap: 6px;
  }
  .health-chip {
    padding: 6px 7px;
  }
  .filters {
    flex-wrap: nowrap;
    overflow-x: auto;
    min-height: 44px;
    padding: 8px 12px;
    scrollbar-width: none;
  }
  .filters::-webkit-scrollbar {
    display: none;
  }
  .filter {
    min-height: 28px;
    padding: 5px 9px;
  }
  .list {
    min-height: 0;
    overflow: auto;
    -webkit-overflow-scrolling: touch;
  }
  .item {
    padding: 12px;
  }
  .item-title {
    font-size: 12px;
  }
  .item-evidence {
    margin-top: 6px;
  }
  .detail {
    max-width: none;
    min-height: 100%;
    padding: 0;
  }
  .mobile-detail-bar {
    position: sticky;
    top: 0;
    z-index: 5;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--line);
    background: rgba(255, 255, 255, .96);
    backdrop-filter: blur(10px);
  }
  .hero {
    border-radius: 0;
    border-left: 0;
    border-right: 0;
    box-shadow: none;
  }
  .hero-main {
    padding: 16px 14px;
  }
  .headline {
    font-size: 22px;
    line-height: 1.12;
  }
  .summary {
    font-size: 14px;
  }
  .hero-actions {
    gap: 6px;
  }
  .inline-action {
    padding: 8px 10px;
  }
  .body-grid {
    grid-template-columns: 1fr;
    gap: 10px;
    margin-top: 10px;
    padding: 0 10px 14px;
  }
  .side {
    gap: 10px;
  }
  .private-strip {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 3: Replace the small-phone breakpoint**

Replace the current `@media (max-width: 560px)` block with:

```css
@media (max-width: 560px) {
  .logo > div:last-child {
    max-width: 112px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .top-actions .button {
    max-width: 88px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .stats {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
```

- [ ] **Step 4: Run focused tests**

```bash
npm test -- test/dashboard.test.ts test/server.test.ts
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard.ts test/dashboard.test.ts
git commit -m "feat: improve dashboard mobile layout"
```

---

## Task 4: Taste Pass For Triage Density

**Files:**
- Modify: `src/dashboard.ts`
- Test: `test/dashboard.test.ts`

Purpose: make the dashboard read like a serious operational tool. This is not a redesign; it is a tighter surface for triaging the `37/52` weak/enrichment backlog.

- [ ] **Step 1: Add list row score and evidence chips**

Add this helper after `evidenceText(f)`:

```javascript
function evidenceChips(f) {
  const items = [
    ["caption", f.evidence.caption],
    ["transcript", f.evidence.transcript],
    ["OCR", f.evidence.ocr],
    ["repo", f.evidence.repo],
    ["docs", f.evidence.docs],
  ];
  return items
    .filter(([, present]) => present)
    .map(([label]) => '<span class="evidence-chip">' + escapeHtml(label) + '</span>')
    .join("") || '<span class="evidence-chip muted">metadata only</span>';
}
```

In `renderList()`, replace:

```javascript
<div class="item-evidence">${escapeHtml(evidenceText(f))}</div>
```

with:

```javascript
<div class="item-evidence">${evidenceChips(f)}</div>
```

Add score to `.item-meta`:

```javascript
<div class="item-meta">${escapeHtml(f.saved || "unsaved")} · ${escapeHtml(f.source.platform)} · ${escapeHtml(f.quality.score)}/100${state.privateUnlocked && f.targetProject ? " · " + escapeHtml(f.targetProject) : ""}</div>
```

- [ ] **Step 2: Add chip CSS**

Near `.item-evidence`, add:

```css
.item-evidence {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 7px;
}
.evidence-chip {
  color: #405146;
  background: #edf2ec;
  border: 1px solid #dfe7dd;
  border-radius: 999px;
  padding: 3px 6px;
  font-size: 10px;
  font-weight: 820;
}
.evidence-chip.muted {
  color: var(--muted);
}
```

Remove the older `.item-evidence` rule that only sets text color/font-size/margin.

- [ ] **Step 3: Tighten panel shadows on mobile only**

Inside the mobile media query, add:

```css
.panel {
  border-radius: 7px;
}
.panel-head {
  padding: 10px 12px;
}
.panel-body {
  padding: 12px;
}
```

- [ ] **Step 4: Extend shell test**

In `test/dashboard.test.ts`, add:

```typescript
  it("renders mobile triage affordance hooks", () => {
    const html = DASHBOARD_HTML([]);

    expect(html).toContain("evidence-chip");
    expect(html).toContain("mobile-detail-bar");
    expect(html).toContain("mobile-back");
  });
```

- [ ] **Step 5: Run tests**

```bash
npm test -- test/dashboard.test.ts test/server.test.ts
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/dashboard.ts test/dashboard.test.ts
git commit -m "feat: sharpen dashboard triage rows"
```

---

## Task 5: Parallel Browser QA And Fix Loop

**Files:**
- Modify: `src/dashboard.ts` only if verification finds issues.

Purpose: use actual browser evidence before claiming mobile is fixed.

- [ ] **Step 1: Start local server**

```bash
PORT=5001 AI_MEMORY_LOCAL_DIR=/Users/work/Repositories/ai-memory npm run dev
```

Expected: server listens on `http://127.0.0.1:5001`.

- [ ] **Step 2: Dispatch parallel QA subagents**

Dispatch three subagents in parallel:

1. Mobile QA:
   - Browser sizes: `390x844`, `430x932`
   - Verify first viewport, row tap, detail open, back button, filter rail, search, empty results.
2. Desktop QA:
   - Browser size: `1440x900`
   - Verify split explorer remains two-pane, queue/detail independently scroll, detail switching still fast.
3. Privacy/data QA:
   - Public mode: project fit/actions absent in rendered public detail.
   - Private mode: unlock flow still reveals project/action fields.
   - `/api/public/audit` and `/api/public/findings/:id` still behave.

- [ ] **Step 3: Run local browser commands yourself**

```bash
export CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
export PWCLI="$CODEX_HOME/skills/playwright/scripts/playwright_cli.sh"
"$PWCLI" open http://127.0.0.1:5001 --browser chromium
"$PWCLI" resize 390 844
"$PWCLI" snapshot
"$PWCLI" click "Video by max_kelleyy"
"$PWCLI" snapshot
"$PWCLI" click "Findings"
"$PWCLI" fill "Search findings, tools, sources, or project fit" "Palmier"
"$PWCLI" snapshot
"$PWCLI" resize 1440 900
"$PWCLI" snapshot
```

Expected:

- At `390x844`, the default view is list-only.
- Row tap opens detail-only.
- Back returns to list.
- Filters stay in a single horizontal rail.
- No text overlaps in header/actions.
- At `1440x900`, desktop split remains intact.

- [ ] **Step 4: Fix any browser issues**

If browser QA finds an issue, patch only `src/dashboard.ts`, then run:

```bash
npm test -- test/dashboard.test.ts test/server.test.ts
npm run build
```

- [ ] **Step 5: Commit verification fixes if any**

```bash
git add src/dashboard.ts test/dashboard.test.ts
git commit -m "fix: polish dashboard responsive behavior"
```

Skip this commit if no fixes are needed.

---

## Task 6: Full Verification And Deploy

**Files:**
- No source changes unless verification exposes a bug.

- [ ] **Step 1: Run full tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 2: Run build**

```bash
npm run build
```

Expected: TypeScript build is clean.

- [ ] **Step 3: Confirm clean git status**

```bash
git status --short
```

Expected: clean tree, except intentional Playwright artifacts outside the repo or removed before commit.

- [ ] **Step 4: Deploy**

Use the linked Railway project. If this is a manual worktree and Railway is not linked, run:

```bash
railway link --project a3d49992-abad-4a2c-8773-d1b92fdcafbd --service 2accf92f-c79b-484b-8a16-1a6a3ffa7bf7 --environment production
```

Then deploy:

```bash
railway up --detach
railway deployment list --limit 3
```

Expected: newest deployment reaches `SUCCESS`.

- [ ] **Step 5: Production smoke**

```bash
curl -fsS "https://tech-radar-api-production.up.railway.app/api/public/audit" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d); console.log(j.audit.total, j.audit.needsEnrichment, j.filters.enrich)})'
curl -fsS "https://tech-radar-api-production.up.railway.app/" | rg 'mobile-detail-open|mobile-back|data-filter="enrich"'
```

Expected:

- Public audit still returns latest batch counts and enrichment count.
- Production HTML contains mobile drill-in hooks and enrichment filter.

- [ ] **Step 6: Push**

```bash
git push origin HEAD:main
```

Expected: `origin/main` points at the same commit deployed to Railway.

---

## Out Of Scope

- Rebuilding the dashboard in React, Next.js, or another framework.
- Adding tabs.
- Adding Clerk or changing auth.
- Adding a new enrichment agent layer.
- Building deterministic enrichment actions in this pass.
- Changing extraction, parser, scoring, or public/private API shapes unless a privacy bug is discovered during QA.

---

## Follow-Up Plan After Mobile

Once mobile is fixed, resume the previous enrichment plan:

1. Evidence lengths in detail.
2. Stricter implementation output validation.
3. Conservative link enrichment.
4. Deterministic action buttons for transcript/link/doc repair.
