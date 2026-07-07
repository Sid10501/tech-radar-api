# Public Findings Feed — Portfolio Integration Gap-Fill

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-07-06
**Intent:** The portfolio site (Sid10501/portfolio) will consume the public findings feed as a `/radar` blog section. The core public payload already exists (`/api/public/findings`, `/api/public/findings/:id`, `listPublicFindings()`, `getPublicFindingDetail()` + `withoutPrivateSections()` — shipped in the audit-completion work, main @ `1d41638`, 152 tests green). This plan fills the remaining gaps only. TDD: every task writes its failing tests first.

**Validation gate (kun workflow / no-mistakes):** intent above; tests+build green; docs updated; adversarial review (code-review skill + independent read-only validator with acceptance criteria only); evidence in commit message.

**Acceptance criteria (for the independent validator):**
1. `GET /api/public/findings` items expose `applied: null | { appliedAt, link, note? }` sourced from `tech-radar/applied.json` in the ai-memory checkout; missing/corrupt file degrades to `applied: null` for all, no crash.
2. `GET /api/public/findings/rss` returns HTTP 200 `application/rss+xml; charset=utf-8`, valid RSS 2.0 (channel title/link/description; ≤20 newest items with title, link to portfolio radar URL base [env `PUBLIC_SITE_RADAR_BASE`, fallback dashboard URL], pubDate RFC-822, guid); XML-escapes `& < > " '` in all text fields.
3. `/api/public/*` responses carry `Access-Control-Allow-Origin` ONLY when the request Origin is in env `PUBLIC_FEED_ALLOWED_ORIGINS` (comma-separated); private/auth routes never carry CORS headers; no wildcard.
4. No response from any `/api/public/*` route contains the strings "Fit for Sid", "## Implementation Idea", or "## Follow-ups" (leak regression).
5. `npm run check` (or `npm run build`) and `npm test` pass; README env table documents the new env vars; a release-notes entry exists for the feed.

## Task 1: `applied` mapping

- [x] Test first (`test/applied.test.ts` + extend `test/findings.test.ts`/server tests): fixture `applied.json` in the test ai-memory dir maps one finding slug → `{appliedAt, link}`; assert summary + detail expose it; assert missing file / invalid JSON → `applied: null`, warning logged, no throw.
- [x] Implement `src/applied.ts` (`loadAppliedMap(aiMemoryDir)`) consumed by `toPublicFinding`; extend `PublicFindingSummary`.
- [x] Seed real `tech-radar/applied.json` in ai-memory (separate repo commit): `20260514-...` → brand mockup/UI template, `2026-06-28-ketan-...` + kun audit → this workflow, `2026-05-19-...fli...` → the live radar feed itself.

## Task 2: RSS 2.0 endpoint

- [x] Test first (`test/rss.test.ts`): valid channel/items against fixture findings; escaping test with `&`, `<`, `"` in a title; ≤20 items newest-first; correct content-type; 200 even with zero findings (empty channel).
- [x] Implement `src/rss.ts` (`buildRssXml(findings, opts)` pure function, hand-built XML, no new deps) + `GET /api/public/findings/rss` route in `src/server.ts`.

## Task 3: CORS for public routes only

- [x] Test first (extend `test/server.test.ts`): allowed Origin echoed on `/api/public/findings`; disallowed/absent Origin → no ACAO header; `/api/findings` (auth) never has ACAO; OPTIONS preflight on public routes → 204 with allowed methods GET.
- [x] Implement via `onRequest`/`onSend` hook scoped to `/api/public/` prefix reading `PUBLIC_FEED_ALLOWED_ORIGINS` (no @fastify/cors dep).

## Task 4: leak regression + docs

- [x] Test first: server-level test asserting the private-section strings never appear in `/api/public/findings/:id` markdown for a fixture containing all three sections (may already exist — extend, don't duplicate).
- [x] README: env table rows for `PUBLIC_FEED_ALLOWED_ORIGINS`, `PUBLIC_SITE_RADAR_BASE`; note applied.json contract.
- [x] `release-notes.md`: entry "Public feed: RSS + applied mapping + scoped CORS".

## Out of scope
- Pagination/ETag (payload is small; existing no-store hardening stands — portfolio consumes at build time via ISR).
- Dashboard UI changes.
