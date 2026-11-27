# Topic Suggestion Trial Implementation Plan

> Execute inline using the executing-plans workflow. Review the whole change once at the end.

**Goal:** Use and correct topic suggestions inside Radar without triggering downstream work.
**Architecture:** Optional batch file, authenticated review routes, durable feedback and a small native HTML page.
**Tech Stack:** Existing Fastify, TypeScript, Zod, Vitest; no new dependencies.
**Spec:** ../specs/2026-11-27-topic-trial-design.md

## Global Constraints

- Suggestions and confirmations never run research, publish findings or dispatch to StockBot.
- Existing dirty primary checkout stays untouched; implement in the clean decision-lab worktree.
- No automatic paid calls from the trial server. Budgeted offline experiment imports a reproducible batch.
- Preserve model labels as model labels, not human-reviewed truth.

## Review Focus

Unauthorized access, stale inputs or batches, concurrent feedback writes, unsafe source URLs/HTML, and restart persistence.

## Tasks

- [x] Write failing route tests for disabled/authenticated mode, persistence, correction, stale data rejection and invalid batches.
- [x] Implement `src/topicSuggestions.ts` (strict batch schema and feedback store) and `src/topicSuggestionRoutes.ts` (GET queue, POST feedback, GET page); wire server and optional dashboard link.
- [x] Add a simple review UI with keep/change controls, save errors and unconfirmed progress. Browser-check confirmation and correction against an isolated fixture server.
- [x] Freeze, label and run 25 unused intake posts with unchanged prompts; import the resulting suggestions into the local Radar trial.
- [x] Run focused tests, build and full suite; obtain one fresh code review, fix important findings and open the trial.

## Execution record

Ruling: proceed with the requested trial; no new design confirmation is required because the user explicitly chose this workflow and asked to continue fixing issues.

Completed: 463 tests and TypeScript pass. Browser checks pass, including persisted corrections and save failures. Fresh reviewer found no remaining important issue after the partial-write fix. The fresh intake batch selected the existing topic-score policy (16 agreeing suggestions, nine deferrals); these remain model-reviewed results.

Ruling: the local launcher skips normal startup recovery and blocks processing routes, because the normal server attempts to retry historical pending records. An initial isolated startup attempted retries, which failed at missing repository configuration before extraction or API calls. Its copied run state was retained separately as experiment diagnostics; the actual trial uses a fresh feedback directory.

Ruling: append feedback as JSONL instead of rewriting a JSON map. Single-process synchronous writes finish the full buffer, fsync, and roll back partial failures; this preserves history and earlier confirmed feedback.
