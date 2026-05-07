# tech-radar-api

A self-hosted pipeline that turns social media tech posts into structured research findings committed to your personal knowledge base.

Paste a TikTok, YouTube, or Instagram URL and get back a markdown finding with:
- What the technology actually is and who built it
- GitHub viability signals (stars, license, last push date)
- A concrete implementation idea grounded in your own projects and stack
- Committed directly to your `ai-memory` git repo

Built and used by [Sidharth Grover](https://github.com/Sid10501). Fork it and point it at your own knowledge base.

---

## How it works

```
URL submitted (web UI, API, Telegram bot, or iOS Shortcut)
    │
    ▼
[extract]   yt-dlp + faster-whisper → title, caption, hashtags, transcript
    │
    ▼
[research]  Claude + GitHub API → what it is, stars, license, alternatives
    │
    ▼
[implement] Claude reads your ai-memory → personalized implementation idea
    │
    ▼
[compose]   Markdown finding assembled
    │
    ▼
[git push]  Finding committed to your ai-memory repo
```

The pipeline serializes through a single queue — git pushes don't race. Run status is visible in the web UI and persisted to `INBOX.md` in your ai-memory repo.

---

## Setup

### 1. Fork / clone this repo

```bash
git clone https://github.com/Sid10501/tech-radar-api
cd tech-radar-api
npm install
```

### 2. Set up your ai-memory repo

The pipeline commits findings to a git repo you own. Use [Sid10501/ai-memory](https://github.com/Sid10501/ai-memory) as a template, or create your own with this structure:

```
ai-memory/
  GLOBAL_MEMORY.md          ← implementation agent reads this for your stack + projects
  domains/
    webdev.md               ← optional, tech stack context
  sessions/                 ← optional session logs
  tech-radar/
    INBOX.md                ← pipeline writes status rows here
    INDEX.md                ← pipeline writes finding index rows here
    findings/               ← markdown findings committed here
```

`INBOX.md` and `INDEX.md` need a sentinel comment for row insertion:
```markdown
<!-- new rows inserted above this line -->
```

### 3. Create a deploy key

```bash
ssh-keygen -t ed25519 -f ~/.ssh/tech-radar-deploy -C "tech-radar-api"
# Add ~/.ssh/tech-radar-deploy.pub as a deploy key with write access to your ai-memory repo
# Base64-encode the private key:
base64 -i ~/.ssh/tech-radar-deploy | tr -d '\n'
```

### 4. Configure environment variables

Copy `.env.example` to `.env`:

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Your Anthropic API key |
| `AI_MEMORY_REPO` | Yes | SSH URL of your ai-memory repo, e.g. `git@github.com:you/ai-memory.git` |
| `GIT_DEPLOY_KEY_B64` | Yes | Base64-encoded SSH private key (write access to ai-memory) |
| `AUTH_TOKEN` | Recommended | Bearer token protecting `POST /runs` |
| `AI_MEMORY_LOCAL_DIR` | No | Where to clone ai-memory (default: `/tmp/ai-memory`) |
| `AI_MEMORY_REPO_URL` | No | Public HTTPS URL of your ai-memory repo (used for finding links) |
| `OWNER_NAME` | No | Your name for agent prompts (default: `the developer`) |
| `TARGET_PROJECTS` | No | Comma-separated list of your projects for the implementation agent |
| `GITHUB_TOKEN` | No | GitHub token — raises rate limit from 60 to 5000 req/hr |
| `TELEGRAM_BOT_TOKEN` | No | Telegram bot token (from @BotFather) |
| `TELEGRAM_CHAT_ID` | No | Your Telegram chat ID (for notifications and two-way control) |
| `TELEGRAM_WEBHOOK_SECRET` | No | Random string to validate Telegram webhook requests |
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

Set all env vars under **Variables** in the Railway dashboard. The `Dockerfile` and `railway.json` are preconfigured.

---

## Submitting URLs

### Web UI

Open your deployed URL in a browser, paste a link, hit Research.

### iOS Shortcut

One tap from any social media post to a queued research job. See [shortcuts/README.md](shortcuts/README.md) for setup — takes about 2 minutes to configure. Works from the share sheet so you never have to leave the app.

### Telegram bot

Set up a Telegram bot and you can submit URLs by sending them directly to the bot, as well as query run status:

1. Create a bot via [@BotFather](https://t.me/BotFather) → `/newbot` → copy the token
2. Set `TELEGRAM_BOT_TOKEN` in Railway Variables
3. Send any message to your bot, then call `https://api.telegram.org/bot<TOKEN>/getUpdates` to find your `chat.id`
4. Set `TELEGRAM_CHAT_ID` to that value
5. Register the webhook:
   ```bash
   curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
     -H "Content-Type: application/json" \
     -d '{"url":"https://YOUR-RAILWAY-URL/telegram/webhook","secret_token":"YOUR_WEBHOOK_SECRET"}'
   ```

Bot commands:
- Send any URL → queues it for research
- `/status` → last 5 runs
- `/list` → recent findings with links
- `/help` → command list

### REST API

```bash
# Submit a URL
curl -X POST https://your-railway-url/runs \
  -H "Authorization: Bearer YOUR_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.instagram.com/reel/..."}'

# Check run status
curl https://your-railway-url/runs/RUN_ID \
  -H "Authorization: Bearer YOUR_AUTH_TOKEN"
```

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
npm test          # run tests
npm run build     # tsc compile
npm run dev       # hot reload on port 3000

# Test the extractor directly
bash scripts/run_pipeline.sh "https://www.youtube.com/watch?v=..."
```

---

## License

MIT
