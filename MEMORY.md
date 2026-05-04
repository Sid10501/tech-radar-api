# Project Memory

Persistent memory for AI agents working on this project. Updated via the **learn** skill/command. Max 150 lines.

---

## Identity

- **Project**: tech-radar-api
- **Stack**: Node.js 20 + TypeScript + Fastify + Anthropic SDK + simple-git + Zod + Vitest
- **Deploy**: Railway (Dockerfile build, `node dist/src/server.js`)
- **Repo owner**: Sidharth Grover

---

## Learnings & Corrections

- (2026-05-04) The `web_search` and `web_fetch` tools were declared in the research agent's tool list but never implemented — they returned stub error JSON. Removed them; the agent uses training knowledge + github_lookup only.
- (2026-05-04) `updateInbox` regex was fragile against base64 `igsh=` params in Instagram URLs. Replaced with a simple string `.includes()` search on the line.
- (2026-05-04) `updateIndex` was appending rows below the `<!-- sentinel -->` instead of above it. Fixed to use string replacement.
- (2026-05-04) Error messages were never persisted to git — `run.error` lived only in the in-memory Map (max 50, lost on restart). Fixed: error is now written as a 5th column in INBOX.md rows.
- (2026-05-04) `POST /runs` used a 50ms setTimeout to recover the runId — replaced with `await Promise.resolve()` since `runPipeline` stores the run synchronously before its first await.

---

## Common Gotchas

- The pipeline serializes through a single-slot queue (`acquireSlot` / `releaseSlot` in runner.ts) — only one run at a time because git pushes must not race.
- `GIT_DEPLOY_KEY_B64` must be the full SSH private key base64-encoded in one line: `base64 -i ~/.ssh/id_ed25519 | tr -d '\n'`
- Railway `AI_MEMORY_LOCAL_DIR=/tmp/ai-memory` — this persists across runs on the same container. The `init()` in `AiMemoryRepo` skips clone if `.git` already exists, then `pullLatest()` syncs. This is intentional and correct.
- `OWNER_NAME` and `TARGET_PROJECTS` env vars personalize the implementation agent prompt. Set them in Railway variables.

---

## Automation Playbook

```bash
# Local dev
npm run dev                   # tsx watch src/server.ts on port 3000

# Test extract script directly
bash scripts/run_pipeline.sh "https://www.instagram.com/reel/..."

# Run tests
npm test

# Build
npm run build

# Deploy to Railway (auto on push to main, or manually)
railway up
```

---

## Tool Preferences

- **Logging**: Fastify's built-in pino logger (structured JSON)
- **Validation**: Zod for agent output schemas
- **Git ops**: simple-git
- **HTTP**: native node:https (no axios/fetch) in tools/github.ts

---

## Active Context

Last session (2026-05-04): Diagnosed failure pattern, fixed 5 bugs (error persistence, INDEX sentinel, INBOX regex, stub tools, runId race), parameterized personal references for public release, updated .env.example, and rewrote README. Next: deploy and verify on Railway, then LinkedIn post + public repo checklist.
