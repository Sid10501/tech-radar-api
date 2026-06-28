# Dashboard Enrichment And Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Tech Radar show a clear, trustworthy work queue by adding audit summaries, filter counts, enrichment states, stronger implementation validation, and a small link-enrichment pass.

**Architecture:** Keep the existing explicit pipeline: extract -> research -> implementation -> compose -> ai-memory git write. Add deterministic audit helpers first, surface them through the existing Fastify API, then render them in the current single-file dashboard without introducing a UI framework. Add link enrichment as a conservative pre-research helper: it can improve evidence, but it must never invent a repo when confidence is low.

**Tech Stack:** Node.js 20, TypeScript, Fastify, Zod, Vitest, native `node:https`, current dashboard in `src/dashboard.ts`, Railway.

---

## Current Session Closure

Already shipped on `main`:

- Commit `0e1f949 fix: render complete finding detail sections`
- Railway deployment `d31baf31-d3ff-4601-8a14-eba997e4975a`
- Production verified:
  - Public detail for `20260617-video-by-max-kelleyy.md` returns `shownLen: 1024` and transcript content.
  - Private detail returns implementation length above 2600 chars and `recommendedAction: Create task`.
- Checks run:
  - `npm test` -> 59 passing
  - `npm run build` -> clean
- Local dev server on port 5001 was stopped.
- Untracked `tech-radar-api.cursor.code-workspace` was present before this work and should be left alone unless the user explicitly asks.

Latest-15 production audit after the parser fix:

```text
total: 15
quality: weak 12, review 2, strong 1
evidence: caption 15, transcript 8, OCR 4, repo 7, docs 2
junk tags after parser cleanup: 0
```

---

## File Map

| File | Purpose |
|------|---------|
| `src/findings.ts` | Finding parser, evidence flags, scoring, recommended actions. Add audit summary helpers here or in `src/findingAudit.ts`. |
| `src/findingAudit.ts` | New pure helper module for batch health, filter counts, enrichment status, and evidence lengths. |
| `src/server.ts` | Add public/private audit endpoints. |
| `src/dashboard.ts` | Render batch health, filter counts, disabled zero filters, enrichment badges, and evidence lengths. |
| `src/schemas/implementationOutput.ts` | Tighten implementation output validation. |
| `src/agents/implementation.ts` | Preserve existing normalization and handle stricter validation errors. |
| `src/linkEnrichment.ts` | New conservative link extraction and GitHub candidate helper. |
| `src/agents/research.ts` | Pass enriched links into the research prompt without adding more agent rounds. |
| `src/lib/extractForLlm.ts` | Include enriched candidate links in the research user message. |
| `test/findings.test.ts` | Existing parser/evidence tests. Extend for audit states if helpers stay in this file. |
| `test/findingAudit.test.ts` | New unit tests for counts, needs-enrichment, and evidence lengths. |
| `test/server.test.ts` | Endpoint tests for public/private audit responses. |
| `test/dashboard.test.ts` | New dashboard HTML smoke tests for filter count markup and zero-filter disabled state. |
| `test/linkEnrichment.test.ts` | New tests for URL extraction and conservative GitHub candidate behavior. |
| `test/schemas/implementationOutput.test.ts` | New tests for stricter implementation schema. |
| `MEMORY.md` | Add one short learning after implementation if behavior or Railway env changes. |

---

## Task 1: Batch Audit Model

**Files:**
- Create: `src/findingAudit.ts`
- Test: `test/findingAudit.test.ts`

Purpose: create one deterministic source for dashboard health numbers and enrichment state. This makes the UI less chaotic because counts and filters come from one tested model.

- [ ] **Step 1: Write the failing tests**

Create `test/findingAudit.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import type { FindingSummary, PublicFindingSummary } from "../src/findings.js";
import { auditFindings, auditPublicFindings, enrichmentStatus, filterCounts, filterCountsFromPublic } from "../src/findingAudit.js";

function finding(overrides: Partial<FindingSummary>): FindingSummary {
  return {
    id: "sample.md",
    filename: "sample.md",
    path: "tech-radar/findings/sample.md",
    title: "Sample",
    saved: "2026-06-28",
    tags: ["instagram"],
    source: { platform: "instagram", label: "Creator", url: "https://example.com/post" },
    targetProject: "tech-radar-api",
    verdict: "#try-soon",
    summary: "Summary",
    evidence: { caption: true, transcript: false, ocr: false, repo: false, docs: false },
    quality: { score: 42, level: "weak", reasons: ["caption", "source uncertainty"] },
    recommendedAction: "Retry",
    ...overrides,
  };
}

describe("finding audit helpers", () => {
  it("computes latest batch health and evidence counts", () => {
    const rows = [
      finding({ id: "a.md", quality: { score: 85, level: "strong", reasons: [] }, evidence: { caption: true, transcript: true, ocr: true, repo: true, docs: false }, recommendedAction: "Create task" }),
      finding({ id: "b.md", quality: { score: 63, level: "review", reasons: [] }, evidence: { caption: true, transcript: false, ocr: false, repo: true, docs: true }, recommendedAction: "Review" }),
      finding({ id: "c.md", quality: { score: 20, level: "weak", reasons: [] }, evidence: { caption: true, transcript: false, ocr: false, repo: false, docs: false } }),
    ];

    expect(auditFindings(rows, 3)).toEqual({
      total: 3,
      quality: { strong: 1, review: 1, weak: 1 },
      evidence: { caption: 3, transcript: 1, ocr: 1, repo: 2, docs: 1 },
      actions: { "Create task": 1, Backlog: 0, Skip: 0, Retry: 1, Review: 1 },
      needsEnrichment: 1,
      missingTranscript: 2,
      missingRepoOrDocs: 1,
    });
  });

  it("computes public audit without private action or project fields", () => {
    const publicRows: PublicFindingSummary[] = [
      {
        id: "public.md",
        filename: "public.md",
        path: "tech-radar/findings/public.md",
        title: "Public",
        saved: "2026-06-28",
        tags: ["github"],
        source: { platform: "github", label: "Repo", url: "https://github.com/example/tool" },
        summary: "Summary",
        evidence: { caption: true, transcript: false, ocr: false, repo: true, docs: false },
        quality: { score: 60, level: "review", reasons: ["caption", "repo"] },
        isPrivate: false,
      },
    ];

    expect(auditPublicFindings(publicRows)).toMatchObject({
      total: 1,
      quality: { review: 1 },
      evidence: { caption: 1, repo: 1 },
      missingTranscript: 1,
      missingRepoOrDocs: 0,
    });
    expect(filterCountsFromPublic(publicRows)).toMatchObject({ all: 1, review: 1, repo: 1, enrich: 0 });
  });

  it("marks weak project-fit findings without links as needs-enrichment", () => {
    expect(enrichmentStatus(finding({ targetProject: "Cross-Tax" }))).toBe("needs-enrichment");
    expect(enrichmentStatus(finding({ targetProject: "none", verdict: "#skip", recommendedAction: "Skip" }))).toBe("skip");
    expect(enrichmentStatus(finding({ evidence: { caption: true, transcript: true, ocr: false, repo: true, docs: false } }))).toBe("ready");
  });

  it("computes filter counts used by the dashboard", () => {
    const counts = filterCounts([
      finding({ id: "a.md", quality: { score: 85, level: "strong", reasons: [] }, evidence: { caption: true, transcript: true, ocr: true, repo: true, docs: false } }),
      finding({ id: "b.md", recommendedAction: "Skip", targetProject: "none", verdict: "#skip" }),
    ]);

    expect(counts).toMatchObject({
      all: 2,
      strong: 1,
      review: 0,
      weak: 1,
      repo: 1,
      ocr: 1,
      enrich: 1,
      skip: 1,
    });
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
cd /Users/work/Repositories/tech-radar-api
npm test -- test/findingAudit.test.ts
```

Expected: fail because `src/findingAudit.ts` does not exist.

- [ ] **Step 3: Implement `src/findingAudit.ts`**

```typescript
import type { FindingSummary, PublicFindingSummary } from "./findings.js";

export interface FindingAuditSummary {
  total: number;
  quality: Record<"strong" | "review" | "weak", number>;
  evidence: Record<"caption" | "transcript" | "ocr" | "repo" | "docs", number>;
  actions?: Record<FindingSummary["recommendedAction"], number>;
  needsEnrichment: number;
  missingTranscript: number;
  missingRepoOrDocs: number;
}

export type EnrichmentStatus = "ready" | "needs-enrichment" | "skip";

export function enrichmentStatus(finding: FindingSummary): EnrichmentStatus {
  if (finding.recommendedAction === "Skip" || finding.verdict.includes("#skip") || finding.targetProject === "none") {
    return "skip";
  }
  const hasRepoOrDocs = finding.evidence.repo || finding.evidence.docs;
  if (finding.quality.level === "weak" || !hasRepoOrDocs) return "needs-enrichment";
  return "ready";
}

export function auditFindings(findings: FindingSummary[], limit = 15): FindingAuditSummary {
  const latest = findings.slice(0, limit);
  const summary: FindingAuditSummary = {
    total: latest.length,
    quality: { strong: 0, review: 0, weak: 0 },
    evidence: { caption: 0, transcript: 0, ocr: 0, repo: 0, docs: 0 },
    actions: { "Create task": 0, Backlog: 0, Skip: 0, Retry: 0, Review: 0 },
    needsEnrichment: 0,
    missingTranscript: 0,
    missingRepoOrDocs: 0,
  };

  for (const finding of latest) {
    summary.quality[finding.quality.level] += 1;
    summary.actions![finding.recommendedAction] += 1;
    for (const key of Object.keys(summary.evidence) as Array<keyof FindingAuditSummary["evidence"]>) {
      if (finding.evidence[key]) summary.evidence[key] += 1;
    }
    if (enrichmentStatus(finding) === "needs-enrichment") summary.needsEnrichment += 1;
    if (!finding.evidence.transcript) summary.missingTranscript += 1;
    if (!finding.evidence.repo && !finding.evidence.docs) summary.missingRepoOrDocs += 1;
  }

  return summary;
}

export function auditPublicFindings(findings: PublicFindingSummary[], limit = 15): FindingAuditSummary {
  const latest = findings.slice(0, limit);
  const summary: FindingAuditSummary = {
    total: latest.length,
    quality: { strong: 0, review: 0, weak: 0 },
    evidence: { caption: 0, transcript: 0, ocr: 0, repo: 0, docs: 0 },
    needsEnrichment: 0,
    missingTranscript: 0,
    missingRepoOrDocs: 0,
  };

  for (const finding of latest) {
    summary.quality[finding.quality.level] += 1;
    for (const key of Object.keys(summary.evidence) as Array<keyof FindingAuditSummary["evidence"]>) {
      if (finding.evidence[key]) summary.evidence[key] += 1;
    }
    if (finding.quality.level === "weak" || (!finding.evidence.repo && !finding.evidence.docs)) summary.needsEnrichment += 1;
    if (!finding.evidence.transcript) summary.missingTranscript += 1;
    if (!finding.evidence.repo && !finding.evidence.docs) summary.missingRepoOrDocs += 1;
  }

  return summary;
}

export function filterCounts(findings: FindingSummary[]): Record<string, number> {
  const counts = {
    all: findings.length,
    strong: 0,
    review: 0,
    weak: 0,
    repo: 0,
    project: 0,
    ocr: 0,
    enrich: 0,
    skip: 0,
  };

  for (const finding of findings) {
    counts[finding.quality.level] += 1;
    if (finding.evidence.repo || finding.evidence.docs) counts.repo += 1;
    if (finding.targetProject && finding.targetProject !== "none" && finding.targetProject !== "unknown") counts.project += 1;
    if (finding.evidence.ocr) counts.ocr += 1;
    if (enrichmentStatus(finding) === "needs-enrichment") counts.enrich += 1;
    if (enrichmentStatus(finding) === "skip") counts.skip += 1;
  }

  return counts;
}

export function filterCountsFromPublic(findings: PublicFindingSummary[]): Record<string, number> {
  const counts = {
    all: findings.length,
    strong: 0,
    review: 0,
    weak: 0,
    repo: 0,
    project: 0,
    ocr: 0,
    enrich: 0,
    skip: 0,
  };

  for (const finding of findings) {
    counts[finding.quality.level] += 1;
    if (finding.evidence.repo || finding.evidence.docs) counts.repo += 1;
    if (finding.evidence.ocr) counts.ocr += 1;
    if (finding.quality.level === "weak" || (!finding.evidence.repo && !finding.evidence.docs)) counts.enrich += 1;
  }

  return counts;
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- test/findingAudit.test.ts
```

Expected: all tests in `test/findingAudit.test.ts` pass.

- [ ] **Step 5: Commit**

```bash
git add src/findingAudit.ts test/findingAudit.test.ts
git commit -m "feat: add finding audit summary model"
```

---

## Task 2: Audit Endpoints

**Files:**
- Modify: `src/server.ts`
- Test: `test/server.test.ts`

Purpose: expose audited counts to the dashboard and to future automations without recomputing in browser JS.

- [ ] **Step 1: Write endpoint tests**

Add this test near the public findings route tests in `test/server.test.ts`:

```typescript
it("GET /api/public/audit returns latest batch health without auth", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "server-public-audit-"));
  const findingsDir = path.join(dir, "tech-radar", "findings");
  fs.mkdirSync(findingsDir, { recursive: true });
  fs.writeFileSync(
    path.join(findingsDir, "sample.md"),
    [
      "# Sample",
      "",
      "**Source:** instagram",
      "**Saved:** 20260628",
      "**Tags:** instagram",
      "",
      "## TL;DR",
      "",
      "Public summary.",
      "",
      "## What the post showed",
      "",
      "> Caption: useful tool",
      "",
      "Key claims from transcript:",
      "- (no transcript available)",
      "",
      "## Links",
      "",
      "- (no links found)",
      "",
      "## Fit for Sid",
      "",
      "- Target project: tech-radar-api",
      "- Verdict: `#try-soon`",
    ].join("\n"),
  );
  process.env["AI_MEMORY_LOCAL_DIR"] = dir;

  const res = await app.inject({ method: "GET", url: "/api/public/audit" });

  expect(res.statusCode).toBe(200);
  expect(res.json()).toMatchObject({
    audit: {
      total: 1,
      quality: { weak: 1 },
      needsEnrichment: 1,
      missingTranscript: 1,
      missingRepoOrDocs: 1,
    },
    filters: {
      all: 1,
      enrich: 1,
      repo: 0,
    },
  });
});
```

Add this test inside the `with AUTH_TOKEN set` describe block:

```typescript
it("GET /api/audit returns private action counts with valid auth", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "server-private-audit-"));
  const findingsDir = path.join(dir, "tech-radar", "findings");
  fs.mkdirSync(findingsDir, { recursive: true });
  fs.writeFileSync(
    path.join(findingsDir, "sample.md"),
    "# Sample\n\n**Saved:** 20260628\n\n## TL;DR\n\nPublic\n\n## What the post showed\n\n> Caption: useful\n\n## Fit for Sid\n\n- Target project: none\n- Verdict: `#skip`",
  );
  process.env["AI_MEMORY_LOCAL_DIR"] = dir;

  const res = await app.inject({
    method: "GET",
    url: "/api/audit",
    headers: { authorization: `Bearer ${TOKEN}` },
  });

  expect(res.statusCode).toBe(200);
  expect(res.json().audit.actions.Skip).toBe(1);
  expect(res.json().filters.skip).toBe(1);
});
```

- [ ] **Step 2: Run the tests and verify failure**

```bash
npm test -- test/server.test.ts
```

Expected: 404 for `/api/public/audit` and `/api/audit`.

- [ ] **Step 3: Implement endpoints in `src/server.ts`**

Add import:

```typescript
import { auditFindings, auditPublicFindings, filterCounts, filterCountsFromPublic } from "./findingAudit.js";
```

Add routes after `/api/public/findings`:

```typescript
  app.get("/api/public/audit", async () => {
    await ensureAiMemoryCheckout();
    const findings = listPublicFindings();
    return { audit: auditPublicFindings(findings), filters: filterCountsFromPublic(findings) };
  });
```

Add route after `/api/findings`:

```typescript
  app.get("/api/audit", { preHandler: authMiddleware }, async () => {
    await ensureAiMemoryCheckout();
    const findings = listFindings();
    return { audit: auditFindings(findings), filters: filterCounts(findings) };
  });
```

- [ ] **Step 4: Run tests**

```bash
npm test -- test/server.test.ts test/findingAudit.test.ts
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/server.ts src/findingAudit.ts test/server.test.ts test/findingAudit.test.ts
git commit -m "feat: expose finding audit endpoints"
```

---

## Task 3: Dashboard Counts And Enrichment Queue

**Files:**
- Modify: `src/dashboard.ts`
- Test: `test/dashboard.test.ts`

Purpose: keep filters, counts, and CTAs obvious. Do not add tabs. Do not add nested cards. Keep the split explorer.

- [ ] **Step 1: Write dashboard HTML smoke tests**

Create `test/dashboard.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { DASHBOARD_HTML } from "../src/dashboard.js";

describe("dashboard shell", () => {
  it("contains compact filters for enrichment and skip state", () => {
    const html = DASHBOARD_HTML([]);

    expect(html).toContain('data-filter="enrich"');
    expect(html).toContain('data-filter="skip"');
    expect(html).toContain('data-count-for="repo"');
    expect(html).toContain("batch-health");
    expect(html).not.toContain("class=\"tabs\"");
  });
});
```

- [ ] **Step 2: Run and verify failure**

```bash
npm test -- test/dashboard.test.ts
```

Expected: fail because dashboard lacks those strings.

- [ ] **Step 3: Add filter buttons in `src/dashboard.ts`**

In the filters block, change the buttons to include counts and the two new filters:

```html
<button class="filter active" data-filter="all">All <span data-count-for="all">0</span></button>
<button class="filter" data-filter="strong">Strong <span data-count-for="strong">0</span></button>
<button class="filter" data-filter="review">Review <span data-count-for="review">0</span></button>
<button class="filter" data-filter="weak">Weak <span data-count-for="weak">0</span></button>
<button class="filter" data-filter="repo">Repo/docs <span data-count-for="repo">0</span></button>
<button class="filter" data-filter="enrich">Needs enrichment <span data-count-for="enrich">0</span></button>
<button class="filter" data-filter="ocr">OCR <span data-count-for="ocr">0</span></button>
<button class="filter private-only-filter" data-filter="project">Project fit <span data-count-for="project">0</span></button>
<button class="filter private-only-filter" data-filter="skip">Skip <span data-count-for="skip">0</span></button>
```

- [ ] **Step 4: Add batch health area**

Add this between `mode-note` and `filters`:

```html
<div id="batch-health" class="batch-health" aria-label="Latest batch health"></div>
```

Add CSS near `.mode-note`:

```css
.batch-health {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
  padding: 10px 16px;
  border-bottom: 1px solid #edf1ec;
  background: #fbfcf8;
}
.health-chip {
  min-width: 0;
  color: #405146;
  background: var(--paper);
  border: 1px solid #e1e7df;
  border-radius: 8px;
  padding: 7px 8px;
  font-size: 11px;
  font-weight: 800;
}
.filter[disabled] {
  opacity: .45;
  cursor: not-allowed;
}
.filter span {
  color: inherit;
  opacity: .72;
}
```

- [ ] **Step 5: Fetch audit data in dashboard JS**

Change state:

```javascript
const state = { findings: [], selectedId: null, detail: null, query: "", filter: "all", privateUnlocked: false, requestSeq: 0, loading: true, detailCache: new Map(), audit: null, filterCounts: {} };
```

Add function:

```javascript
async function loadAudit() {
  const path = state.privateUnlocked ? "/api/audit" : "/api/public/audit";
  const res = await fetch(path, { headers: state.privateUnlocked ? requestHeaders() : {}, credentials: "same-origin" });
  if (!res.ok) return;
  const body = await res.json();
  state.audit = body.audit || null;
  state.filterCounts = body.filters || {};
}
```

Call it in `loadFindings()` before `renderList()`:

```javascript
await loadAudit();
```

- [ ] **Step 6: Render counts and batch health**

Add inside `updateStats()`:

```javascript
document.querySelectorAll("[data-count-for]").forEach((el) => {
  const key = el.getAttribute("data-count-for");
  el.textContent = String(state.filterCounts[key] ?? 0);
  const button = el.closest("button");
  if (button && key !== "all") button.disabled = (state.filterCounts[key] ?? 0) === 0;
});
const audit = state.audit;
$("batch-health").innerHTML = audit ? [
  ["Latest", audit.total],
  ["Repo/docs", audit.evidence.repo + audit.evidence.docs],
  ["Transcript", audit.evidence.transcript],
  ["Enrich", audit.needsEnrichment],
].map(([label, value]) => '<div class="health-chip">' + escapeHtml(label) + ': ' + escapeHtml(value) + '</div>').join("") : "";
```

- [ ] **Step 7: Add filter behavior**

Update `matchesFilter(f)`:

```javascript
if (state.filter === "enrich") return f.quality.level === "weak" || !(f.evidence.repo || f.evidence.docs);
if (state.filter === "skip") return state.privateUnlocked && f.recommendedAction === "Skip";
```

- [ ] **Step 8: Run tests**

```bash
npm test -- test/dashboard.test.ts test/server.test.ts
```

Expected: pass.

- [ ] **Step 9: Browser verify**

```bash
PORT=5001 AI_MEMORY_LOCAL_DIR=/Users/work/Repositories/ai-memory npm run dev
```

Open `http://127.0.0.1:5001/` and verify:

- Filter labels show counts.
- Zero-count filters are disabled.
- "Needs enrichment" shows weak/no-link items.
- Selecting a finding still renders detail quickly.
- Sidebar and detail panes remain independently scrollable.

- [ ] **Step 10: Commit**

```bash
git add src/dashboard.ts test/dashboard.test.ts
git commit -m "feat: add dashboard audit counts and enrichment queue"
```

---

## Task 4: Evidence Lengths In Detail

**Files:**
- Modify: `src/findings.ts`
- Modify: `src/dashboard.ts`
- Test: `test/findings.test.ts`

Purpose: replace vague yes/no badges with enough context to trust them: transcript chars, OCR chars, links present.

- [ ] **Step 1: Extend detail shape**

In `src/findings.ts`, add:

```typescript
export interface FindingEvidenceDetail {
  captionChars: number;
  transcriptChars: number;
  ocrChars: number;
}
```

Add to both `FindingDetail` and `PublicFindingDetail`:

```typescript
evidenceDetail: FindingEvidenceDetail;
```

Add helper:

```typescript
function evidenceDetailFromShown(shown: string): FindingEvidenceDetail {
  return {
    captionChars: stripMarkdown(markerText(shown, "> Caption:", ["Key claims from transcript:", "On-screen text / OCR:"])).length,
    transcriptChars: stripMarkdown(markerText(shown, "Key claims from transcript:", ["On-screen text / OCR:"])).length,
    ocrChars: stripMarkdown(markerText(shown, "On-screen text / OCR:")).length,
  };
}
```

Use it in `getFindingDetail()` and `getPublicFindingDetail()`:

```typescript
const shown = textBetween(markdown, "What the post showed");
...
evidenceDetail: evidenceDetailFromShown(shown),
```

- [ ] **Step 2: Add tests**

In `test/findings.test.ts`, extend the private detail test:

```typescript
expect(detail?.evidenceDetail).toEqual({
  captionChars: 66,
  transcriptChars: 58,
  ocrChars: 37,
});
```

Use actual numbers from the test output if these counts differ because `stripMarkdown` removes punctuation.

- [ ] **Step 3: Render lengths**

In `src/dashboard.ts`, replace source check rows:

```javascript
const evidenceDetail = d.evidenceDetail || { captionChars: 0, transcriptChars: 0, ocrChars: 0 };
```

Use row labels:

```javascript
<div class="row"><div class="row-label">Caption</div><div class="badge">${evidenceDetail.captionChars} chars</div></div>
<div class="row"><div class="row-label">Transcript</div><div class="badge">${evidenceDetail.transcriptChars ? evidenceDetail.transcriptChars + " chars" : "not captured"}</div></div>
<div class="row"><div class="row-label">OCR</div><div class="badge">${evidenceDetail.ocrChars ? evidenceDetail.ocrChars + " chars" : "not captured"}</div></div>
```

- [ ] **Step 4: Run tests and browser verify**

```bash
npm test -- test/findings.test.ts
npm run build
```

Expected: tests and build pass. Browser detail panel should show char counts.

- [ ] **Step 5: Commit**

```bash
git add src/findings.ts src/dashboard.ts test/findings.test.ts
git commit -m "feat: show extraction evidence lengths"
```

---

## Task 5: Stricter Implementation Output Validation

**Files:**
- Modify: `src/schemas/implementationOutput.ts`
- Test: `test/schemas/implementationOutput.test.ts`

Purpose: fail fast if the implementation agent returns empty or generic private notes. This prevents future "empty implementation" dashboard states.

- [ ] **Step 1: Write schema tests**

Create `test/schemas/implementationOutput.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { ImplementationOutputSchema } from "../../src/schemas/implementationOutput.js";

const valid = {
  fit_for_owner: "This maps to tech-radar-api because it improves extraction quality.",
  target_project: "tech-radar-api",
  implementation_idea_markdown: "Add a small extraction audit endpoint and render it in the dashboard.",
  follow_ups: ["Run the latest 15 audit after deploy"],
};

describe("ImplementationOutputSchema", () => {
  it("accepts substantive implementation output", () => {
    expect(ImplementationOutputSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects empty implementation ideas", () => {
    expect(ImplementationOutputSchema.safeParse({ ...valid, implementation_idea_markdown: "" }).success).toBe(false);
  });

  it("rejects missing follow-ups", () => {
    expect(ImplementationOutputSchema.safeParse({ ...valid, follow_ups: [] }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run and verify failure**

```bash
npm test -- test/schemas/implementationOutput.test.ts
```

Expected: empty values currently pass.

- [ ] **Step 3: Tighten schema**

Change `src/schemas/implementationOutput.ts`:

```typescript
import { z } from "zod";

export const ImplementationOutputSchema = z.object({
  fit_for_owner: z.string().trim().min(20),
  target_project: z.string().trim().min(1),
  implementation_idea_markdown: z.string().trim().min(40),
  follow_ups: z.array(z.string().trim().min(8)).min(1),
});

export type ImplementationOutput = z.infer<typeof ImplementationOutputSchema>;
```

- [ ] **Step 4: Run tests**

```bash
npm test -- test/schemas/implementationOutput.test.ts test/agents/implementation.test.ts test/runner.e2e.test.ts
```

Expected: pass. If an existing fixture fails, improve the fixture text rather than weakening the schema.

- [ ] **Step 5: Commit**

```bash
git add src/schemas/implementationOutput.ts test/schemas/implementationOutput.test.ts test/agents/implementation.test.ts test/runner.e2e.test.ts
git commit -m "fix: require substantive implementation output"
```

---

## Task 6: Conservative Link Enrichment

**Files:**
- Create: `src/linkEnrichment.ts`
- Modify: `src/lib/extractForLlm.ts`
- Modify: `src/agents/research.ts`
- Test: `test/linkEnrichment.test.ts`
- Test: `test/lib/extractForLlm.test.ts`

Purpose: improve weak Instagram findings where captions mention a tool but links are missing. Keep this deterministic and conservative: extracted URLs are strong evidence; GitHub search candidates are hints, not facts.

- [ ] **Step 1: Write link enrichment tests**

Create `test/linkEnrichment.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { extractUrls, githubRepoFromUrl, enrichExtractedLinks } from "../src/linkEnrichment.js";

describe("link enrichment", () => {
  it("extracts URLs from caption and transcript", () => {
    expect(extractUrls("Try https://github.com/example/tool and docs https://example.dev/docs.")).toEqual([
      "https://github.com/example/tool",
      "https://example.dev/docs",
    ]);
  });

  it("normalizes GitHub repo URLs to owner/name", () => {
    expect(githubRepoFromUrl("https://github.com/example/tool?tab=readme")).toBe("example/tool");
    expect(githubRepoFromUrl("https://github.com/example/tool/tree/main/packages/app")).toBe("example/tool");
    expect(githubRepoFromUrl("https://example.com/example/tool")).toBeNull();
  });

  it("returns extracted repo and docs candidates without inventing search results", () => {
    const result = enrichExtractedLinks({
      caption: "Repo: https://github.com/example/tool docs https://tool.example/docs",
      transcript: null,
      visual_text: null,
    });

    expect(result.githubRepos).toEqual(["example/tool"]);
    expect(result.docsUrls).toEqual(["https://tool.example/docs"]);
    expect(result.confidence).toBe("extracted");
  });
});
```

- [ ] **Step 2: Implement `src/linkEnrichment.ts`**

```typescript
export interface LinkEnrichmentInput {
  caption: string | null;
  transcript: string | null;
  visual_text: string | null;
}

export interface LinkEnrichment {
  urls: string[];
  githubRepos: string[];
  docsUrls: string[];
  confidence: "none" | "extracted";
}

export function extractUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s<>)"']+/g) ?? [];
  return [...new Set(matches.map((url) => url.replace(/[.,;:!?]+$/, "")))];
}

export function githubRepoFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "github.com") return null;
    const [owner, repo] = parsed.pathname.split("/").filter(Boolean);
    if (!owner || !repo) return null;
    return `${owner}/${repo.replace(/\.git$/, "")}`;
  } catch {
    return null;
  }
}

export function enrichExtractedLinks(input: LinkEnrichmentInput): LinkEnrichment {
  const text = [input.caption, input.transcript, input.visual_text].filter(Boolean).join("\n");
  const urls = extractUrls(text);
  const githubRepos = [...new Set(urls.map(githubRepoFromUrl).filter((repo): repo is string => Boolean(repo)))];
  const docsUrls = urls.filter((url) => !githubRepoFromUrl(url));
  return {
    urls,
    githubRepos,
    docsUrls,
    confidence: urls.length ? "extracted" : "none",
  };
}
```

- [ ] **Step 3: Feed candidates into research prompt**

In `src/lib/extractForLlm.ts`, import and call:

```typescript
import { enrichExtractedLinks } from "../linkEnrichment.js";
```

Add to `buildResearchUserMessage(extract)`:

```typescript
const enrichment = enrichExtractedLinks(extract);
parts.push("", "Extracted link candidates:", JSON.stringify(enrichment, null, 2));
```

Make sure this content remains inside the user message and not the system prompt.

- [ ] **Step 4: Nudge research agent**

In `src/agents/prompts.ts`, add one instruction to the research prompt:

```text
If extracted link candidates include GitHub repos or docs URLs, prioritize those over guessing. If candidates are absent, do not invent a repo; set links to null unless the repo is obvious from the source URL itself.
```

- [ ] **Step 5: Run tests**

```bash
npm test -- test/linkEnrichment.test.ts test/lib/extractForLlm.test.ts test/agents/research.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/linkEnrichment.ts src/lib/extractForLlm.ts src/agents/prompts.ts test/linkEnrichment.test.ts test/lib/extractForLlm.test.ts
git commit -m "feat: add conservative link enrichment"
```

---

## Task 7: Final Verification And Deploy

**Files:**
- No new source files unless prior tasks reveal a test-only fix.
- Optional: `MEMORY.md` if a new durable gotcha is discovered.

- [ ] **Step 1: Run full checks**

```bash
cd /Users/work/Repositories/tech-radar-api
npm test
npm run build
```

Expected: all tests pass and TypeScript builds.

- [ ] **Step 2: Browser verification**

```bash
PORT=5001 AI_MEMORY_LOCAL_DIR=/Users/work/Repositories/ai-memory npm run dev
```

In browser:

- Public mode loads without password.
- Left sidebar remains bounded and scrollable.
- Filter counts are visible and zero-result filters are disabled.
- "Needs enrichment" shows a non-empty list when applicable.
- Selecting the Max Kelley finding shows transcript and implementation.
- Source check shows lengths, not misleading yes/no only.
- Unlocking private mode preserves selection and updates private counts.

Stop the local server with Ctrl-C.

- [ ] **Step 3: Deploy**

```bash
railway up --detach
railway deployment list --limit 3
```

Expected: newest deployment reaches `SUCCESS`.

- [ ] **Step 4: Production smoke checks**

```bash
curl -fsS "https://tech-radar-api-production.up.railway.app/api/public/audit" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).audit))'
curl -fsS "https://tech-radar-api-production.up.railway.app/api/public/findings/20260617-video-by-max-kelleyy.md" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d); console.log(j.sections.shown.length, j.sections.shown.includes("Key claims from transcript:"))})'
```

Expected:

- `/api/public/audit` returns `audit.total` and evidence counts.
- Max Kelley public detail has a full `shown` section and transcript marker.

- [ ] **Step 5: Commit and push**

```bash
git status --short
git push origin main
```

Expected: only known untracked workspace file remains, or clean tree if that file is removed by the user.

---

## Out Of Scope For This Plan

- Rebuilding the dashboard in React/Next.
- Adding Clerk. Public/private split already works with the current token unlock; Clerk can be a later auth migration if the dashboard becomes multi-user.
- DM/comment scraping for Instagram gated links. Only use source-visible text and conservative search/extraction.
- Adding another agent layer for enrichment. Prefer deterministic extraction and one existing research pass.

---

## Handoff Notes For Next Session

Start here:

```bash
cd /Users/work/Repositories/tech-radar-api
git pull --ff-only
git status --short
npm test
```

Then implement tasks in order. Recommended execution mode: subagent-driven development, one task per subagent, with review between tasks. If working inline, use `superpowers:executing-plans`.

The highest-value subset if time is limited:

1. Task 1: Batch audit model.
2. Task 2: Audit endpoints.
3. Task 3: Dashboard counts and enrichment queue.

Those three tasks make the dashboard easier to understand without changing the extraction pipeline.
