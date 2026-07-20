# tech-radar-api

Stop saving posts you'll never read. Send a URL to a bot and get back a structured research finding committed to your knowledge base — what the tool actually is, whether it's worth your time, and a concrete implementation idea for your specific projects.

Built by [Sidharth Grover](https://github.com/Sid10501). Self-host it and point it at your own knowledge base.

---

## What it does

You send a TikTok, Instagram, YouTube, or public Google Drive PDF URL. Within a few minutes:

1. **Extracts** the caption, hashtags, transcript, or document text from the source (yt-dlp + faster-whisper + pypdf)
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
[extract]    yt-dlp + faster-whisper + pypdf → title, caption, hashtags, transcript/document text
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
    applied.json         ← optional: marks findings you actually adopted
```

`INBOX.md` and `INDEX.md` each need this sentinel line for row insertion:

```markdown
<!-- new rows inserted above this line -->
```

`applied.json` is an optional JSON object keyed by finding filename. Each entry needs `appliedAt` and `link`, plus an optional `note`; the public feed exposes it as `applied` on matching findings (`null` otherwise). A missing or corrupt file degrades to `applied: null` for all findings:

```json
{
  "20260615-video-by-shawnchee.md": {
    "appliedAt": "2026-07-06",
    "link": "https://github.com/you/your-project",
    "note": "adopted the rubric"
  }
}
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
| `AUTH_TOKEN` | Recommended | Browser/admin bearer token; not accepted by StockBot dispatch routes |
| `STOCKBOT_DISPATCH_TOKEN` | For StockBot dispatch | Dedicated bearer token protecting `POST /runs` and service uploads |
| `OWNER_NAME` | No | Your name — used in agent prompts (default: `the developer`) |
| `TARGET_PROJECTS` | No | Comma-separated list of your projects for the implementation agent |
| `AI_MEMORY_REPO_URL` | No | Public HTTPS URL of your ai-memory repo (for finding links in the UI) |
| `AI_MEMORY_LOCAL_DIR` | No | Where to clone ai-memory (default: `/tmp/ai-memory`) |
| `GITHUB_TOKEN` | No | Raises GitHub API rate limit from 60 to 5000 req/hr |
| `YOUTUBE_API_KEY` | No | Uses the official YouTube comments API before scraper fallback |
| `YOUTUBE_MAX_COMMENTS` | No | Bounded YouTube comment capture, 0-50 (default: 0) |
| `GOOGLE_DRIVE_MAX_BYTES` | No | Public Drive download cap in bytes (default: 25 MB) |
| `PDF_MAX_PAGES` | No | PDF text extraction page cap (default: 20) |
| `PDF_MAX_CHARS` | No | PDF text extraction character cap (default: 20000) |
| `TELEGRAM_BOT_TOKEN` | No | From [@BotFather](https://t.me/BotFather) |
| `TELEGRAM_CHAT_ID` | No | Your chat ID — enables notifications and two-way control |
| `TELEGRAM_USER_ID` | Recommended | Owner user ID; both chat and user must match when configured |
| `TELEGRAM_WEBHOOK_SECRET` | No | Random string to verify Telegram webhook requests |
| `MEDIA_UPLOAD_DIR` | For Telegram files | Private media directory (default `/tmp/tech-radar-media`) |
| `EXTRACTION_WORK_ROOT` | No | Dedicated managed root for temporary extraction artifacts (default: `$TMPDIR/tech-radar-extraction`) |
| `RUN_STATE_DIR` | Required in production | Durable accepted-run/callback records; production rejects missing, default, or temporary paths |
| `STOCKBOT_API_URL` | For finance | StockBot base URL |
| `STOCKBOT_SERVICE_TOKEN` | For finance | Dedicated Radar → StockBot bearer service token |
| `STOCKBOT_CALLBACK_SECRET` | For finance | Shared HMAC-SHA256 callback secret |
| `STOCKBOT_DETAIL_BASE_URL` | No | StockBot result deep-link base |
| `STOCKBOT_TIMEOUT_MS` | No | Handoff timeout (default 10000 ms; maximum 30000 ms) |
| `STOCKBOT_UPLOAD_SECRET` | For direct browser upload | HMAC secret for StockBot-issued upload tickets |
| `STOCKBOT_UPLOAD_ALLOWED_ORIGINS` | For direct browser upload | Exact comma-separated StockBot dashboard origins; wildcard and credentials are not allowed |
| `ROUTER_MODEL` | No | Model used only when deterministic routing is inconclusive |
| `PUBLIC_FEED_ALLOWED_ORIGINS` | No | Comma-separated exact origins granted CORS access to `/api/public/*` (no wildcard; empty = no CORS) |
| `PUBLIC_SITE_RADAR_BASE` | No | Base URL for RSS item links, e.g. `https://your-site.dev/radar` (default: the request origin) |
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
| `AUTH_TOKEN` | Recommended | Protects browser/admin APIs |
| `STOCKBOT_DISPATCH_TOKEN` | For StockBot dispatch | Protects `POST /runs` and service uploads |
| `RUN_STATE_DIR` | Yes in production | Non-temporary persistent volume for run and callback state |
| `GITHUB_TOKEN` | Recommended | GitHub API (5000 req/hr vs 60) |
| `YOUTUBE_API_KEY` | Optional | Official YouTube comments fetch before yt-dlp fallback |
| `YOUTUBE_MAX_COMMENTS` | Optional | Bounded YouTube comments captured per video |
| `GOOGLE_DRIVE_MAX_BYTES` | Optional | Public Drive download cap in bytes |
| `PDF_MAX_PAGES` | Optional | PDF text extraction page cap |
| `PDF_MAX_CHARS` | Optional | PDF text extraction character cap |
| `WHISPER_MODEL` | Optional | Transcription quality: `tiny`/`base`/`small` |
| `AI_MEMORY_REPO_URL` | Optional | Makes finding links in Telegram clickable |
| `OWNER_NAME` | Optional | Your name in agent prompts |
| `TARGET_PROJECTS` | Optional | Comma-separated list of your projects |
| `TELEGRAM_BOT_TOKEN` | Optional | Telegram notifications |
| `TELEGRAM_CHAT_ID` | Optional | Your Telegram chat ID |
| `PUBLIC_FEED_ALLOWED_ORIGINS` | Optional | Exact origins allowed CORS on `/api/public/*` |
| `PUBLIC_SITE_RADAR_BASE` | Optional | Base URL for RSS item links |

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

Bot commands: send or caption any public URL, `/stock <url>` for finance, `/tech <url>` for technology, `/status`, `/list`, `/help`. Owner-supplied videos are limited to 20 MB. Public URL media is limited to 30 minutes, and finance evidence contains at most ten securities.

Uploaded media is owner-authorized, saved under a generated filename with mode `0600`, processed locally by Whisper/OCR without a network or `file://` bypass, and never forwarded to StockBot. Media, frames, OCR outputs, and sidecars are deleted after enrichment and handoff on success or failure. The StockBot owner dashboard is the upload UI; Tech Radar intentionally does not add a second dashboard upload surface.

---

## iOS Shortcut

See [shortcuts/README.md](shortcuts/README.md) for step-by-step instructions. Takes about 2 minutes. Once set up, you can trigger a research run directly from Instagram, TikTok, YouTube, or a public Drive PDF share sheet without leaving the app.

---

## API reference

### `GET /healthz`
Returns `{ ok: true }`.

### `GET /`
Web UI — submit URLs, view run history.

### `POST /runs`
Requires `Authorization: Bearer <STOCKBOT_DISPATCH_TOKEN>`. The broader browser/admin token, cookies, and query-string tokens are not accepted. Callers should send a stable `Idempotency-Key` header.

```json
{ "url": "https://www.instagram.com/reel/...", "intent": "auto" }
```

Returns `202 { "runId": "...", "deduplicated": false }`. Repeating the same canonical source and exact intent returns the existing run as `202` with `deduplicated: true`, including when `force` is requested. Technology and finance remain distinct explicit passes.

`intent` is optional and must be `auto`, `technology`, or `finance`. The URL is canonicalized and deduplicated before queueing. Finance and mixed runs send the bounded, raw-text `SocialVideoEvidenceV1` contract to StockBot at `POST /api/internal/video-evidence`; untrusted-content wrappers are added only at LLM prompt boundaries. Tech Radar does not calculate finance verdicts.

### `POST /runs/upload`

Streams one multipart file field named `file` (maximum 20 MB) plus `intent`, `origin`, `idempotencyKey`, and `analysisId`. Server-to-server callers use `Authorization: Bearer <STOCKBOT_DISPATCH_TOKEN>` and may omit `Origin`. Direct StockBot dashboard uploads use `X-StockBot-Upload-Token`: base64url compact sorted JSON claims plus a hex HMAC-SHA256 over the encoded segment. Signed browser requests must include an exact `STOCKBOT_UPLOAD_ALLOWED_ORIGINS` match, and successful responses include the matching CORS origin. Tickets expire within ten minutes, bind every multipart field and the exact streamed byte count, and are consumed only after durable run registration succeeds.

### `POST /api/internal/stockbot/completion`

StockBot completion callback. It requires `X-StockBot-Timestamp` and `X-StockBot-Signature`; the signature is lowercase hex HMAC-SHA256 over `timestamp + "." + rawBody`. The body must identify both `runId` and `analysisId`, and terminal status may include `needs_review`. The route uses an atomic `pending`/`applied` event reservation under persistent `RUN_STATE_DIR`, rolls the reservation back when application fails, updates the exact correlated run through the durable INBOX repository, and sends the Telegram result/deep link before marking the event applied.

### `GET /runs`
Returns last 50 runs.

### `GET /runs/:id`
Returns a single run by ID.

### `GET /api/public/findings`
Public, sanitized finding summaries — no auth. Each item includes `applied: null | { appliedAt, link, note? }` sourced from `tech-radar/applied.json`.

### `GET /api/public/findings/rss`
RSS 2.0 feed of the 20 newest public findings (`application/rss+xml`). Item links use `PUBLIC_SITE_RADAR_BASE`.

### `GET /api/public/findings/:id`
Public, sanitized markdown detail for one finding — private sections are removed.

---

## Tech stack

| Layer | Choice |
|-------|--------|
| Runtime | Node.js 20 + TypeScript |
| HTTP | Fastify |
| Agents | Anthropic SDK (`claude-sonnet-4-6`) with tool use |
| Extraction | Python + yt-dlp + faster-whisper + pypdf |
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
