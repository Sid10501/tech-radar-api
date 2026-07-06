# Audit Completion Verification Checklist

Use this checklist after the audit-completion implementation has landed. This document is ops evidence only; do not deploy from this checklist.

## Local Verification

- [ ] `git status --short --branch` shows only intentional audit-completion source, test, and docs changes.
- [ ] `npm test`
- [ ] `npm run build`
- [ ] `PYTHONDONTWRITEBYTECODE=1 pytest -q -p no:cacheprovider test/extract_post_test.py`

## Live Smoke URLs

- [ ] Dashboard loads: `https://tech-radar-api-production.up.railway.app/`
- [ ] Health check returns `{ "ok": true }`: `https://tech-radar-api-production.up.railway.app/healthz`
- [ ] Release notes API includes `2026-07-06 - Audit Completion Ops Polish`: `https://tech-radar-api-production.up.railway.app/api/public/release-notes`
- [ ] Public audit returns quality/enrichment counts: `https://tech-radar-api-production.up.railway.app/api/public/audit`
- [ ] Public findings list returns sanitized summaries: `https://tech-radar-api-production.up.railway.app/api/public/findings`

## Browser Smoke

- [ ] Open the live dashboard at desktop width and confirm the `Release notes` control opens the notes view.
- [ ] Open the live dashboard at mobile width and confirm release notes open in the detail pane, then `Back to findings` returns to the list.
- [ ] Open a finding with retry metadata or extraction warnings and confirm retry history, extraction warnings, duplicate diagnostics, and quality reason chips are visible where data exists.
- [ ] Confirm public views do not expose private project fit, implementation ideas, admin actions, raw auth tokens, or private ai-memory paths.

## Cache Header Policy

This audit-completion branch sets conservative `Cache-Control: no-store, max-age=0` headers on the dashboard HTML and public read APIs.

- [ ] Confirm `/` has `Cache-Control: no-store, max-age=0`.
- [ ] Confirm `/api/public/findings`, `/api/public/audit`, `/api/public/release-notes`, and public finding detail routes have `Cache-Control: no-store, max-age=0`.
- [ ] Confirm security headers are present on HTML, public JSON, and private/admin `401` responses.
- [ ] Keep short public caching as a future optimization only after the dashboard has refresh semantics and immutable static assets.

## Residual Risks

- Production may lag this fork until the owning branch is merged and deployed by the release owner.
- Browser smoke remains manual unless a future pass promotes the mobile/release-note flow to Playwright.
- Cache policy is intentionally conservative; a future pass can add short public caching with explicit refresh semantics.
