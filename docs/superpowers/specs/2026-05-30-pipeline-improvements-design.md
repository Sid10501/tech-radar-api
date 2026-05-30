# Pipeline Improvements Design
**Date:** 2026-05-30
**Repo:** tech-radar-api
**Status:** Approved

---

## Overview

Six independent improvements to the tech-radar-api pipeline, each isolated to a single layer. No shared abstraction introduced. Each change is independently testable and deployable.

---

## Improvement 1 — Early bail on junk posts

### Problem
When a post is DM-gated, non-technical, or fails to extract, the pipeline currently runs both Claude agents anyway (2+ API calls, 30–90s) and produces a `#skip` finding. This wastes tokens and time.

### Design
After `extract()` returns in `runner.ts`, add a bail guard:

**Bail condition:** `extract.status === "failed"` OR both `extract.caption` and `extract.transcript` are null/empty.

**On bail:**
1. Write a single INBOX row with status `skipped` and reason in the error column (e.g. `"no caption or transcript"`)
2. Commit with message `tech-radar: skipped <url>`
3. Send Telegram: `⏭️ Skipped (no content extracted):\n<url>`
4. Resolve the run as `skipped` (not `failed`) — no error state, no retry prompt

**New run status:** `skipped` added to `Run["status"]` union alongside `pending | running | processed | failed`.

**Web UI:** `.status-skipped { color: #999; }` — rendered as grey, same visual weight as `pending`.

**Dedup behavior:** Skipped runs are excluded from the dedup guard — re-submitting a skipped URL queues a fresh full run (user may have fixed the post, or it may have become public).

### `/retry` command
`/retry <url>` in Telegram explicitly force-retries any URL regardless of its current status (skipped, failed, or even processed if user wants a refresh). Implementation: strip the dedup check when a `/retry` prefix is detected by passing a `{ force: true }` option to `runPipeline`.

**Telegram responses:**
- `/retry https://...` → `⏳ Force-retrying:\n<url>`
- `/retry` with no URL → `Usage: /retry <url>`
- `/retry <url-not-in-store>` → queues normally (same as submitting fresh)

### Files changed
- `src/runner.ts` — bail guard, `skipped` status, `force` option on `runPipeline`
- `src/telegram.ts` — `/retry` command handler
- `src/server.ts` — `.status-skipped` CSS class in HTML template

### Tests
- `test/runner.e2e.test.ts` — new case: extract returns `status: "failed"` → run ends as `skipped`, no agents called
- `test/runner.e2e.test.ts` — new case: extract returns caption=null, transcript=null → `skipped`
- `test/runner.hydrate.test.ts` — `skipped` status round-trips through INBOX hydration

---

## Improvement 2 — GITHUB_TOKEN env var

### Problem
`github.ts` already reads `GITHUB_TOKEN` and sets the `Authorization` header, but the var is not documented in `.env.example` or `MEMORY.md`. Without it, the GitHub API is rate-limited to 60 req/hour (unauthenticated), which the pipeline can exhaust quickly.

### Design
No code changes. Documentation only:
- Add `GITHUB_TOKEN=` with a comment to `.env.example`
- Add a "Required env vars" note to `MEMORY.md` under Common Gotchas
- Add to Railway variables checklist in `README.md`

### Files changed
- `.env.example`
- `MEMORY.md`
- `README.md`

---

## Improvement 3 — Configurable Whisper model size

### Problem
`extract_post.py` hardcodes `WhisperModel("tiny", ...)`. The `tiny` model misses proper nouns and library names — critical for technical posts where the transcript is the main signal. Larger models exist (`base`, `small`, `medium`) but aren't accessible without code changes.

### Design
Read `WHISPER_MODEL` env var in `extract_post.py`, defaulting to `"tiny"`.

```python
WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "tiny")
model = WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8")
```

Valid values: `tiny`, `base`, `small`, `medium`, `large-v3`. No validation — faster-whisper will raise a clear error if an invalid model name is passed.

Set `WHISPER_MODEL=base` in Railway variables for a meaningful quality improvement with modest CPU overhead.

### Files changed
- `scripts/extract_post.py`
- `.env.example`
- `MEMORY.md` (document recommended Railway value)

### Tests
- `test/extract.test.ts` — existing tests unaffected (they mock the script); add a note that the env var is respected

---

## Improvement 4 — Implementation agent reads recent sessions

### Problem
The implementation agent's system prompt says "optionally read 1-2 recent sessions" — the word "optionally" means the model almost always skips it. Recent sessions contain current project context that makes recommendations significantly more grounded.

### Design
Change one word in `prompts.ts`: `"optionally"` → `"always"`. Also make the user message more explicit:

**Current user message:**
> "Read GLOBAL_MEMORY.md first, then domains/webdev.md, and optionally 1-2 recent sessions."

**New user message:**
> "Read GLOBAL_MEMORY.md first, then domains/webdev.md, then call list_recent_sessions and read the 2 most recent session files. Then produce the JSON output."

This is a prompt change only — no schema or tool changes.

### Files changed
- `src/agents/prompts.ts` — system prompt wording
- `src/agents/implementation.ts` — user message string

### Tests
- `test/agents/implementation.test.ts` — assert that `list_recent_sessions` is called in the mock sequence

---

## Improvement 5 — AI_MEMORY_REPO_URL documentation + startup check

### Problem
`AI_MEMORY_REPO_URL` is used in `runner.ts` and `telegram.ts` to build clickable GitHub links in Telegram notifications. If unset, notifications show bare file paths instead of links. It's not in `.env.example` or `MEMORY.md`.

### Design
No code change to core logic. Two additions:
1. On server startup (in the `if (process.argv[1] === ...)` block), log a warning if `AI_MEMORY_REPO_URL` is not set: `[warn] AI_MEMORY_REPO_URL not set — Telegram finding links will be bare paths`.
2. Document in `.env.example` and `MEMORY.md`.

### Files changed
- `src/server.ts` — startup warning log
- `.env.example`
- `MEMORY.md`

---

## Improvement 6 — iOS Shortcut documentation polish

### Problem
`shortcuts/README.md` exists with full instructions, but the share-sheet setup section is buried and the "fill in these values" table is easy to miss. The shortcut has never actually been set up.

### Design
Rewrite `shortcuts/README.md` to front-load the two values you need to fill in (Railway URL + auth token) at the very top, before any setup steps. Add a "Quick start" section with the minimum 3-step flow. Keep existing detailed instructions below for reference.

No code changes — documentation only.

### Files changed
- `shortcuts/README.md`

---

## Implementation order

Each improvement is independent. Recommended order for subagent parallelism:

**Batch 1 (parallel — all pure docs/config):**
- Improvement 2: GITHUB_TOKEN docs
- Improvement 5: AI_MEMORY_REPO_URL docs + startup warning
- Improvement 6: iOS Shortcut README rewrite

**Batch 2 (parallel — code changes with tests):**
- Improvement 3: Whisper model env var (Python + .env.example)
- Improvement 4: Implementation agent prompt tweak + test assertion

**Batch 3 (sequential — largest change, depends on stable runner.ts):**
- Improvement 1: Early bail + skipped status + /retry command

---

## Review gate per improvement

Each improvement is reviewed independently before the next batch starts:
- Run `npm test` after every code change
- Run `npx tsc --noEmit` after every TypeScript change
- Reviewer checks: does the change do exactly what it says, nothing more?

---

## Non-goals

- No new API endpoints
- No database / persistence layer changes beyond what hydration already does
- No changes to the finding markdown format
- No Railway deployment (user triggers deploy separately)
