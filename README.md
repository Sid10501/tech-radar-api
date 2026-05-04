# tech-radar-api

A self-hosted pipeline that turns social media tech posts into structured research findings committed to your personal knowledge base.

Paste a TikTok, YouTube, or Instagram URL → get a markdown finding file with:
- What the technology is and who built it
- GitHub viability signals (stars, license, last push date)
- A concrete implementation idea grounded in your own projects and stack
- Committed directly to your `ai-memory` git repo

Built and used by [Sidharth Grover](https://github.com/Sid10501). Fork it and point it at your own knowledge base.

---

## How it works

```
URL submitted
    │
    ▼
[extract]  yt-dlp + faster-whisper → title, caption, hashtags, transcript
    │
    ▼
[research]  Claude (claude-sonnet-4-6) + GitHub API → structured research JSON
    │
    ▼
[implement]  Claude reads your ai-memory → personalized implementation idea
    │
    ▼
[compose]  Markdown finding file assembled
    │
    ▼
[git push]  Finding committed to your ai-memory repo
```

The service runs on Railway. You submit URLs through a minimal web UI or the REST API. The pipeline serializes through a single queue (git pushes don't race). Run status is visible in the UI and persisted to `INBOX.md` in your ai-memory repo.

---

## Setup

### 1. Fork / clone this repo

```bash
git clone https://github.com/Sid10501/tech-radar-api
cd tech-radar-api
npm install
```

### 2. Set up your ai-memory repo

The pipeline needs a git repo to commit findings to. You can use [Sid10501/ai-memory](https://github.com/Sid10501/ai-memory) as a template, or create your own with the same structure:

```
ai-memory/
  GLOBAL_MEMORY.md          ← the implementation agent reads this
  domains/
    webdev.md               ← optional, read for tech stack context
  sessions/                 ← optional session logs
  tech-radar/
    INBOX.md                ← pipeline writes status rows here
    INDEX.md                ← pipeline writes finding index rows here
    findings/               ← markdown findings committed here
```

### 3. Create a deploy key

```bash
ssh-keygen -t ed25519 -f ~/.ssh/tech-radar-deploy -C "tech-radar-api"
# Add ~/.ssh/tech-radar-deploy.pub as a deploy key with write access to your ai-memory repo
# Then base64-encode the private key:
base64 -i ~/.ssh/tech-radar-deploy | tr -d '\n'
```

### 4. Configure environment variables

Copy `.env.example` to `.env` and fill in the values:

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Your Anthropic API key |
| `AI_MEMORY_REPO` | Yes | SSH URL of your ai-memory repo, e.g. `git@github.com:youruser/ai-memory.git` |
| `GIT_DEPLOY_KEY_B64` | Yes | Base64-encoded SSH private key (write access to ai-memory repo) |
| `AUTH_TOKEN` | Recommended | Bearer token to protect `POST /runs` |
| `AI_MEMORY_LOCAL_DIR` | No | Where to clone ai-memory (default: `/tmp/ai-memory`) |
| `AI_MEMORY_REPO_URL` | No | Public HTTPS URL of your ai-memory repo (used for finding links in the UI) |
| `OWNER_NAME` | No | Your name for the implementation agent prompt (default: `the developer`) |
| `TARGET_PROJECTS` | No | Comma-separated list of your projects for the implementation agent |
| `GITHUB_TOKEN` | No | GitHub token — raises API rate limit from 60 to 5000 req/hr |
| `PORT` | No | HTTP port (default: `3000`) |

### 5. Run locally

```bash
npm run dev
# Open http://localhost:3000
```

### 6. Deploy to Railway

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app)

```bash
railway login
railway init
railway up
```

Set all env vars under **Variables** in the Railway dashboard. The `Dockerfile` and `railway.json` are already configured.

---

## API

### `GET /healthz`
Returns `{ ok: true }`. Used by Railway's healthcheck.

### `GET /`
Web UI — submit a URL, view run history.

### `POST /runs`
Requires `Authorization: Bearer <AUTH_TOKEN>` header (if `AUTH_TOKEN` is set).

```json
{ "url": "https://www.instagram.com/reel/..." }
```

Returns `202 { "runId": "..." }`.

### `GET /runs`
Returns array of recent runs (last 50).

### `GET /runs/:id`
Returns a single run by ID.

---

## Tech stack

- **Runtime**: Node.js 20, TypeScript
- **HTTP**: Fastify
- **Agents**: Anthropic SDK (`claude-sonnet-4-6`) with tool use
- **Extract**: Python + yt-dlp + faster-whisper (via shell script)
- **Git**: simple-git
- **Validation**: Zod
- **Tests**: Vitest
- **Deploy**: Railway (Dockerfile)

---

## Development

```bash
npm test              # run tests
npm run build         # tsc compile
npm run dev           # tsx watch (hot reload)

# Test the extractor directly
bash scripts/run_pipeline.sh "https://www.youtube.com/watch?v=..."
```

---

## License

MIT
