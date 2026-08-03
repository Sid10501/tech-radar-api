# Tech Radar production cache and asset polish

**Status:** Approved for implementation
**Date:** 2026-07-25
**Branch:** `codex/production-polish`
**Base:** `origin/main` at `80f807a`

## Context

Production verification on 2026-07-25 showed:

- `/robots.txt`, `/favicon.ico`, and `/apple-touch-icon.png` each return
  `404` with `Cache-Control: no-store, max-age=0`.
- `/api/public/findings` returns `200`, takes 3.45 seconds in the measured
  request, and also sends `Cache-Control: no-store, max-age=0`.
- The server currently installs `no-store` globally, which is the correct
  default for dashboard HTML, authentication, private, admin, upload, run,
  webhook, and callback responses.
- Portfolio radar content regenerates hourly, so a five-minute shared-cache
  lifetime preserves substantially tighter freshness than the downstream ISR
  interval.

This PR removes the known harmless asset-request noise and adds bounded HTTP
caching for already-sanitized public reads. It does not add an in-process data
cache, change finding parsing, alter API bodies, or touch dependencies.

## Goals

1. Eliminate the three known production 404s without introducing a visual
   redesign or binary asset pipeline.
2. Let browsers and shared HTTP caches reuse sanitized public read responses
   for a short, explicit interval.
3. Keep all private and stateful surfaces uncacheable.
4. Preserve exact-origin public CORS behavior under shared caching.
5. Keep public content comfortably fresher than the hourly portfolio ISR.

## Non-goals

- No in-memory response or finding cache.
- No ETag implementation or conditional-request subsystem.
- No icon branding or dashboard reskin.
- No route-body, schema, authentication, or authorization changes.
- No dependency or Docker changes.
- No deployment from this branch; delivery ends with one reviewable draft PR.

## Route behavior

### Metadata and icon requests

Add three explicit GET routes:

- `GET /robots.txt`
  - `200`
  - `Content-Type: text/plain; charset=utf-8`
  - Body:

    ```text
    User-agent: *
    Disallow: /api/
    Disallow: /runs
    Disallow: /telegram/
    ```

  - Root dashboard remains indexable. The disallow rules are crawler hints,
    not security controls.

- `GET /favicon.ico`
- `GET /apple-touch-icon.png`
  - `204`, empty body
  - No branding asset is added in this operational PR.
  - The explicit empty response removes log noise while reserving real icon
    design for a visual change.

All three metadata routes send:

```text
Cache-Control: public, max-age=86400
```

They retain the existing security headers.

### Sanitized public API reads

The following successful GET responses send:

```text
Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=3600
Vary: Origin
```

Routes:

- `/api/public/findings`
- `/api/public/findings/:id`
- `/api/public/audit`
- `/api/public/release-notes`
- `/api/public/findings/rss`

The policy means:

- A browser may reuse a response for 60 seconds.
- A shared cache may serve it fresh for five minutes.
- A shared cache may serve stale content while revalidating for up to one
  hour.

This is HTTP response caching only. Every origin request still follows the
existing AI-memory synchronization, parsing, sanitization, and error paths.

### CORS cache correctness

Every `/api/public/` response varies by `Origin`, whether the request has an
allowed, disallowed, or absent origin. `Access-Control-Allow-Origin` remains
present only for exact values in `PUBLIC_FEED_ALLOWED_ORIGINS`; it is never a
wildcard.

Public `OPTIONS` responses remain `204` and `no-store`. The cache policy is
limited to GET route handlers, not the public path prefix as a whole.

### Private and stateful routes

The global default remains:

```text
Cache-Control: no-store, max-age=0
```

It must continue to apply to:

- `/` and `/?token=...`
- `/healthz` and `/api/session`
- `/api/unlock`
- `/api/findings`, `/api/findings/:id`, and `/api/audit`
- `/api/admin/*`
- `/runs`, `/runs/*`, and `/runs/upload`
- `/telegram/webhook`
- `/api/internal/*`
- errors and unknown routes

Public-route error responses also remain `no-store`; the public cache header
is applied only after successful route work.

## Implementation shape

Keep the change in `src/server.ts` and `test/server.test.ts`.

Add named cache-control constants and a small helper that applies the public
GET policy after a successful route result is known. Preserve the global
security/no-store hook as the fail-closed default. Update the public CORS hook
to set `Vary: Origin` unconditionally for its path scope while keeping
allow-origin conditional.

Metadata routes are direct Fastify handlers. No static-file plugin, filesystem
asset lookup, base64 payload, or runtime dependency is introduced.

## Error handling and security

- If a public list/detail/audit/release-notes/RSS handler throws or returns an
  error, the existing global `no-store` value remains.
- Missing public finding details remain `404` and `no-store`.
- Unauthorized private/admin requests remain `401` and `no-store`.
- CORS allowlisting remains exact and does not authorize access to private
  routes.
- `robots.txt` is informational only and does not replace authentication.
- Empty icon responses disclose no runtime or user data.

## Test strategy

Use test-first changes in `test/server.test.ts`.

Focused contract tests must prove:

1. Robots and both icon paths return the exact statuses, body/content type,
   security headers, and one-day cache policy.
2. Every named successful public GET route returns the exact public cache
   policy and `Vary: Origin`.
3. An allowed origin receives its exact allow-origin value; disallowed and
   absent origins do not; all three cases include `Vary: Origin`.
4. Public `OPTIONS` remains `204` and `no-store`.
5. A missing public detail remains `404` and `no-store`.
6. Root, tokenized root, health, session, private list/detail/audit, admin,
   runs, upload, webhook, internal callback, and unknown routes retain
   `no-store`.
7. Public response bodies and private-field sanitization are unchanged.

Full verification:

```bash
npm test -- --no-file-parallelism --testTimeout=30000
npm run build
npm audit
git diff --check
```

The explicit test timeout supplies local headroom for existing Git fixtures;
it does not modify project configuration.

## Browser and HTTP smoke

Run the built server locally on port 3102 and verify:

- `/` renders the dashboard without console errors.
- `/robots.txt` returns its exact text.
- Icon requests return `204` without console or server errors.
- Public list, detail, audit, release notes, and RSS return the public policy.
- A public list request with an allowed origin receives exact CORS plus
  `Vary: Origin`.
- Private/admin routes without auth remain `401` and `no-store`.
- At least one mobile and one desktop dashboard viewport still load.

No production deployment is part of this PR. The draft PR body records the
current production before-state, local after-state, exact test count, audit
result, and browser/HTTP evidence.

## Acceptance criteria

- Only the design, implementation plan, `src/server.ts`, and
  `test/server.test.ts` differ from `origin/main`.
- The three noisy paths no longer return `404`.
- All five successful public GET surfaces use the exact bounded cache policy.
- CORS variance is safe for shared caches.
- All private, admin, stateful, error, and unknown responses remain
  `no-store`.
- No dependencies, API bodies, finding data, or auth boundaries change.
- Full tests, build, browser/HTTP smoke, task review, and whole-branch review
  pass before one draft PR is opened.
