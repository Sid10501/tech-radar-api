# Production Proof And Reproducibility Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:verification-before-completion before claiming any item here is complete. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the deployed tech-radar-api improvements work in production and make the deployed state reproducible from Git.

**Architecture:** Treat production, local tests, browser behavior, Railway deployment metadata, and Git state as separate evidence streams. A feature is complete only when the local code passes tests, the live service exposes it, browser interaction works, and the exact deployed code is committed and pushed.

**Tech Stack:** Node.js 20, TypeScript, Fastify, Vitest, pytest, Playwright CLI, Railway.

---

## Requirement Checklist

- [x] Release notes are visible in the live dashboard.
- [x] Release notes are available through a public unauthenticated API.
- [x] Findings still load in the live dashboard after opening and closing release notes.
- [x] Local TypeScript tests pass.
- [x] Local TypeScript build passes.
- [x] Python extractor tests pass.
- [x] Railway deployment for the local working tree succeeds.
- [ ] The deployed working tree is committed and pushed to `origin`.
- [ ] Post-push deployment or branch state confirms production is reproducible from Git.

## Evidence Commands

Run these before calling the product loop complete:

```bash
npm test
npm run build
PYTHONDONTWRITEBYTECODE=1 pytest -q -p no:cacheprovider test/extract_post_test.py
curl -fsS https://tech-radar-api-production.up.railway.app/healthz
curl -fsS https://tech-radar-api-production.up.railway.app/api/public/release-notes
curl -fsS https://tech-radar-api-production.up.railway.app/api/public/findings
railway deployment list --json
```

Browser proof:

```bash
export CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
export PWCLI="$CODEX_HOME/skills/playwright/scripts/playwright_cli.sh"
"$PWCLI" open https://tech-radar-api-production.up.railway.app/
"$PWCLI" snapshot
"$PWCLI" click <Release notes button ref>
"$PWCLI" snapshot
"$PWCLI" screenshot --filename output/playwright/live-release-notes.png --full-page
"$PWCLI" click <Back to findings button ref>
"$PWCLI" snapshot
```

Expected browser evidence:

- Page title is `Tech Radar`.
- Snapshot includes `Release notes` button.
- Release notes view includes `2026-07-05 - Ever-Improving Product Loop`.
- Back to findings returns to `52 of 52` findings with quality counts visible.

## Current Residual Risks

- `- Docs:` links still count broadly as public artifact evidence; GitHub repo URLs are stricter.
- Browser proof is currently CLI-driven, not committed as a repeatable Playwright test suite.
- Production was deployed from the local working tree first; commit and push are required to make the deployment reproducible.
