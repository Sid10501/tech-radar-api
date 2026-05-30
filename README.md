# tech-radar-api

Stop saving posts you'll never read. Send a URL to a bot and get back a structured research finding committed to your knowledge base — what the tool actually is, whether it's worth your time, and a concrete implementation idea for your specific projects.

Built by [Sidharth Grover](https://github.com/Sid10501). Self-host it and point it at your own knowledge base.

---

## What it does

You send a TikTok, Instagram, or YouTube URL. Within a few minutes:

1. **Extracts** the caption, hashtags, and transcript from the post (yt-dlp + faster-whisper)
2. **Researches** the technology — GitHub stars, license, last activity, alternatives (Claude + GitHub API)
3. **Reads your personal knowledge base** and writes an implementation idea grounded in your actual projects and stack (second Claude agent)
4. **Commits** a structured markdown finding to your `ai-memory` repo

The finding tells you what to think about a tool, not just what the tool is.

---

## How to submit URLs

Four ways, pick whichever fits your workflow:

- **iOS Shortcut** — one tap from the share sheet while you're scrolling. See [shortcuts/README.md](shortcuts/README.md)
- **Telegram bot** — send URLs directly to a bot, get notified when the finding is ready
- **Web UI** — paste and click at your deployed URL
- **REST API** — `POST /runs` with a JSON body

---

## How it works

```
URL
 │
 ▼
[extract]    yt-dlp + faster-whisper → title, caption, hashtags, transcript
 │
 ▼
[research]   Claude + GitHub API → what it is, stars, license, comparisons
 │
 ▼
[implement]  Claude reads your ai-memory → personalized implementation idea
 │
 ▼
[compose]    Markdown finding assembled
 │
 ▼
[git push]   Finding committed to your ai-memory repo
```

One run at a time — the pipeline serializes through a single queue so git pushes don't race.

---

## Example output

```markdown
# Udeler — Cross-Platform Udemy Course Downloader

**Source:** Instagram · @harry · 2026-05-04
**Tags:** instagram, #tools, #dev

## TL;DR
Udeler is an open-source desktop app for downloading Udemy courses for offline use...

## What it actually is
- Stars: 6,847 · License: GPL-3.0 · Archived: no
- Compares to: youtube-dl, yt-dlp (web), Motrix

## Fit for you
- Target project: Finance Assistant
- Could replace the manual export step in your lesson pipeline...
- Verdict: `#try-soon`

## Implementation Idea
...
```

---

## Setup

### 1. Fork this repo

```bash
git clone https://github.com/Sid10501/tech-radar-api
cd tech-radar-api
npm install
```

### 2. Set up your ai-memory repo

The pipeline commits findings to a git repo you control. Use [Sid10501/ai-memory](https://github.com/Sid10501/ai-memory) as a template, or create your own with this structure:

```
ai-memory/
  GLOBAL_MEMORY.md       ← the agent reads this: your stack, projects, preferences
  domains/
    webdev.md            ← optional tech stack detail
  tech-radar/
    INBOX.md             ← pipeline writes run status here
    INDEX.md             ← pipeline writes a finding index here
    findings/            ← markdown findings land here
```

`INBOX.md` and `INDEX.md` each need this sentinel line for row insertion:

```markdown
<!-- new rows inserted above this line -->
```

### 3. Create a deploy key

```bash
ssh-keygen -t ed25519 -f ~/.ssh/tech-radar-deploy -C "tech-radar-api"
# Add the .pub file as a deploy key with write access to your ai-memory repo
# Then base64-encode the private key:
base64 -i ~/.ssh/tech-radar-deploy | tr -d '\n'
```

### 4. Set environment variables

Copy `.env.example` to `.env`:

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Your Anthropic API key |
| `AI_MEMORY_REPO` | Yes | SSH URL of your ai-memory repo |
| `GIT_DEPLOY_KEY_B64` | Yes | Base64-encoded SSH private key with write access |
| `AUTH_TOKEN` | Recommended | Bearer token protecting `POST /runs` |
| `OWNER_NAME` | No | Your name — used in agent prompts (default: `the developer`) |
| `TARGET_PROJECTS` | No | Comma-separated list of your projects for the implementation agent |
| `AI_MEMORY_REPO_URL` | No | Public HTTPS URL of your ai-memory repo (for finding links in the UI) |
| `AI_MEMORY_LOCAL_DIR` | No | Where to clone ai-memory (default: `/tmp/ai-memory`) |
| `GITHUB_TOKEN` | No | Raises GitHub API rate limit from 60 to 5000 req/hr |
| `TELEGRAM_BOT_TOKEN` | No | From [@BotFather](https://t.me/BotFather) |
| `TELEGRAM_CHAT_ID` | No | Your chat ID — enables notifications and two-way control |
| `TELEGRAM_WEBHOOK_SECRET` | No | Random string to verify Telegram webhook requests |
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

Set all env vars under **Variables** in the Railway dashboard. `Dockerfile` and `railway.json` are preconfigured.

Key variables to set (see `.env.example` for full list):

| Variable | Required | Purpose |
|----------|----------|---------|
| `ANTHROPIC_API_KEY` | Yes | Claude API |
| `AI_MEMORY_REPO` | Yes | SSH URL of your ai-memory repo |
| `GIT_DEPLOY_KEY_B64` | Yes | SSH deploy key (base64) |
| `AUTH_TOKEN` | Recommended | Protects POST /runs |
| `GITHUB_TOKEN` | Recommended | GitHub API (5000 req/hr vs 60) |
| `WHISPER_MODEL` | Optional | Transcription quality: `tiny`/`base`/`small` |
| `AI_MEMORY_REPO_URL` | Optional | Makes finding links in Telegram clickable |
| `OWNER_NAME` | Optional | Your name in agent prompts |
| `TARGET_PROJECTS` | Optional | Comma-separated list of your projects |
| `TELEGRAM_BOT_TOKEN` | Optional | Telegram notifications |
| `TELEGRAM_CHAT_ID` | Optional | Your Telegram chat ID |

> **Note:** After pushing new code, use `railway up` to deploy — not `railway deployment redeploy`, which redeploys the previous image.

---

## Telegram bot setup

1. Message [@BotFather](https://t.me/BotFather) → `/newbot` → copy the token
2. Set `TELEGRAM_BOT_TOKEN` in your env
3. Send any message to your bot, then fetch `https://api.telegram.org/bot<TOKEN>/getUpdates` to get your `chat.id`
4. Set `TELEGRAM_CHAT_ID` to that value
5. Register the webhook after deploying:

```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://YOUR-RAILWAY-URL/telegram/webhook","secret_token":"YOUR_WEBHOOK_SECRET"}'
```

Bot commands: send any URL to queue it, `/status`, `/list`, `/help`.

---

## iOS Shortcut

See [shortcuts/README.md](shortcuts/README.md) for step-by-step instructions. Takes about 2 minutes. Once set up, you can trigger a research run directly from Instagram or TikTok's share sheet without leaving the app.

---

## API reference

### `GET /healthz`
Returns `{ ok: true }`.

### `GET /`
Web UI — submit URLs, view run history.

### `POST /runs`
Requires `Authorization: Bearer <AUTH_TOKEN>` if `AUTH_TOKEN` is set.

```json
{ "url": "https://www.instagram.com/reel/..." }
```

Returns `202 { "runId": "..." }`.

### `GET /runs`
Returns last 50 runs.

### `GET /runs/:id`
Returns a single run by ID.

---

## Tech stack

| Layer | Choice |
|-------|--------|
| Runtime | Node.js 20 + TypeScript |
| HTTP | Fastify |
| Agents | Anthropic SDK (`claude-sonnet-4-6`) with tool use |
| Extraction | Python + yt-dlp + faster-whisper |
| Git | simple-git |
| Validation | Zod |
| Tests | Vitest |
| Deploy | Railway (Dockerfile) |

---

## Development

```bash
npm run dev                                          # hot reload on port 3000
npm test                                             # run tests
npm run build                                        # compile

bash scripts/run_pipeline.sh "https://..."          # test extractor directly
```

---

## Forking

Copy `CLAUDE.example.md` → `CLAUDE.md` and `MEMORY.example.md` → `MEMORY.md`, then fill in your details. These files are gitignored — they're personal context for AI agents working on your instance.

---

## License

MIT
