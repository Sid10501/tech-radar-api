# MEMORY.md — Project Memory (example)

Copy this file to `MEMORY.md` in the project root and fill in your details.
`MEMORY.md` is gitignored — it's a running log of decisions, gotchas, and active context for AI agents.

---

## Identity

- **Project**: tech-radar-api
- **Stack**: Node.js 20 + TypeScript + Fastify + Anthropic SDK + simple-git + Zod + Vitest
- **Deploy**: Railway (Dockerfile build, `node dist/src/server.js`)
- **Repo owner**: Your name

---

## Learnings & Corrections

Add date-stamped entries here as you discover gotchas or fix bugs. Newest first.

- (YYYY-MM-DD) Example: `github_lookup` must receive `owner/repo` format — numeric IDs cause a 404. Input is normalized in `src/tools/github.ts`.

---

## Common Gotchas

- The pipeline serializes through a single-slot queue — only one run at a time because git pushes must not race.
- `GIT_DEPLOY_KEY_B64` must be the full SSH private key base64-encoded in one line: `base64 -i ~/.ssh/id_ed25519 | tr -d '\n'`
- `GITHUB_TOKEN` is optional but strongly recommended — without it the GitHub API rate-limits to 60 req/hour. Create a classic token at github.com/settings/tokens with no scopes (public repo read is enough) and set it in Railway Variables.
- `railway deployment redeploy --yes` redeploys the previous Docker image — use `railway deployment up --detach` after a code push.
- Telegram bot requires the user to send it a message first before `getUpdates` returns a chat ID.

---

## Automation Playbook

```bash
npm run dev                             # hot reload on port 3000
bash scripts/run_pipeline.sh "<url>"   # test extractor directly
npm test                                # run tests
npm run build                           # compile
railway up                              # deploy to Railway
```

---

## Active Context

Update this section at the end of each session with what you did and what's next.
