# StockBot Final Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Tech Radar's StockBot dispatch, upload, callback, and evidence contracts retry-safe, durable, raw-text preserving, and byte-compatible with StockBot.

**Architecture:** Keep API authorization and idempotency decisions at route/registration boundaries, keep durable run state in `RUN_STATE_DIR`, and correlate callbacks by both Tech Radar run ID and StockBot analysis ID. Preserve bounded raw evidence in the shared schema and apply untrusted-content wrapping only in existing LLM prompt builders.

**Tech Stack:** TypeScript, Fastify, Zod, Vitest, filesystem-backed JSON state, simple-git.

## Global Constraints

- Use TDD for every behavioral change.
- Do not push.
- Signed browser uploads require exact allowlisted Origin; service Bearer uploads may omit it.
- Production callback/run state must be persistent and must not use a default or `/tmp` path.
- Shared evidence fixture path is `test/fixtures/social_video_evidence_v1.json` and its bytes must match StockBot's corresponding fixture.

---

### Task 1: Dispatch authorization and idempotency

**Files:** Modify `src/server.ts`, `src/runner.ts`, `.env.example`, `README.md`; test `test/server.test.ts`, `test/runner.socialVideo.test.ts`.

**Interfaces:** `RunPipelineOptions.idempotencyKey?: string`; persisted `Run.submissionIdempotencyKey?: string`; `DuplicateRunError.idempotent`; route header `Idempotency-Key`; route token `STOCKBOT_DISPATCH_TOKEN`.

- [x] Write tests proving dispatch-token isolation, removal of query-token auth, and same canonical URL+intent returns 202 with the existing run and `deduplicated: true` even when forced.
- [x] Run `npx vitest run test/server.test.ts test/runner.socialVideo.test.ts --reporter=dot` and confirm the new assertions fail.
- [x] Implement route-scoped authorization, persisted key matching before force handling, and deduplicated response mapping.
- [x] Re-run the focused tests and confirm they pass.

### Task 2: Transactional browser upload

**Files:** Modify `src/server.ts`, `src/stockbotCallback.ts`; test `test/server.test.ts`, `test/stockbotCallback.test.ts`.

**Interfaces:** `StockBotEventDeduper.has(id)`, `record(id)`, and `forget(id)`; signed upload token is recorded only after `runMediaPipeline` synchronously registers durable state.

- [x] Write tests proving signed POST rejects missing/disallowed Origin, allowed POST returns matching CORS, service Bearer may omit Origin, and failed registration does not consume a ticket.
- [x] Run the focused server tests and confirm failure.
- [x] Implement exact Origin enforcement and post-registration ticket recording with rollback-safe ordering.
- [x] Re-run focused tests and confirm pass.

### Task 3: Durable, correlated callbacks

**Files:** Modify `src/stockbotCallback.ts`, `src/server.ts`, `src/runner.ts`, `src/git.ts`; test `test/stockbotCallback.test.ts`, `test/server.test.ts`, `test/runner.socialVideo.test.ts`, `test/git.test.ts`.

**Interfaces:** callback requires `runId`; status includes `needs_review`; atomic dedupe state records `pending` then `applied`; `applyStockBotCompletion` matches both `runId` and `analysisId`; callback persistence uses `AiMemoryRepo.updateInbox` plus commit/push when configured.

- [x] Write tests for reused analysis IDs, `needs_review`, detail links, apply failure retry, atomic persistence, production RUN_STATE_DIR rejection, and durable INBOX Git commit.
- [x] Run focused tests and confirm failures are due to missing correlation/durability.
- [x] Implement two-phase atomic event recording, rollback on failure, exact run correlation, and async durable INBOX updates through `AiMemoryRepo`.
- [x] Re-run focused tests and confirm pass.

### Task 4: Raw shared evidence and whole-video segments

**Files:** Modify `src/schemas/socialVideoEvidence.ts`, `src/extract.ts`, `src/runner.ts`, `scripts/extract_post.py`, `test/fixtures/social_video_evidence_v1.json`; test `test/socialVideoEvidence.test.ts`, `test/runner.socialVideo.test.ts`, `test/extractPostScript.test.ts`.

**Interfaces:** `ExtractResult.transcript_segments?: Array<{start_ms:number;end_ms:number;text:string}>`; schema strings are bounded raw text; evidence samples bounded claims across all blocks without first-100 truncation.

- [x] Write tests proving raw strings survive byte-for-byte, timestamps remain intact, late-video claims are represented, and the fixture's exact bytes are stable.
- [x] Run focused tests and confirm failures.
- [x] Replace schema transforms with bounded raw strings, emit transcript segments from subtitle/Whisper extraction, and select claim blocks evenly across the full video.
- [x] Re-run focused tests and confirm pass.

### Task 5: Terminal handoff and upload metadata

**Files:** Modify `src/stockbotClient.ts`, `src/runner.ts`, `src/localMedia.ts`; test `test/stockbotClient.test.ts`, `test/runner.socialVideo.test.ts`, `test/localMedia.test.ts`.

**Interfaces:** StockBot submission accepts optional `detailUrl`; deduplicated terminal statuses map to terminal Tech Radar statuses; upload evidence source uses filename metadata and a non-clickable internal source URL.

- [x] Write tests for deduplicated completed/partial/failed/canceled/needs_review responses and upload filename/non-fake URL evidence.
- [x] Run focused tests and confirm failures.
- [x] Implement terminal mapping/notification/linking and persist original upload metadata into run/evidence construction.
- [x] Re-run focused tests and confirm pass.

### Task 6: Documentation, report, and verification

**Files:** Modify `.superpowers/sdd/tech-radar-report.md`, `.env.example`, `README.md`.

- [x] Update configuration, shared fixture coordination, RED/GREEN history, and the final report status.
- [x] Run `git diff --check && npx tsc --noEmit && npm test && npm run build && npm audit --omit=dev` and require zero failures/vulnerabilities.
- [x] Review the complete diff for secrets, broad deletion, fake URLs, unwrapped LLM inputs, and cross-contract drift.
- [x] Commit all scoped files with an explicit message and confirm `git status --porcelain` is empty.
