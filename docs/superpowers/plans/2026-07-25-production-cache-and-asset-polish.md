# Tech Radar Production Cache and Asset Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the known robots/icon 404 noise and add bounded, CORS-safe HTTP caching to sanitized public reads while every private, stateful, and error response remains uncacheable.

**Architecture:** Preserve the global security and `no-store` hook as the fail-closed default. Add direct metadata routes plus one public-cache helper that successful public GET handlers call only after their work succeeds; make public CORS responses always vary by `Origin`. No in-memory cache, static-file plugin, route-body change, or dependency is introduced.

**Tech Stack:** Node.js 20, TypeScript, Fastify, Vitest, native HTTP caching headers, Playwright CLI

## Global Constraints

- Work only in `/Users/work/Repositories/.worktrees/tech-radar-production-polish` on `codex/production-polish`, based on `origin/main` at `80f807a`.
- Keep production and test changes inside `src/server.ts` and `test/server.test.ts`; only this design and plan may be added.
- Introduce no dependency, static-file plugin, binary asset, Docker change, API-body change, finding-data mutation, or authentication/authorization change.
- Keep `Cache-Control: no-store, max-age=0` as the global fail-closed default.
- Metadata routes use exactly `Cache-Control: public, max-age=86400`.
- Successful sanitized public GET routes use exactly `Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=3600`.
- Cacheable public routes are exactly `/api/public/findings`, `/api/public/findings/:id`, `/api/public/audit`, `/api/public/release-notes`, and `/api/public/findings/rss`.
- Every `/api/public/` response includes `Vary: Origin`; `Access-Control-Allow-Origin` remains exact-allowlist-only and never `*`.
- Public `OPTIONS`, missing public details, dashboard HTML, health/session, private/admin, run/upload, webhook, internal callback, error, and unknown responses remain `no-store`.
- `/robots.txt` returns the approved crawler hints; `/favicon.ico` and `/apple-touch-icon.png` return empty `204` responses.
- Use test-first changes and commit each independently reviewable task separately.
- Do not deploy this branch; finish with one draft PR against `main`.

---

### Task 1: Add explicit metadata and icon responses

**Files:**
- Modify: `test/server.test.ts:45-126`
- Modify: `src/server.ts:24-28`
- Modify: `src/server.ts:258-280`

**Interfaces:**
- Consumes: existing `SECURITY_HEADERS`, global `NO_STORE_CACHE_CONTROL`, and Fastify `reply.header()`
- Produces: `METADATA_CACHE_CONTROL: string`, `ROBOTS_TEXT: string`, and GET handlers for `/robots.txt`, `/favicon.ico`, `/apple-touch-icon.png`

- [ ] **Step 1: Add failing metadata-route tests**

In `test/server.test.ts`, add the exact cache constant beside
`EXPECTED_CACHE_CONTROL`:

```ts
const EXPECTED_METADATA_CACHE_CONTROL = "public, max-age=86400";
```

Add these tests after the health check:

```ts
it("serves crawler guidance with a bounded metadata cache", async () => {
  const res = await app.inject({ method: "GET", url: "/robots.txt" });

  expect(res.statusCode).toBe(200);
  expectSecurityHeaders(res.headers);
  expect(res.headers["content-type"]).toBe("text/plain; charset=utf-8");
  expect(res.headers["cache-control"]).toBe(EXPECTED_METADATA_CACHE_CONTROL);
  expect(res.body).toBe(
    "User-agent: *\n"
      + "Disallow: /api/\n"
      + "Disallow: /runs\n"
      + "Disallow: /telegram/\n",
  );
});

it.each(["/favicon.ico", "/apple-touch-icon.png"])(
  "answers %s without a noisy 404",
  async (url) => {
    const res = await app.inject({ method: "GET", url });

    expect(res.statusCode).toBe(204);
    expectSecurityHeaders(res.headers);
    expect(res.headers["cache-control"]).toBe(EXPECTED_METADATA_CACHE_CONTROL);
    expect(res.body).toBe("");
  },
);
```

- [ ] **Step 2: Run the focused tests and confirm the routes are absent**

Run:

```bash
npm test -- --run test/server.test.ts -t "crawler guidance|without a noisy 404"
```

Expected: three failures with current `404` responses and the default
`no-store` header.

- [ ] **Step 3: Add constants and direct Fastify handlers**

In `src/server.ts`, place these values with the existing cache constant:

```ts
const NO_STORE_CACHE_CONTROL = "no-store, max-age=0";
const METADATA_CACHE_CONTROL = "public, max-age=86400";
const ROBOTS_TEXT = [
  "User-agent: *",
  "Disallow: /api/",
  "Disallow: /runs",
  "Disallow: /telegram/",
  "",
].join("\n");
```

Add the routes between `/healthz` and `/api/unlock`:

```ts
app.get("/robots.txt", async (_request, reply) => {
  reply.header("Content-Type", "text/plain; charset=utf-8");
  reply.header("Cache-Control", METADATA_CACHE_CONTROL);
  return ROBOTS_TEXT;
});

app.get("/favicon.ico", async (_request, reply) => {
  reply.header("Cache-Control", METADATA_CACHE_CONTROL);
  return reply.code(204).send();
});

app.get("/apple-touch-icon.png", async (_request, reply) => {
  reply.header("Cache-Control", METADATA_CACHE_CONTROL);
  return reply.code(204).send();
});
```

Do not add a favicon link, binary data, filesystem lookup, or static-file
plugin.

- [ ] **Step 4: Run focused and server tests**

Run:

```bash
npm test -- --run test/server.test.ts -t "crawler guidance|without a noisy 404"
npm test -- --run test/server.test.ts
git diff --check
```

Expected: metadata tests pass, all server tests pass, and the whitespace check
is clean.

- [ ] **Step 5: Commit the metadata behavior**

```bash
git add src/server.ts test/server.test.ts
git commit -m "fix: answer dashboard metadata requests"
```

---

### Task 2: Add bounded public caching with safe CORS variance

**Files:**
- Modify: `test/server.test.ts:45-440`
- Modify: `src/server.ts:1`
- Modify: `src/server.ts:24-28`
- Modify: `src/server.ts:244-256`
- Modify: `src/server.ts:458-485`

**Interfaces:**
- Consumes: `FastifyReply`, `publicFeedAllowedOrigins()`, global `NO_STORE_CACHE_CONTROL`, and the five existing public GET route handlers
- Produces: `PUBLIC_READ_CACHE_CONTROL: string` and `setPublicReadCache(reply: FastifyReply): void`

- [ ] **Step 1: Add exact public/private cache expectations**

In `test/server.test.ts`, add:

```ts
const EXPECTED_PUBLIC_CACHE_CONTROL =
  "public, max-age=60, s-maxage=300, stale-while-revalidate=3600";
```

Change the successful public assertions at the existing list, audit,
release-note, and public-detail tests from `EXPECTED_CACHE_CONTROL` to
`EXPECTED_PUBLIC_CACHE_CONTROL`.

Add this RSS and error-boundary coverage near the other public route tests:

```ts
it("uses the bounded public policy for RSS", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "server-public-rss-cache-"));
  const previousDir = process.env["AI_MEMORY_LOCAL_DIR"];
  fs.mkdirSync(path.join(dir, "tech-radar", "findings"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "tech-radar", "findings", "sample.md"),
    "# RSS cache sample\n\n## TL;DR\n\nPublic feed item.",
  );
  process.env["AI_MEMORY_LOCAL_DIR"] = dir;

  try {
    const res = await app.inject({ method: "GET", url: "/api/public/findings/rss" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe(EXPECTED_PUBLIC_CACHE_CONTROL);
    expect(res.headers["vary"]).toContain("Origin");
  } finally {
    if (previousDir === undefined) delete process.env["AI_MEMORY_LOCAL_DIR"];
    else process.env["AI_MEMORY_LOCAL_DIR"] = previousDir;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

it("keeps missing public details uncacheable", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "server-public-missing-cache-"));
  const previousDir = process.env["AI_MEMORY_LOCAL_DIR"];
  fs.mkdirSync(path.join(dir, "tech-radar", "findings"), { recursive: true });
  process.env["AI_MEMORY_LOCAL_DIR"] = dir;

  try {
    const res = await app.inject({ method: "GET", url: "/api/public/findings/missing.md" });
    expect(res.statusCode).toBe(404);
    expect(res.headers["cache-control"]).toBe(EXPECTED_CACHE_CONTROL);
    expect(res.headers["vary"]).toContain("Origin");
  } finally {
    if (previousDir === undefined) delete process.env["AI_MEMORY_LOCAL_DIR"];
    else process.env["AI_MEMORY_LOCAL_DIR"] = previousDir;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
```

In the public CORS tests, strengthen the allowed, disallowed, and absent
origin cases:

```ts
expect(res.headers["vary"]).toContain("Origin");
```

For both existing public `OPTIONS` tests, add:

```ts
expect(res.headers["cache-control"]).toBe(EXPECTED_CACHE_CONTROL);
expect(res.headers["vary"]).toContain("Origin");
```

Keep all existing private-route `EXPECTED_CACHE_CONTROL` assertions unchanged.

- [ ] **Step 2: Run the focused cache/CORS tests and confirm RED**

Run:

```bash
npm test -- --run test/server.test.ts -t "public findings|public audit|release notes|sanitized markdown|bounded public policy|missing public details|public feed CORS"
```

Expected failures:

- Successful public GETs still report `no-store, max-age=0`.
- Disallowed and absent public origins do not yet include `Vary: Origin`.
- Missing detail and OPTIONS already remain `no-store`; those assertions
  protect the fail-closed behavior during implementation.

- [ ] **Step 3: Add the typed public-cache helper**

Change the Fastify import:

```ts
import Fastify, { type FastifyReply } from "fastify";
```

Add the exact constant beside the metadata cache constant:

```ts
const PUBLIC_READ_CACHE_CONTROL =
  "public, max-age=60, s-maxage=300, stale-while-revalidate=3600";
```

Add this helper after `publicFeedAllowedOrigins()`:

```ts
function setPublicReadCache(reply: FastifyReply): void {
  reply.header("Cache-Control", PUBLIC_READ_CACHE_CONTROL);
}
```

- [ ] **Step 4: Make public CORS variance unconditional**

Change the public CORS hook to set `Vary` before inspecting the origin:

```ts
app.addHook("onRequest", async (request, reply) => {
  if (!request.url.startsWith("/api/public/")) return;
  reply.header("Vary", "Origin");
  const origin = request.headers.origin;
  if (typeof origin === "string" && publicFeedAllowedOrigins().has(origin)) {
    reply.header("Access-Control-Allow-Origin", origin);
  }
  if (request.method === "OPTIONS") {
    reply.header("Access-Control-Allow-Methods", "GET");
    return reply.code(204).send();
  }
});
```

This keeps `OPTIONS` on the global `no-store` policy and prevents an
origin-less cached response from being reused for an allowed-origin request.

- [ ] **Step 5: Apply public caching only after successful route work**

Update the list handler:

```ts
app.get("/api/public/findings", async (_request, reply) => {
  await ensureAiMemoryCheckout();
  const body = { findings: listPublicFindings() };
  setPublicReadCache(reply);
  return body;
});
```

Update the audit handler:

```ts
app.get("/api/public/audit", async (_request, reply) => {
  await ensureAiMemoryCheckout();
  const findings = listPublicFindings();
  const body = {
    audit: auditPublicFindings(findings),
    filters: filterCountsFromPublic(findings),
  };
  setPublicReadCache(reply);
  return body;
});
```

Update release notes:

```ts
app.get("/api/public/release-notes", async (_request, reply) => {
  const body = { releases: listReleaseNotes() };
  setPublicReadCache(reply);
  return body;
});
```

Update RSS so cache headers are set after building the XML:

```ts
app.get("/api/public/findings/rss", async (request, reply) => {
  await ensureAiMemoryCheckout();
  const siteBase =
    process.env["PUBLIC_SITE_RADAR_BASE"]
    || `${request.protocol}://${request.headers.host}`;
  const xml = buildRssXml(listPublicFindings(), { siteBase });
  reply.header("Content-Type", "application/rss+xml; charset=utf-8");
  setPublicReadCache(reply);
  return xml;
});
```

Update public detail after its `404` branch:

```ts
app.get<{ Params: { id: string } }>(
  "/api/public/findings/:id",
  async (request, reply) => {
    await ensureAiMemoryCheckout();
    const detail = getPublicFindingDetail(request.params.id);
    if (!detail) return reply.code(404).send({ error: "Finding not found" });
    setPublicReadCache(reply);
    return detail;
  },
);
```

Do not apply the helper in a prefix hook or before any awaited/computed route
work; thrown or explicit error responses must retain `no-store`.

- [ ] **Step 6: Run focused tests and inspect every cache boundary**

Run:

```bash
npm test -- --run test/server.test.ts
rg -n 'setPublicReadCache|PUBLIC_READ_CACHE_CONTROL|Cache-Control|Vary' src/server.ts test/server.test.ts
git diff --check
```

Expected:

- All server tests pass.
- `setPublicReadCache` has exactly five route call sites.
- Private/stateful assertions still expect `no-store, max-age=0`.
- No wildcard origin appears.
- Whitespace check is clean.

- [ ] **Step 7: Commit the cache/CORS behavior**

```bash
git add src/server.ts test/server.test.ts
git commit -m "perf: cache sanitized public radar reads"
```

---

### Task 3: Verify production boundaries and open one draft PR

**Files:**
- Modify only if a reproduced defect requires a test-first correction:
  `src/server.ts`, `test/server.test.ts`
- Reference:
  `docs/superpowers/specs/2026-07-25-production-cache-and-asset-polish-design.md`

**Interfaces:**
- Consumes: Task 1 metadata handlers and Task 2 public cache/CORS helper
- Produces: a verified branch and one draft PR against `main`

- [ ] **Step 1: Run the complete local gate**

Run:

```bash
npm test -- --no-file-parallelism --testTimeout=30000
npm run build
npm audit
git diff --check
git status --short --branch
git diff --name-status origin/main...HEAD
```

Expected:

- 34 test files and at least the 337 baseline tests pass.
- TypeScript build exits zero.
- Audit result is recorded exactly; `package.json` and `package-lock.json`
  remain unchanged from `origin/main`.
- Diff scope is only the design, plan, `src/server.ts`, and
  `test/server.test.ts`.

- [ ] **Step 2: Start the built server on a non-AirPlay port**

Run:

```bash
PORT=3102 \
NODE_ENV=development \
AUTH_TOKEN=local-production-polish \
AI_MEMORY_LOCAL_DIR=/Users/work/Repositories/ai-memory \
PUBLIC_FEED_ALLOWED_ORIGINS=https://sid.dev \
npm start
```

Expected: Fastify listens on `http://127.0.0.1:3102`. Record the
before/after SHA-256 inventory of `/Users/work/Repositories/ai-memory/tech-radar`
and confirm the server does not mutate it.

- [ ] **Step 3: Verify metadata and HTTP cache contracts**

Use `curl` with headers visible:

```bash
curl -sS -D - http://127.0.0.1:3102/robots.txt
curl -sS -D - -o /dev/null http://127.0.0.1:3102/favicon.ico
curl -sS -D - -o /dev/null http://127.0.0.1:3102/apple-touch-icon.png
curl -sS -D - -o /dev/null http://127.0.0.1:3102/api/public/findings
curl -sS -D - -o /dev/null http://127.0.0.1:3102/api/public/audit
curl -sS -D - -o /dev/null http://127.0.0.1:3102/api/public/release-notes
curl -sS -D - -o /dev/null http://127.0.0.1:3102/api/public/findings/rss
```

Read one ID from the public list without writing data and verify its detail
route. Expected:

- Robots is `200` with exact approved text.
- Both icon paths are `204`.
- Metadata policy is exactly `public, max-age=86400`.
- All five successful public reads use exactly
  `public, max-age=60, s-maxage=300, stale-while-revalidate=3600`.
- All public paths include `Vary: Origin`.

- [ ] **Step 4: Verify CORS and fail-closed boundaries**

Run requests for:

```text
GET /api/public/findings with Origin: https://sid.dev
GET /api/public/findings with Origin: https://evil.example
GET /api/public/findings without Origin
OPTIONS /api/public/findings with Origin: https://sid.dev
GET /api/public/findings/missing.md
GET /
GET /?token=preview
GET /healthz
GET /api/session
GET /api/findings without auth
GET /api/audit without auth
POST /api/admin/enrich/missing.md without auth
POST /runs without auth
POST /telegram/webhook without the Telegram secret
POST /api/internal/stockbot/completion without callback auth
GET /unknown
```

Expected:

- Only the exact allowed origin receives
  `Access-Control-Allow-Origin: https://sid.dev`.
- Allowed, disallowed, absent-origin, and OPTIONS public responses all include
  `Vary: Origin`.
- OPTIONS is `204` and `no-store`.
- Missing detail is `404` and `no-store`.
- Every dashboard/private/admin/stateful/error/unknown response is
  `no-store, max-age=0`.
- Existing `401`, `404`, and webhook/callback boundaries are unchanged.

- [ ] **Step 5: Run the browser smoke with Playwright CLI**

Read `/Users/work/.codex/skills/playwright/SKILL.md`, then use
`/Users/work/.codex/skills/playwright/scripts/playwright_cli.sh`.

At `390x844` and `1280x900`:

```text
open http://127.0.0.1:3102/
wait for the public finding list
open one finding and return to the list
open release notes and return to findings
inspect console warnings, console errors, page errors, and horizontal overflow
```

Expected:

- Dashboard and public data load at both widths.
- Finding detail and release notes still work.
- Console warnings/errors and page errors are zero.
- Document horizontal overflow is zero.
- Browser requests to the known metadata paths produce no 404s.

- [ ] **Step 6: Correct only reproduced defects test-first**

For each verified regression:

1. Add one focused failing assertion to `test/server.test.ts`.
2. Run it and capture the RED failure.
3. Make the smallest `src/server.ts` correction.
4. Run the focused test and capture GREEN.
5. Repeat the affected curl or browser path.

Do not expand the PR into dependency upgrades, server-side data caching,
branding, or deployment.

- [ ] **Step 7: Commit any verification correction**

If Step 6 changed production/test files:

```bash
git add src/server.ts test/server.test.ts
git commit -m "fix: close production cache verification gaps"
```

If Step 6 found no defect, create no empty commit.

- [ ] **Step 8: Push and open one draft PR**

```bash
git push -u origin codex/production-polish
gh pr create --draft \
  --base main \
  --head codex/production-polish \
  --title "Polish Tech Radar production caching"
```

Supply the body non-interactively. It must record:

- The live before-state: three metadata `404`s, public list at 3.45 seconds,
  and `no-store`.
- The exact three route outcomes and both cache-control policies.
- Every cacheable public endpoint.
- CORS `Vary: Origin` and exact allowlist evidence.
- Private/admin/stateful/error `no-store` evidence.
- Exact focused/full Vitest counts, build, audit, diff scope, and unchanged
  package/data checksums.
- Both browser viewports and their console/overflow results.
- No deployment performed.

Do not create the PR until every value is known. Confirm exactly one open PR
exists for this head, its base is `main`, its head matches local/remote, and CI
is green or explicitly pending.

---

## Plan self-review record

- Spec coverage: metadata paths, both exact policies, five public GETs,
  successful-only caching, CORS variance, OPTIONS/error/private `no-store`,
  unchanged bodies/auth/data/dependencies, browser smoke, full verification,
  and one draft PR each map to an explicit task and acceptance check.
- Placeholder scan: the plan contains no deferred implementation value or
  undefined helper/type; runtime evidence is collected only by the exact
  named commands before PR creation.
- Type consistency: `PUBLIC_READ_CACHE_CONTROL`,
  `METADATA_CACHE_CONTROL`, `ROBOTS_TEXT`, and
  `setPublicReadCache(reply: FastifyReply): void` use the same names and values
  across tests, implementation, verification, and delivery.
