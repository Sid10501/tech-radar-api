# Linked Artifact Intake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert extracted source links from workflow videos into structured linked artifacts that prompts, findings, and future child-ingestion runs can use.

**Architecture:** Keep this as a deterministic metadata layer. Add a small TypeScript classifier used by prompts/compose, mirror the same lightweight classification in the Python extractor output, and queue actionable child artifacts after the parent finding is written. Do not recursively process child runs in the same parent run.

**Tech Stack:** Node.js 20, TypeScript, Vitest, Python extractor, pytest.

---

### Task 1: Linked Artifact Contract

**Files:**
- Create: `src/lib/linkedArtifacts.ts`
- Modify: `src/extract.ts`
- Modify: `src/lib/extractForLlm.ts`
- Test: `test/lib/linkedArtifacts.test.ts`
- Test: `test/lib/extractForLlm.test.ts`

- [x] **Step 1: Write failing classifier tests**

Cover GitHub repos, known Kun workflow repos, docs, and profile/other links.

- [x] **Step 2: Write failing prompt test**

Assert linked artifacts appear in the research prompt with type and role.

- [x] **Step 3: Implement classifier and contract**

Add `LinkedArtifact` to `ExtractResult`, derive missing artifacts from `source_links`, and render them as metadata.

- [x] **Step 4: Verify focused tests**

Run `npm test -- test/lib/linkedArtifacts.test.ts test/lib/extractForLlm.test.ts`.

### Task 2: Finding Rendering

**Files:**
- Modify: `src/compose.ts`
- Modify: `src/dashboard.ts`
- Modify: `src/findings.ts`
- Modify: `test/fixtures/extract_youtube.json`
- Test: `test/compose.test.ts`
- Test: `test/findings.test.ts`

- [x] **Step 1: Write failing compose/dashboard-boundary tests**

Assert `Linked artifacts:` renders separately and does not get folded into OCR evidence.

- [x] **Step 2: Implement markdown block and parsing boundaries**

Render artifact type, role, and URL under `What the post showed`.

- [x] **Step 3: Verify focused tests**

Run `npm test -- test/compose.test.ts test/findings.test.ts`.

### Task 3: Python Extractor Metadata

**Files:**
- Modify: `scripts/extract_post.py`
- Test: `test/extract_post_test.py`

- [x] **Step 1: Write failing helper test**

Assert `classify_linked_artifacts()` maps known Kun workflow links to expected artifact types.

- [x] **Step 2: Implement helper and add output field**

Set `linked_artifacts` whenever `source_links` are populated.

- [x] **Step 3: Verify Python tests**

Run `python3 -m pytest test/extract_post_test.py`.

### Task 4: Full Verification

- [x] **Step 1: Run full Vitest**

Run `npm test`.

- [x] **Step 2: Run TypeScript build**

Run `npm run build`.

- [x] **Step 3: Run extractor syntax check**

Run `python3 -m py_compile scripts/extract_post.py`.

### Task 5: Workflow Audit Intake

**Files:**
- Modify: `src/lib/linkedArtifacts.ts`
- Modify: `src/lib/extractForLlm.ts`
- Modify: `src/compose.ts`
- Modify: `src/findings.ts`
- Modify: `src/dashboard.ts`
- Test: `test/lib/linkedArtifacts.test.ts`
- Test: `test/lib/extractForLlm.test.ts`
- Test: `test/compose.test.ts`
- Test: `test/findings.test.ts`

- [x] **Step 1: Write failing workflow-audit tests**

Assert workflow artifact lists create a deterministic audit block, prompts include workflow intake guidance, composed findings render `## Workflow Audit`, and finding detail parsing keeps the section separate.

- [x] **Step 2: Implement workflow audit helper**

Add `buildWorkflowAuditBlock()` to group validation gates, planning artifacts, long-running loops, orchestration candidates, and ergonomics/interface tools.

- [x] **Step 3: Surface workflow audit in prompts and findings**

Add workflow intake guidance to research prompts and a `## Workflow Audit` section to composed markdown when linked artifacts indicate an agentic workflow.

- [x] **Step 4: Verify**

Run focused Vitest, full Vitest, TypeScript build, Python extractor tests, and py_compile.

### Task 6: Child Artifact Intake Queue

**Files:**
- Create: `src/lib/linkedArtifactIntake.ts`
- Modify: `src/git.ts`
- Modify: `src/runner.ts`
- Test: `test/lib/linkedArtifactIntake.test.ts`
- Test: `test/git.test.ts`
- Test: `test/runner.e2e.test.ts`

- [x] **Step 1: Write failing intake tests**

Assert actionable linked artifacts are selected for intake, profile/reference links are excluded, duplicate URLs are ignored, and child rows include parent context.

- [x] **Step 2: Add deduped inbox append**

Add `updateInboxIfMissing()` so child rows are queued only when their URL is not already present in `INBOX.md`.

- [x] **Step 3: Queue child artifacts after parent finding**

After the parent finding is written and indexed, append pending child rows for actionable linked artifacts in the same commit. Telegram success messages report queued child artifact count.

- [x] **Step 4: Verify**

Run focused Vitest, full Vitest, TypeScript build, Python extractor tests, and py_compile.
