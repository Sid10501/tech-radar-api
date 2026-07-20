# Tech Radar Social Video Stock Analysis — SDD Report

Date: 2026-07-20  
Branch: `codex/social-video-stock-analysis`  
Status: `DONE`

## Scope delivered

- Added the camelCase, versioned `SocialVideoEvidenceV1` Zod contract with schema version/idempotency/origin/source/classification/transcript/visual/extraction/finance-claim fields; max duration 1,800 seconds, max ten securities, bounded raw arrays/text/timestamps, and prompt-boundary-only untrusted wrapping.
- Changed `POST /runs` to validate `url` and `intent`, canonicalize before dedupe/queue, require the dedicated dispatch token, honor `Idempotency-Key`, and return the synchronously registered or deduplicated run ID.
- Refactored extraction so vision OCR and link enrichment are performed once and the same enriched result is passed to intent-specific technology/finance handlers. Added deterministic-first routing, explicit overrides, and injectable/model fallback through `ROUTER_MODEL`.
- Added a typed StockBot client for `POST /api/internal/video-evidence`, dedicated bearer token, idempotency header, bounded timeout, snake/camel response aliases, and non-secret error mapping.
- Added finance/mixed handoff with stable `runId:finance-v1` idempotency; Tech Radar only extracts creator claims and does not calculate grades/opinions/verdicts.
- Added `POST /api/internal/stockbot/completion` with raw-body HMAC-SHA256, five-minute replay window, constant-time comparison, persisted event-ID dedupe, run update, deep link, and one concise Telegram side effect per accepted event.
- Extended Telegram intake to text/caption URLs, `/stock`/`/tech`, chat+user authorization, immediate queue acknowledgement, actionable private-content upload guidance, and owner file intake with 20 MB pre/post/stream bounds, generated filenames, fixed Telegram hosts, redirects disabled, `0600` files, sidecar lifecycle persistence, and orphan cleanup on registration failure.
- Extended INBOX lifecycle metadata so pending run IDs and StockBot analysis IDs survive hydration; `running` recovers to `pending`, and active rows transition in place.
- Documented all requested environment variables and limits in `.env.example` and `README.md`.

## Files changed

Production/config/docs:

- `.env.example`
- `README.md`
- `src/git.ts`
- `src/runner.ts`
- `src/server.ts`
- `src/telegram.ts`
- `src/schemas/socialVideoEvidence.ts`
- `src/socialVideoRouting.ts`
- `src/stockbotClient.ts`
- `src/stockbotCallback.ts`

Tests:

- `test/server.test.ts`
- `test/runner.socialVideo.test.ts`
- `test/socialVideoEvidence.test.ts`
- `test/socialVideoRouting.test.ts`
- `test/stockbotClient.test.ts`
- `test/stockbotCallback.test.ts`
- `test/telegram.socialVideo.test.ts`

## TDD RED/GREEN evidence

Baseline:

- `npm test -- --reporter=dot` → 25 files, 229 tests passed.

Cycle 1 — contract/routing/client/callback primitives:

- RED: `npx vitest run test/socialVideoEvidence.test.ts test/socialVideoRouting.test.ts test/stockbotClient.test.ts test/stockbotCallback.test.ts --reporter=verbose` → four missing-module failures, expected because production modules did not exist.
- GREEN: same command → 4 files, 14 tests passed.

Cycle 2 — shared runner routing, canonical registration, recovery, actual run ID:

- RED: `npx vitest run test/runner.socialVideo.test.ts test/server.test.ts --reporter=verbose` → seven expected failures: missing runner functions, unrecovered lifecycle, stale/invalid `/runs` behavior.
- GREEN: same command → 2 files, 39 tests passed.

Cycle 3 — signed completion route:

- RED: `npx vitest run test/server.test.ts -t 'StockBot completion callback' --reporter=verbose` → three expected 404 route failures.
- GREEN: same command → 3 callback tests passed.

Cycle 4 — Telegram social-video intake/file boundary:

- RED: `npx vitest run test/telegram.socialVideo.test.ts --reporter=verbose` → five expected missing-behavior failures.
- GREEN: Telegram suite → 5 tests passed; related server suite updated for origin metadata.

Cycle 5 — malformed URL validation:

- RED: `npx vitest run test/server.test.ts -t 'malformed and non-http' --reporter=verbose` → expected HTTP 500 vs 400.
- GREEN: covered by final complete suite after canonicalization moved into a validation block.

## Verification

Fresh final command:

```text
git diff --check && npm run build && npm test -- --reporter=dot && git status --short
```

Results:

- `git diff --check`: clean.
- `npm run build`: `tsc` exit 0.
- `npm test -- --reporter=dot`: 31 files passed, 258 tests passed, 0 failures.
- Security-boundary grep found no broker/order execution imports or Tech Radar verdict implementation. Existing SSRF/private-network tests remain in the passing full suite.

## Self-review

- Verified StockBot bearer token is separate from `AUTH_TOKEN` and never included in mapped errors.
- Verified callback signing uses exactly `timestamp + '.' + rawBody`; event ID moves atomically from `pending` to `applied`, is released on application failure, and is correlated by both run and analysis IDs.
- Verified canonical dedupe compares canonical forms for both new and legacy hydrated runs while preserving recorded legacy URL display.
- Verified pending rows carry stable run IDs before extraction, downstream rows carry analysis+run IDs, and hydrated downstream rows suppress duplicate handoff.
- Verified shared evidence preserves bounded raw title/creator/transcript/visual/claim/warning text; existing LLM prompt builders remain the only untrusted-content wrapping boundary.
- Verified Telegram downloads use fixed `api.telegram.org` endpoints, reject redirects, bound declared and streamed bytes, validate returned path, generate filenames, and use private file modes.
- Verified existing bearer/cookie auth, webhook secret auth, CORS, security headers, SSRF/DNS restrictions, and full legacy suite remain green.

## Historical concern (resolved)

The original implementation was `DONE_WITH_CONCERNS` because uploads stopped at `awaiting_media`. This is resolved by the validated local-file adapter, bounded duration probing, local Whisper/OCR path, durable recovery, and terminal cleanup described in the correction history below. No cookie/browser/proxy/private-content bypass was added.

## Commit

- `252e971 feat: route social video stock analysis`
- `d81f7ff fix: complete social video integration boundaries`
- `233fcd8 fix: close social video recovery and upload gaps`
- `251605b fix: finalize social video duration and attribution`
- This ignored report was intentionally force-added and committed with the correction history.

## 2026-07-20 second-review correction

Status: `DONE`

The follow-up closes the remaining integration and restart boundaries:

- Local extraction resolves `extract_post.py` from both source (`src`) and compiled Docker (`dist/src`) layouts, accepts injected execution/resolution in tests, probes duration, and uses a caller-created per-run output directory.
- The runner passes `--out-dir` for URL and upload extraction and removes all frames/OCR/output artifacts only after vision/link enrichment and routing finish, on success and failure.
- Inbox hydration merges rather than overwrites richer durable run records; sidecars restore upload path, intent, origin, idempotency key, and analysis ID before exactly one enqueue.
- Persisted classification and processed branches make dedupe intent-aware: auto-tech does not block later explicit finance, while completed finance does.
- Finance claim attribution is per matching ticker/company/exchange block. Ambiguous company-stock mentions remain low-confidence `stock`/`etf` identities for StockBot review, never `unsupported`.
- Callback status, claim grade, and opinion are exact enums. `completed`, `partial`, `failed`, and `canceled` all map to terminal Tech Radar states.
- Callback replay state and direct-upload ticket consumption live under `RUN_STATE_DIR` when configured.
- Multipart requires the `file` field, validates origin/IDs, and preserves StockBot upload idempotency through evidence handoff.
- Direct browser upload uses a short-lived, exact-field/size-bound, one-time HMAC ticket in `X-StockBot-Upload-Token`, with endpoint-only exact-origin CORS. Existing service Bearer upload remains supported.

Dashboard adjudication: the requested owner upload dashboard is StockBot. Tech Radar intentionally exposes only `/runs/upload`; adding a second Tech Radar upload UI would duplicate the owner workflow and is out of scope.

### RED/GREEN evidence

- RED: `npx vitest run test/localMedia.test.ts test/stockbotCallback.test.ts test/runner.socialVideo.test.ts --reporter=dot` → four expected failures for missing compiled-path resolution, broad callback strings, copied multi-security claims, and auto-intent over-deduplication.
- GREEN: the same focused suites passed after resolver injection, exact enums, scoped attribution, and processed-branch dedupe.
- RED: `npx vitest run test/uploadAuthorization.test.ts --reporter=dot` → missing upload authorization module.
- GREEN: upload token unit tests and signed dashboard upload/CORS/replay/mismatch server tests passed.
- Recovery tests prove richer upload state survives inbox hydration and is enqueued once with exact intent/origin/media/idempotency/analysis fields.
- Runner E2E tests create extraction artifacts and assert their per-run directory is absent after both success and extraction failure.

### Final verification

- `git diff --check` → clean.
- `npx tsc --noEmit` → exit 0.
- `npm test` → 33 files, 276 tests passed, 0 failures.
- `npm run build` → exit 0.
- `npm audit --omit=dev` → 0 vulnerabilities.

## Final review correction

- Public and uploaded media over 1,800 seconds now terminate as `skipped` with typed `duration_limit`; evidence construction rejects rather than clamps, while valid fractional durations round to the integer contract. yt-dlp `match_filter` prevents downloads when oversized duration metadata is known.
- Caption, transcript, and visual prose is split into bounded sentence/line claim blocks. Multi-security attribution matches only symbol or normalized company name—never a shared exchange—and unscoped blocks are used only for one security.
- Named ambiguous identities such as `Apple stock`, `Acme Corp shares`, and named ETFs carry low-confidence `companyName` without an invented symbol.
- Active auto runs block concurrent explicit finance extraction; completed auto-tech runs allow a later finance pass.
- Startup removes retained media, sidecars, and extraction work directories for terminal/downstream runs and clears stale work directories before retrying active runs.
- Upload CORS now matches the exact `/runs/upload` pathname. Unknown and repeated multipart fields/files are rejected.

RED: focused runner/extractor/server suites produced eight expected failures covering each review item. GREEN: the same suites passed after the corrections. Final suite/build/audit results are recorded below after the last verification run.

### Final verification after final review

- `git diff --check` → clean.
- `npx tsc --noEmit` → exit 0.
- `npm test` → 33 files, 283 tests passed, 0 failures.
- `npm run build` → exit 0.
- `npm audit --omit=dev` → 0 vulnerabilities.

## Narrow-review correction

- Named stock and ETF matching now runs globally alongside symbol extraction, retaining multiple unresolved company names while deduplicating names directly paired with a ticker.
- Persisted cleanup paths are treated as untrusted. Media deletion requires regular non-symlink media and sidecar files directly under `MEDIA_UPLOAD_DIR`, with sidecar ownership matching the run. Extraction deletion requires a regular non-symlink directory directly under the dedicated `EXTRACTION_WORK_ROOT` and a run-specific managed name.
- Terminal cleanup clears both persisted artifact paths after safe cleanup. A stale terminal record cannot delete a newer upload whose sidecar belongs to a different run.

RED: the focused runner suite produced four expected failures for mixed symbol/company extraction, persisted stale paths, outside-path deletion, and old-run/new-upload collision. A same-block identity test separately demonstrated over-broad symbol/name deduplication before the adjacency fix. GREEN: all 20 focused runner tests pass.

### Final verification after narrow review

- `git diff --check` → clean.
- `npx tsc --noEmit` → exit 0.
- `npm test` → 33 files, 287 tests passed, 0 failures.
- `npm run build` → exit 0.
- `npm audit --omit=dev` → 0 vulnerabilities.

## Final cross-repository integration correction

Status: `DONE`

- `POST /runs` now uses only `STOCKBOT_DISPATCH_TOKEN`, never browser cookies, `AUTH_TOKEN`, or query tokens. It honors `Idempotency-Key`, returns the existing run with `202`/`deduplicated: true` for the same canonical source and exact intent, and does not let `force` bypass finance deduplication.
- Signed uploads require an exact allowlisted `Origin` and return endpoint-scoped CORS. Dedicated-token service uploads may omit `Origin`. A browser ticket is consumed only after durable run registration, so registration failure remains retryable.
- Callback payloads require both `runId` and `analysisId`, accept terminal `needs_review`, and reserve event IDs cross-process with event-specific atomic filesystem creation. State advances from `pending` to `applied` only after exact-run application, durable INBOX commit/push, and notification; application failure releases the reservation for retry.
- Pending callback reservations expire after a bounded interval so a process crash cannot permanently suppress retries; applied reservations remain durable. Signed upload tickets use the same atomic begin/apply/rollback lifecycle.
- Production startup rejects missing, default, or temporary `RUN_STATE_DIR` values so replay and run state cannot silently become ephemeral.
- StockBot dedupe responses adopt the originating run. Terminal responses immediately set the matching terminal Tech Radar state and notify with the returned detail link; nonterminal cross-run reuse does not create a second `downstream_pending` run.
- A nonterminal cross-run reuse marks only the shadow Tech Radar run `skipped`/deduplicated and keeps the originating run as the active downstream owner; it never falsely reports the Stock analysis as processed.
- The shared evidence contract stores bounded raw prose. Subtitle/API/Whisper segment timestamps are preserved, and deterministic whole-video compaction samples across the entire video while retaining late claims within the 3,600-segment/120,000-character aggregate bounds.
- Upload evidence preserves the original filename and uses the required `platform: "upload"` source with an internal HTTPS sentinel while retaining required source URL/canonical fields.
- Shared strings reject whitespace-only values without trimming or otherwise mutating valid surrounding whitespace. `needs_review` notifications use an action-required warning and retain the detail link.
- The shared fixture is byte-identical to StockBot's fixture. SHA-256: `e84e0db0dcc5d1ea3e018fc3c1dca2957b8cd3a8f5d1242eb306b4dcd95489ef`.

### RED/GREEN evidence

- RED: the six focused suites initially produced 16 expected failures covering raw evidence, transcript timestamps/whole-video retention, dispatch isolation/idempotency, exact callback correlation/two-phase retry, exact upload Origin, and post-registration ticket consumption.
- GREEN: the same six suites passed all 96 tests after the final integration changes.
- Cross-repository fixture verification compared exact bytes and SHA-256 against `/Users/work/.codex/worktrees/abe3/stocks/backend/tests/fixtures/social_video_evidence_v1.json`.

### Final verification after cross-repository integration

- `git diff --check` → clean.
- `npx tsc --noEmit` → exit 0.
- `npm test` → 33 files, 306 tests passed, 0 failures.
- `npm run build` → exit 0.
- `npm audit --omit=dev` → 0 vulnerabilities.
- Exact fixture byte comparison and both SHA-256 checks matched.
