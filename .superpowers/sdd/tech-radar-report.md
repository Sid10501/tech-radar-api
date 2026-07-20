# Tech Radar Social Video Stock Analysis — SDD Report

Date: 2026-07-20  
Branch: `codex/social-video-stock-analysis`  
Status: `DONE_WITH_CONCERNS`

## Scope delivered

- Added the camelCase, versioned `SocialVideoEvidenceV1` Zod contract with schema version/idempotency/origin/source/classification/transcript/visual/extraction/finance-claim fields; max duration 1,800 seconds, max ten securities, bounded arrays/text/timestamps, and untrusted wrapping/redaction for external prose.
- Changed `POST /runs` to validate `url` and `intent`, canonicalize before dedupe/queue, preserve existing auth, and return the synchronously registered run ID.
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
- Verified callback signing uses exactly `timestamp + '.' + rawBody`; event ID is reserved before side effects and released when no matching analysis/run exists.
- Verified canonical dedupe compares canonical forms for both new and legacy hydrated runs while preserving recorded legacy URL display.
- Verified pending rows carry stable run IDs before extraction, downstream rows carry analysis+run IDs, and hydrated downstream rows suppress duplicate handoff.
- Verified external title/creator/transcript/visual/claim/warning text is wrapped/redacted before evidence or model fallback use.
- Verified Telegram downloads use fixed `api.telegram.org` endpoints, reject redirects, bound declared and streamed bytes, validate returned path, generate filenames, and use private file modes.
- Verified existing bearer/cookie auth, webhook secret auth, CORS, security headers, SSRF/DNS restrictions, and full legacy suite remain green.

## Concern

`DONE_WITH_CONCERNS`: the current extraction shell accepts public URLs, not validated local file descriptors/paths. Owner uploads therefore stop at authenticated, bounded, durable `awaiting_media` storage and are never passed to the URL extractor or StockBot. The remaining adapter must preserve duration/byte/time/filename controls and delete media+sidecar after extraction. No cookie/browser/proxy/private-content bypass was added.

## Commit

- `252e971 feat: route social video stock analysis`
- The report is ignored and intentionally not committed.

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
