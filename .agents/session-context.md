# tech-radar-api — /compact preservation brief

Use when a Claude Code session approaches **300–400K tokens**. Run `./scripts/compact-context.sh`, copy the output, run `/compact`, and paste this brief as the preservation instruction. Review the compacted summary before continuing — if a constraint is missing, add it back explicitly.

---

## Identity

- **Project:** tech-radar-api
- **Stack:** Node.js 20 + TypeScript + Fastify + Anthropic SDK + simple-git + Zod + Vitest
- **Package manager:** npm
- **Deploy:** Railway — `https://tech-radar-api-production.up.railway.app`
- **Public repo:** github.com/Sid10501/tech-radar-api

---

## Non-negotiable constraints

### Pipeline stages (in order)
1. `extract()` — shells out to `scripts/run_pipeline.sh` (yt-dlp + faster-whisper)
2. Bail guard — skips agents if `status=failed` OR no caption+transcript → `skipped` INBOX row
3. `runResearch()` — Claude agent + `github_lookup` tool
4. `runImplementation()` — Claude agent reads `GLOBAL_MEMORY.md`, `domains/webdev.md`, 2 most recent sessions
5. `composeFinding()` — assembles markdown
6. `AiMemoryRepo` — writes finding, updates INBOX/INDEX, commits and pushes (pull-rebase retry on rejection)

### Git / queue
- Single-slot queue (`acquireSlot`/`releaseSlot`) — only one pipeline run at a time, git pushes must not race.
- `commitAndPush` retries with `--rebase` on non-fast-forward rejection.
- `GIT_DEPLOY_KEY_B64`: full SSH key base64 in one line: `base64 -i ~/.ssh/id_ed25519 | tr -d '\n'`

### Run statuses
`pending | running | processed | failed | skipped` — `skipped` is NOT an error, no throw.

### INBOX.md
- 5 columns: `| Date | URL | Status | Finding | Error |`
- Sentinel: `<!-- new rows inserted above this line -->`
- URL matching uses `.includes()` not regex — fragile against base64 igsh= params otherwise.

### Schema keys
- Implementation agent output key: `fit_for_owner` (NOT `fit_for_sid` — forkability fix)
- `OWNER_NAME` env var used only for display heading in markdown

### Deploy
- Ship: `railway up --detach`
- **Do not** use `railway deployment redeploy --yes` — redeploys previous image, not latest commit.
- `WHISPER_MODEL=base` set in Railway Variables (better transcript quality).

### Prompt injection defense
- Untrusted content (captions, transcripts, github API responses) wrapped via `wrapAsUntrusted()` from `src/lib/untrustedContent.ts`
- Agent outputs validated through `parseAgentOutput()` from `src/lib/validateAgentOutput.ts`
- Prefer `*_for_llm` fields from ExtractResult when available

### Telegram bot
- `/retry <url>` — force-retry any URL (force: true bypasses dedup for all statuses)
- Skipped/failed URLs re-queueable by plain URL paste (dedup only blocks pending/running/processed)
- Webhook secret: `TELEGRAM_WEBHOOK_SECRET` header

---

## Workflows

- Tests: `npm test` (40 passing baseline)
- Type check: `npx tsc --noEmit`
- Local dev: `npm run dev`
- Memory: read `MEMORY.md` and `~/.ai-memory/GLOBAL_MEMORY.md` at session start.
- Persist learnings: `/learn` or update `MEMORY.md` at session end.

---

## Active context

<!-- Overwrite each session: what branch, what feature, what's blocked -->

- 2026-06-28: Dashboard parser/detail bug fixed, committed, pushed, and deployed on `main`.
- Latest shipped commit: `0e1f949 fix: render complete finding detail sections`.
- Latest Railway deployment verified: `d31baf31-d3ff-4601-8a14-eba997e4975a`.
- Production checks after deploy: public Max Kelley detail has full `shown` section with transcript; private detail has implementation text and `Create task`.
- Next-session plan: `docs/superpowers/plans/2026-06-28-dashboard-enrichment-and-audit.md`.
- Recommended next subset: batch audit model, audit endpoints, dashboard filter counts/needs-enrichment queue.
- Known local noise: untracked `tech-radar-api.cursor.code-workspace`; do not remove unless user asks.
