# CLAUDE.md — Agent Instructions (example)

Copy this file to `CLAUDE.md` in the project root and fill in your details.
`CLAUDE.md` is gitignored — it's personal context for AI agents working on your instance.

---

## Memory System

Read `MEMORY.md` in this directory for project-specific context: gotchas, workflows, active state.

Use the `/learn` command at the end of sessions to persist new learnings back to memory.

---

## Your Instance

Fill these in so agents working on your fork understand your setup:

- **Owner**: Your name
- **ai-memory repo**: `https://github.com/youruser/ai-memory`
- **Deployed at**: `https://your-service.railway.app`
- **Projects the implementation agent should know about**: list them here (these map to `TARGET_PROJECTS` env var)

---

## Stack notes

- Railway for hosting — use `railway deployment up --detach` to deploy new commits, not `railway deployment redeploy --yes` (that redeploys the previous image)
- `GIT_DEPLOY_KEY_B64` is the SSH private key for your ai-memory repo, base64-encoded in one line
- The pipeline is single-threaded by design — one run at a time to avoid git race conditions

---

## Preferences

Add any agent behavior preferences here — code style, what to avoid, how you like things structured.
