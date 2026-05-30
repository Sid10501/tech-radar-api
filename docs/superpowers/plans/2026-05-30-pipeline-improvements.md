# Pipeline Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Six independent improvements to tech-radar-api: early bail on junk posts, GITHUB_TOKEN docs, configurable Whisper model, implementation agent session reading, AI_MEMORY_REPO_URL warning, and iOS Shortcut README polish.

**Architecture:** Each improvement is fully isolated — one task per improvement, touching only the files listed. Batch 1 (tasks 2, 5, 6) is pure docs and can be done in parallel. Batch 2 (tasks 3, 4) is code + tests, parallel. Batch 3 (task 1) is the largest change, done last after runner.ts is stable. Every task ends with a commit and a verification step.

**Tech Stack:** Node.js 20, TypeScript, Fastify, Anthropic SDK, Python 3 (extract_post.py), Vitest, simple-git, Railway

---

## File Map

| File | Tasks that touch it |
|------|-------------------|
| `src/runner.ts` | Task 1 |
| `src/telegram.ts` | Task 1 |
| `src/server.ts` | Task 1, Task 5 |
| `src/agents/prompts.ts` | Task 4 |
| `src/agents/implementation.ts` | Task 4 |
| `scripts/extract_post.py` | Task 3 |
| `.env.example` | Task 2, Task 3, Task 5 |
| `MEMORY.md` | Task 2, Task 3, Task 5 |
| `README.md` | Task 2 |
| `shortcuts/README.md` | Task 6 |
| `test/runner.e2e.test.ts` | Task 1 |
| `test/runner.hydrate.test.ts` | Task 1 |
| `test/agents/implementation.test.ts` | Task 4 |

---

## BATCH 1 — Pure docs (Tasks 2, 5, 6 — run in parallel)

---

### Task 2: GITHUB_TOKEN documentation

**Files:**
- Modify: `.env.example`
- Modify: `MEMORY.md`
- Modify: `README.md`

Context: `src/tools/github.ts` already reads `GITHUB_TOKEN` and sets the `Authorization` header. Without it, the GitHub API allows only 60 unauthenticated requests/hour — easily exhausted.

- [ ] **Step 1: Add GITHUB_TOKEN to `.env.example`**

The file already has `GITHUB_TOKEN=ghp_...` — verify it's there:

```bash
grep -n "GITHUB_TOKEN" /Users/work/Repositories/tech-radar-api/.env.example
```

Expected: line with `GITHUB_TOKEN=ghp_...`. If missing, add after the `# Optional — GitHub API` comment:

```
# Optional — GitHub API (increases rate limit from 60 to 5000 req/hr)
GITHUB_TOKEN=ghp_...
```

- [ ] **Step 2: Add gotcha to MEMORY.md**

In `MEMORY.md`, find the `## Common Gotchas` section and add this entry:

```markdown
- `GITHUB_TOKEN` is optional but strongly recommended — without it the GitHub API rate-limits to 60 req/hour. Create a classic token at github.com/settings/tokens with no scopes (public repo read is enough) and set it in Railway Variables.
```

- [ ] **Step 3: Add to README.md Railway variables checklist**

Find the section around line 161 (`Set all env vars under **Variables** in the Railway dashboard`). Add a callout directly after it:

```markdown
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
```

- [ ] **Step 4: Commit**

```bash
cd /Users/work/Repositories/tech-radar-api
git add .env.example MEMORY.md README.md
git commit -m "docs: document GITHUB_TOKEN env var and Railway variables table"
```

---

### Task 5: AI_MEMORY_REPO_URL startup warning + docs

**Files:**
- Modify: `src/server.ts` (lines 157–167, the `if (process.argv[1] === ...)` block)
- Modify: `.env.example`
- Modify: `MEMORY.md`

Context: `AI_MEMORY_REPO_URL` is already referenced in `runner.ts` (line ~220) and `telegram.ts` to build GitHub links. If unset, links are bare paths. Fastify's built-in pino logger is available via `app.log` but the startup block runs before `buildServer()` — use `console.warn` there.

- [ ] **Step 1: Add startup warning to `src/server.ts`**

Find the startup block (around line 157):

```typescript
if (process.argv[1] === new URL(import.meta.url).pathname) {
  // Hydrate run history from persisted INBOX.md on startup
  const aiMemoryDir = process.env["AI_MEMORY_LOCAL_DIR"];
  if (aiMemoryDir) {
    hydrateRunsFromInbox(path.join(aiMemoryDir, "tech-radar", "INBOX.md"));
  }

  const app = buildServer();
  const port = Number(process.env["PORT"] ?? 3000);
  await app.listen({ port, host: "0.0.0.0" });
  console.log(`listening on port ${port}`);
}
```

Replace with:

```typescript
if (process.argv[1] === new URL(import.meta.url).pathname) {
  // Hydrate run history from persisted INBOX.md on startup
  const aiMemoryDir = process.env["AI_MEMORY_LOCAL_DIR"];
  if (aiMemoryDir) {
    hydrateRunsFromInbox(path.join(aiMemoryDir, "tech-radar", "INBOX.md"));
  }

  if (!process.env["AI_MEMORY_REPO_URL"]) {
    console.warn("[warn] AI_MEMORY_REPO_URL not set — Telegram finding links will be bare paths");
  }

  const app = buildServer();
  const port = Number(process.env["PORT"] ?? 3000);
  await app.listen({ port, host: "0.0.0.0" });
  console.log(`listening on port ${port}`);
}
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/work/Repositories/tech-radar-api
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Add to `.env.example`**

`AI_MEMORY_REPO_URL` is already in `.env.example`. Verify the comment is clear:

```bash
grep -n "AI_MEMORY_REPO_URL" /Users/work/Repositories/tech-radar-api/.env.example
```

Expected output: `AI_MEMORY_REPO_URL=https://github.com/youruser/ai-memory   # used for finding links in the web UI`

If the comment doesn't mention Telegram, update it to:

```
AI_MEMORY_REPO_URL=https://github.com/youruser/ai-memory   # makes finding links clickable in Telegram notifications and web UI
```

- [ ] **Step 4: Add gotcha to MEMORY.md**

In `MEMORY.md`, in `## Common Gotchas`, add:

```markdown
- `AI_MEMORY_REPO_URL` should be set to your public ai-memory GitHub URL (e.g. `https://github.com/Sid10501/ai-memory`). Without it, Telegram success notifications show bare file paths instead of clickable links.
```

- [ ] **Step 5: Run tests to confirm no regression**

```bash
cd /Users/work/Repositories/tech-radar-api
npm test
```

Expected: `Tests 27 passed (27)` (startup warning only fires when the module is run directly, not in tests).

- [ ] **Step 6: Commit**

```bash
git add src/server.ts .env.example MEMORY.md
git commit -m "feat: warn on startup if AI_MEMORY_REPO_URL unset; improve docs"
```

---

### Task 6: iOS Shortcut README rewrite

**Files:**
- Modify: `shortcuts/README.md`

Context: The current README buries the two critical values (Railway URL + auth token) deep in the setup flow. The goal is to front-load them so someone can set up the shortcut in under 2 minutes.

- [ ] **Step 1: Rewrite `shortcuts/README.md`**

Replace the entire file with:

```markdown
# iOS Shortcut — Research This

One tap from any Instagram, TikTok, or YouTube post to a structured finding in your knowledge base.

---

## Before you start — two values you need

| Value | Where to find it |
|-------|-----------------|
| `YOUR_RAILWAY_URL` | Railway dashboard → your service → Settings → Domain (e.g. `https://tech-radar-api-production.up.railway.app`) |
| `YOUR_AUTH_TOKEN` | The `AUTH_TOKEN` value in your Railway Variables |

Have these ready before building the shortcut.

---

## Quick start (share sheet — recommended)

1. Open **Shortcuts** app → tap **+**
2. Build the 3 actions below in order
3. Tap **ⓘ** → enable **Show in Share Sheet** → Receive: **URLs**

Then: on any Instagram/TikTok/YouTube post, tap **Share** → **Research This** → done.

---

## The 3 actions

### Action 1: Get the URL
- Action: `Shortcut Input`
- Use: `Provided Input` (this is the URL from the share sheet)

> **Clipboard fallback:** If you prefer to copy links manually, replace this with `Get Clipboard`.

### Action 2: POST to your pipeline
- Action: `Get Contents of URL`
- URL: `https://YOUR_RAILWAY_URL/runs`
- Method: `POST`
- Headers:
  - `Content-Type` → `application/json`
  - `Authorization` → `Bearer YOUR_AUTH_TOKEN`
- Request Body: `JSON`
  - Key: `url` — Value: tap the variable picker → choose **Shortcut Input** (or Clipboard)

### Action 3: Confirm
- Action: `Show Notification`
- Title: `Tech Radar`
- Body: `Queued for research ✓`

---

## Naming and icon

- Name it **Research This**
- Tap the icon → choose the radar or antenna symbol

---

## Testing it

1. Open Instagram, find a post about a dev tool
2. Tap **Share** → scroll to **Research This** → tap
3. You should get the "Queued for research ✓" notification
4. Check your Telegram bot or Railway URL — the run should appear within seconds

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| "Unauthorized" error | Double-check `AUTH_TOKEN` matches your Railway variable exactly |
| No notification | Make sure Shortcuts has notification permission in iOS Settings |
| Run doesn't appear | Check Railway logs — the URL may have failed to extract |
| Share sheet doesn't show the shortcut | Enable "Show in Share Sheet" in the shortcut's ⓘ settings |
```

- [ ] **Step 2: Commit**

```bash
cd /Users/work/Repositories/tech-radar-api
git add shortcuts/README.md
git commit -m "docs: rewrite iOS Shortcut README — front-load setup values and quick start"
```

---

## BATCH 2 — Code changes with tests (Tasks 3, 4 — run in parallel)

---

### Task 3: Configurable Whisper model via WHISPER_MODEL env var

**Files:**
- Modify: `scripts/extract_post.py` (line 174)
- Modify: `.env.example`
- Modify: `MEMORY.md`

Context: Line 174 of `extract_post.py` hardcodes `WhisperModel("tiny", ...)`. The `tiny` model misses technical proper nouns. `base` gives meaningfully better accuracy with modest extra CPU time. No test changes needed — existing TypeScript tests mock the script entirely.

- [ ] **Step 1: Add `import os` to `extract_post.py`**

Check if `os` is already imported:

```bash
grep -n "^import os" /Users/work/Repositories/tech-radar-api/scripts/extract_post.py
```

If not present, add `import os` after the existing stdlib imports (around line 10, after `import sys`):

```python
import os
```

- [ ] **Step 2: Replace hardcoded model name**

Find line 174:
```python
        model = WhisperModel("tiny", device="cpu", compute_type="int8")
```

Replace with:
```python
        whisper_model = os.environ.get("WHISPER_MODEL", "tiny")
        model = WhisperModel(whisper_model, device="cpu", compute_type="int8")
```

- [ ] **Step 3: Verify the change looks correct**

```bash
grep -n "WHISPER_MODEL\|WhisperModel" /Users/work/Repositories/tech-radar-api/scripts/extract_post.py
```

Expected output:
```
168:    """Return (transcript, error). Uses faster-whisper with the 'tiny' model."""
174:        whisper_model = os.environ.get("WHISPER_MODEL", "tiny")
175:        model = WhisperModel(whisper_model, device="cpu", compute_type="int8")
```

- [ ] **Step 4: Update `.env.example`**

Add `WHISPER_MODEL` under the `# Optional` section. Find a good place near `EXTRACT_SCRIPT_PATH`:

```
# Optional — transcription quality (tiny/base/small/medium/large-v3, default: tiny)
# Recommended for Railway: base (better proper-noun recognition, ~2x CPU cost vs tiny)
WHISPER_MODEL=
```

- [ ] **Step 5: Update MEMORY.md**

In `## Common Gotchas`, add:

```markdown
- `WHISPER_MODEL` defaults to `tiny` — set to `base` in Railway for significantly better transcript quality on technical posts (proper nouns, library names). `small` and above are too slow for Railway's free tier CPU.
```

- [ ] **Step 6: Run tests to confirm no regression**

```bash
cd /Users/work/Repositories/tech-radar-api
npm test
```

Expected: `Tests 27 passed (27)` — Python script changes don't affect TypeScript tests.

- [ ] **Step 7: Commit**

```bash
git add scripts/extract_post.py .env.example MEMORY.md
git commit -m "feat: configurable Whisper model via WHISPER_MODEL env var (default: tiny)"
```

---

### Task 4: Implementation agent always reads 2 most recent sessions

**Files:**
- Modify: `src/agents/prompts.ts` (line 43)
- Modify: `src/agents/implementation.ts` (line 96)
- Modify: `test/agents/implementation.test.ts`

Context: Line 43 of `prompts.ts` says "Optionally read 1-2 recent sessions" — the model almost always skips it. Line 96 of `implementation.ts` has the user message with the same optional wording. The fix is two string changes + adding a mock assertion in the test.

- [ ] **Step 1: Update the system prompt in `src/agents/prompts.ts`**

Find line 43:
```typescript
Always read GLOBAL_MEMORY.md first. Then read domains/webdev.md for stack preferences. Optionally read 1-2 recent sessions for context.
```

Replace with:
```typescript
Always read GLOBAL_MEMORY.md first. Then read domains/webdev.md for stack preferences. Then always call list_recent_sessions and read the 2 most recent session files for current project context.
```

- [ ] **Step 2: Update the user message in `src/agents/implementation.ts`**

Find line 96:
```typescript
Read GLOBAL_MEMORY.md first, then domains/webdev.md, and optionally 1-2 recent sessions. Then produce the JSON output.`;
```

Replace with:
```typescript
Read GLOBAL_MEMORY.md first, then domains/webdev.md, then call list_recent_sessions and read the 2 most recent session files. Then produce the JSON output.`;
```

- [ ] **Step 3: Update the implementation test to assert `list_recent_sessions` is called**

Open `test/agents/implementation.test.ts`. The mock currently has two `mockResolvedValueOnce` calls:
1. Tool call for `read_ai_memory` (GLOBAL_MEMORY.md)
2. Final JSON response

We need to add mock responses for `list_recent_sessions` and the two session reads. Update the mock sequence to:

```typescript
// First call: read GLOBAL_MEMORY.md
mockCreate.mockResolvedValueOnce({
  id: "msg_1",
  type: "message",
  role: "assistant",
  content: [
    {
      type: "tool_use",
      id: "tool_1",
      name: "read_ai_memory",
      input: { path: "GLOBAL_MEMORY.md" },
    },
  ],
  stop_reason: "tool_use",
  usage: { input_tokens: 500, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
});

// Second call: list recent sessions
mockCreate.mockResolvedValueOnce({
  id: "msg_2",
  type: "message",
  role: "assistant",
  content: [
    {
      type: "tool_use",
      id: "tool_2",
      name: "list_recent_sessions",
      input: { n: 2 },
    },
  ],
  stop_reason: "tool_use",
  usage: { input_tokens: 550, output_tokens: 30, cache_read_input_tokens: 400, cache_creation_input_tokens: 0 },
});

// Third call: final JSON response
mockCreate.mockResolvedValueOnce({
  id: "msg_3",
  type: "message",
  role: "assistant",
  content: [
    {
      type: "text",
      text: JSON.stringify(CANNED_IMPLEMENTATION),
    },
  ],
  stop_reason: "end_turn",
  usage: { input_tokens: 600, output_tokens: 200, cache_read_input_tokens: 400, cache_creation_input_tokens: 0 },
});
```

Also update the assertion at the bottom of the test to check `list_recent_sessions` was called:

Since `listRecentSessions` is already mocked via `vi.mock("../../src/tools/ai_memory.js", ...)`, add a spy check. Replace the existing assertion block at the end of the test with:

```typescript
// Must have read GLOBAL_MEMORY.md
expect(memoryFilesRead).toContain("GLOBAL_MEMORY.md");

// list_recent_sessions must have been invoked
const { listRecentSessions } = await import("../../src/tools/ai_memory.js");
expect(listRecentSessions).toHaveBeenCalled();

// Output must parse against ImplementationOutputSchema
expect(result.fit_for_owner).toBeTruthy();
expect(["Cross-Tax", "StockBot", "Finance Assistant", "new project", "none"]).toContain(result.target_project);
expect(result.implementation_idea_markdown).toBeTruthy();
expect(Array.isArray(result.follow_ups)).toBe(true);
```

- [ ] **Step 4: Run the failing test to verify the assertion is correct**

```bash
cd /Users/work/Repositories/tech-radar-api
npx vitest run test/agents/implementation.test.ts
```

Expected: test passes (the mock sequence now includes a `list_recent_sessions` call, and the spy confirms it was invoked).

- [ ] **Step 5: Run full test suite**

```bash
npm test
```

Expected: `Tests 27 passed (27)` — no regressions.

- [ ] **Step 6: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/agents/prompts.ts src/agents/implementation.ts test/agents/implementation.test.ts
git commit -m "feat: implementation agent always reads 2 most recent sessions"
```

---

## BATCH 3 — Early bail + skipped status + /retry (Task 1 — sequential, last)

---

### Task 1: Early bail on junk posts + skipped status + /retry Telegram command

**Files:**
- Modify: `src/runner.ts`
- Modify: `src/telegram.ts`
- Modify: `src/server.ts`
- Modify: `test/runner.e2e.test.ts`
- Modify: `test/runner.hydrate.test.ts`

Context: Currently the pipeline runs all 5 steps even when a post has no caption and no transcript. This task adds a bail guard after `extract()`, a new `skipped` run status, and a `/retry` Telegram command to force-retry any URL.

Key invariants:
- Dedup guard (`DuplicateRunError`) blocks `pending`, `running`, `processed` only — NOT `skipped` or `failed`
- `/retry <url>` passes `{ force: true }` to `runPipeline`, bypassing dedup for all statuses
- `skipped` is not an error — no Telegram error notification, no throw

---

- [ ] **Step 1: Add `skipped` to the `Run` type and `RunPipelineOptions` in `src/runner.ts`**

Find the `Run` interface (around line 12):
```typescript
export interface Run {
  id: string;
  url: string;
  status: "pending" | "running" | "processed" | "failed";
  findingPath?: string;
  error?: string;
  startedAt: string;
  finishedAt?: string;
}
```

Replace with:
```typescript
export interface Run {
  id: string;
  url: string;
  status: "pending" | "running" | "processed" | "failed" | "skipped";
  findingPath?: string;
  error?: string;
  startedAt: string;
  finishedAt?: string;
}
```

Find `RunPipelineOptions`:
```typescript
export interface RunPipelineOptions {
  remoteUrl?: string;
  localDir?: string;
  aiMemoryDir?: string;
}
```

Replace with:
```typescript
export interface RunPipelineOptions {
  remoteUrl?: string;
  localDir?: string;
  aiMemoryDir?: string;
  force?: boolean;
}
```

- [ ] **Step 2: Update the dedup guard to allow `skipped` and `failed`, and respect `force`**

Find the dedup check at the top of `runPipeline` (around line 128):
```typescript
  const existing = findRunByUrl(url);
  if (existing && (existing.status === "pending" || existing.status === "running" || existing.status === "processed")) {
    throw new DuplicateRunError(existing);
  }
```

Replace with:
```typescript
  if (!opts.force) {
    const existing = findRunByUrl(url);
    if (existing && (existing.status === "pending" || existing.status === "running" || existing.status === "processed")) {
      throw new DuplicateRunError(existing);
    }
  }
```

- [ ] **Step 3: Add the bail guard after `extract()` in `src/runner.ts`**

Find the extract call (around line 182):
```typescript
    // Step 1: Extract
    const extractResult = await extract(url);

    // Step 2: Research
    const researchResult = await runResearch(extractResult);
```

Replace with:
```typescript
    // Step 1: Extract
    const extractResult = await extract(url);

    // Bail early if the post has no usable content — skip agents entirely
    const hasContent = (extractResult.caption && extractResult.caption.trim()) ||
                       (extractResult.transcript && extractResult.transcript.trim());
    if (extractResult.status === "failed" || !hasContent) {
      const skipReason = extractResult.status === "failed"
        ? (extractResult.error ?? "extract failed")
        : "no caption or transcript";
      await repo.updateInbox({ url, status: "skipped", finding: null, date: today, error: skipReason });
      await repo.commitAndPush(`tech-radar: skipped ${url.slice(0, 60)}`);

      run.status = "skipped";
      run.error = skipReason;
      run.finishedAt = new Date().toISOString();
      storeRun(run);

      sendTelegram(`⏭️ *Skipped* (${skipReason}):\n${url.slice(0, 80)}`);
      releaseSlot();
      return { runId, findingPath: "" };
    }

    // Step 2: Research
    const researchResult = await runResearch(extractResult);
```

- [ ] **Step 4: Update `InboxRow` type in `src/git.ts` to accept `skipped`**

Find:
```typescript
export interface InboxRow {
  url: string;
  status: "pending" | "processed" | "failed";
  finding: string | null;
  date: string;
  error?: string;
}
```

Replace with:
```typescript
export interface InboxRow {
  url: string;
  status: "pending" | "processed" | "failed" | "skipped";
  finding: string | null;
  date: string;
  error?: string;
}
```

- [ ] **Step 5: Type-check after runner + git changes**

```bash
cd /Users/work/Repositories/tech-radar-api
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Add `.status-skipped` CSS to the web UI in `src/server.ts`**

Find the CSS block (around line 20):
```typescript
    .status-processed { color: #0a7; }
    .status-failed { color: #c00; }
    .status-running, .status-pending { color: #777; }
```

Replace with:
```typescript
    .status-processed { color: #0a7; }
    .status-failed { color: #c00; }
    .status-running, .status-pending { color: #777; }
    .status-skipped { color: #999; }
```

- [ ] **Step 7: Add `/retry` command to `src/telegram.ts`**

Find the `/status` handler block:
```typescript
  // /status
  if (text === "/status") {
```

Add the `/retry` handler BEFORE it:
```typescript
  // /retry <url>
  if (text.startsWith("/retry")) {
    const retryUrl = text.replace("/retry", "").trim();
    if (!retryUrl) {
      reply(chatId, "Usage: `/retry <url>`");
      return;
    }
    reply(chatId, `⏳ Force-retrying:\n${retryUrl}`);
    runPipeline(retryUrl, { force: true }).catch((err: unknown) => {
      reply(chatId, `❌ Retry failed: \`${err instanceof Error ? err.message.slice(0, 200) : String(err)}\``);
    });
    return;
  }

  // /status
  if (text === "/status") {
```

- [ ] **Step 8: Update `/help` text in `src/telegram.ts` to include `/retry`**

Find the help reply:
```typescript
    reply(chatId, [
      "🔭 *Tech Radar Bot*",
      "",
      "Send any Instagram, YouTube, or TikTok URL to research it\\.",
      "",
      "Commands:",
      "`/status` — last 5 runs",
      "`/list` — recent findings with links",
      "`/help` — this message",
    ].join("\n"));
```

Replace with:
```typescript
    reply(chatId, [
      "🔭 *Tech Radar Bot*",
      "",
      "Send any Instagram, YouTube, or TikTok URL to research it\\.",
      "",
      "Commands:",
      "`/status` — last 5 runs",
      "`/list` — recent findings with links",
      "`/retry <url>` — force\\-retry any URL \\(ignores dedup\\)",
      "`/help` — this message",
    ].join("\n"));
```

- [ ] **Step 9: Type-check after all changes**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 10: Write failing tests for the bail guard**

Open `test/runner.e2e.test.ts`. After the existing two test cases, add two new cases inside the `describe("runPipeline()")` block:

```typescript
  it("marks run as skipped when extract returns status: failed", async () => {
    const extractFixture = JSON.parse(
      fs.readFileSync(path.join(FIXTURE_DIR, "extract_youtube.json"), "utf8"),
    );
    // Override status to failed
    const failedExtract = { ...extractFixture, status: "failed", error: "yt-dlp error: 403" };

    vi.doMock("../src/extract.js", () => ({
      extract: vi.fn(async () => failedExtract),
      ExtractError: class ExtractError extends Error {},
    }));

    vi.doMock("@anthropic-ai/sdk", () => ({
      default: vi.fn().mockImplementation(() => ({
        messages: { create: vi.fn() },
      })),
    }));

    const localDir = fs.mkdtempSync(path.join(os.tmpdir(), "runner-skip1-"));
    try {
      const { runPipeline, listRuns } = await import("../src/runner.js");

      const result = await runPipeline(
        "https://www.instagram.com/reel/skip-test-1/",
        { remoteUrl: bareDir, localDir },
      );

      expect(result.runId).toBeTruthy();
      expect(result.findingPath).toBe("");

      const runs = listRuns();
      const skipped = runs.find((r) => r.url === "https://www.instagram.com/reel/skip-test-1/");
      expect(skipped?.status).toBe("skipped");
      expect(skipped?.error).toContain("yt-dlp error");
    } finally {
      fs.rmSync(localDir, { recursive: true, force: true });
    }
  });

  it("marks run as skipped when extract returns no caption and no transcript", async () => {
    const emptyExtract = {
      url: "https://www.instagram.com/reel/skip-test-2/",
      platform: "instagram",
      status: "partial",
      error: null,
      title: "Some post",
      creator: "someone",
      caption: null,
      hashtags: [],
      duration_sec: 30,
      transcript: null,
      transcript_source: null,
      upload_date: "2026-05-30",
      raw_metadata_keys: [],
    };

    vi.doMock("../src/extract.js", () => ({
      extract: vi.fn(async () => emptyExtract),
      ExtractError: class ExtractError extends Error {},
    }));

    vi.doMock("@anthropic-ai/sdk", () => ({
      default: vi.fn().mockImplementation(() => ({
        messages: { create: vi.fn() },
      })),
    }));

    const localDir = fs.mkdtempSync(path.join(os.tmpdir(), "runner-skip2-"));
    try {
      const { runPipeline, listRuns } = await import("../src/runner.js");

      const result = await runPipeline(
        "https://www.instagram.com/reel/skip-test-2/",
        { remoteUrl: bareDir, localDir },
      );

      expect(result.findingPath).toBe("");

      const runs = listRuns();
      const skipped = runs.find((r) => r.url === "https://www.instagram.com/reel/skip-test-2/");
      expect(skipped?.status).toBe("skipped");
      expect(skipped?.error).toBe("no caption or transcript");
    } finally {
      fs.rmSync(localDir, { recursive: true, force: true });
    }
  });
```

- [ ] **Step 11: Update `test/runner.hydrate.test.ts` to cover `skipped` status**

In the existing "populates listRuns() from a well-formed INBOX.md" test, add a `skipped` row to the INBOX content:

```typescript
    const inboxContent = `# Tech Radar Inbox

| Date | URL | Status | Finding | Error |
|------|-----|--------|---------|-------|
| 2026-05-04 | https://www.instagram.com/reel/abc | processed | 2026-05-04-some-tool.md |  |
| 2026-05-05 | https://www.tiktok.com/@foo/video/1 | failed |  | extract failed |
| 2026-05-06 | https://www.instagram.com/reel/dm-gated | skipped |  | no caption or transcript |
<!-- new rows inserted above this line -->
`;
```

Add an assertion after the existing ones:

```typescript
    const skipped = runs.find((r) => r.url === "https://www.instagram.com/reel/dm-gated");
    expect(skipped?.status).toBe("skipped");
    expect(skipped?.error).toBe("no caption or transcript");
```

- [ ] **Step 12: Run the full test suite**

```bash
cd /Users/work/Repositories/tech-radar-api
npm test
```

Expected: `Tests 31 passed (31)` (4 new tests: 2 bail guard e2e, 1 hydrate skipped row, and the implementation test already had its session assertion from Task 4).

- [ ] **Step 13: Final type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 14: Commit**

```bash
git add src/runner.ts src/telegram.ts src/server.ts src/git.ts test/runner.e2e.test.ts test/runner.hydrate.test.ts
git commit -m "feat: early bail on junk posts, skipped status, /retry Telegram command"
```

---

## Final verification

- [ ] **Run full test suite one last time**

```bash
cd /Users/work/Repositories/tech-radar-api
npm test && npx tsc --noEmit
```

Expected: all tests pass, no TypeScript errors.

- [ ] **Check git log**

```bash
git log --oneline -8
```

Expected to see (in order, newest first):
```
feat: early bail on junk posts, skipped status, /retry Telegram command
feat: implementation agent always reads 2 most recent sessions
feat: configurable Whisper model via WHISPER_MODEL env var (default: tiny)
feat: warn on startup if AI_MEMORY_REPO_URL unset; improve docs
docs: rewrite iOS Shortcut README — front-load setup values and quick start
docs: document GITHUB_TOKEN env var and Railway variables table
docs: fix dedup/retry consistency in design spec
docs: pipeline improvements design spec (6 improvements)
```
