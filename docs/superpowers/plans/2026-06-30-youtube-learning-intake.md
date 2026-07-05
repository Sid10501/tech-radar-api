# YouTube Learning Intake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich YouTube tech-radar findings with subtitle-first transcripts, source links, extraction provenance, and top comment evidence so the dashboard can act as a learning walkthrough.

**Architecture:** Keep the existing explicit pipeline. Extend the extractor JSON contract with optional evidence fields, pass those fields into agent prompts through existing untrusted-content wrappers, and render the evidence in the composed markdown that the dashboard already displays.

**Tech Stack:** Node.js 20, TypeScript, Fastify, Zod, Vitest, Python extractor, yt-dlp, faster-whisper, ffmpeg, tesseract.

---

### Task 1: Enriched Extract Contract

**Files:**
- Modify: `src/extract.ts`
- Modify: `src/lib/extractForLlm.ts`
- Test: `test/lib/extractForLlm.test.ts`

- [x] **Step 1: Write failing tests**

Add tests that show source links and comments are included in the research prompt, with comments wrapped as untrusted external content.

- [x] **Step 2: Run focused tests**

Run: `npm test -- test/lib/extractForLlm.test.ts`
Expected: fail because the prompt does not include source links or comments yet.

- [x] **Step 3: Implement the minimal contract**

Add optional `source_links`, `top_comments`, and `extraction_methods` fields to `ExtractResult`. Update `buildResearchUserMessage` to include source links as metadata and top comments through `wrapAsUntrusted`.

- [x] **Step 4: Verify focused tests**

Run: `npm test -- test/lib/extractForLlm.test.ts`
Expected: pass.

### Task 2: Composed Learning Evidence

**Files:**
- Modify: `src/compose.ts`
- Modify: `test/fixtures/extract_youtube.json`
- Test: `test/compose.test.ts`
- Test: `test/findings.test.ts`

- [x] **Step 1: Write failing tests**

Update the YouTube fixture with source links, extraction methods, and comments. Assert that composed markdown includes extraction path, source links, and top comments under `What the post showed`.

- [x] **Step 2: Run focused tests**

Run: `npm test -- test/compose.test.ts test/findings.test.ts`
Expected: fail because composed markdown does not render those fields yet.

- [x] **Step 3: Implement compose output**

Render optional `Extraction path`, `Source links found`, and `Top comments` blocks under `What the post showed`, preserving the current dashboard parser headings.

- [x] **Step 4: Verify focused tests**

Run: `npm test -- test/compose.test.ts test/findings.test.ts`
Expected: pass.

### Task 3: Python Extractor Enrichment

**Files:**
- Modify: `scripts/extract_post.py`
- Modify: `src/extract.ts`

- [x] **Step 1: Implement subtitle-first extraction**

Use yt-dlp subtitle download options for YouTube. Prefer English subtitle text as `transcript` with `transcript_source: "subs"` before falling back to Whisper.

- [x] **Step 2: Implement low-risk evidence capture**

Parse URLs from descriptions into `source_links`, record successful extraction methods in `extraction_methods`, and capture bounded top comments through yt-dlp when `YOUTUBE_MAX_COMMENTS` is greater than 0.

- [x] **Step 3: Run a real extraction smoke test**

Run: `YOUTUBE_MAX_COMMENTS=5 bash scripts/run_pipeline.sh "https://www.youtube.com/watch?v=iQyg-KypKAA"`
Expected: JSON includes `platform: "youtube"`, non-empty `transcript`, `transcript_source: "subs"` when subtitles resolve, `source_links`, `extraction_methods`, and bounded `top_comments`.

### Task 4: Full Verification

**Files:**
- Verify all touched code.

- [x] **Step 1: Run tests**

Run: `npm test`
Expected: all tests pass.

- [x] **Step 2: Run build**

Run: `npm run build`
Expected: TypeScript build succeeds.

### Task 5: Research-Informed YouTube Intake Upgrade

**Files:**
- Modify: `scripts/extract_post.py`
- Modify: `scripts/run_pipeline.sh`
- Modify: `Dockerfile`
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `src/extract.ts`
- Modify: `src/lib/extractForLlm.ts`
- Modify: `src/compose.ts`
- Modify: `src/findings.ts`
- Modify: `src/dashboard.ts`
- Test: `test/extract_post_test.py`
- Test: `test/lib/extractForLlm.test.ts`
- Test: `test/compose.test.ts`
- Test: `test/findings.test.ts`

- [x] **Step 1: Add transcript API fallback**

Use `youtube-transcript-api` before subtitle-file fallback, with yt-dlp subtitles and Whisper/audio still available as recovery paths.

- [x] **Step 2: Add comment source ladder**

Use `YOUTUBE_API_KEY` with the official YouTube Data API comments endpoint when configured, then fall back to bounded yt-dlp CLI comments.

- [x] **Step 3: Add chapter navigation**

Extract yt-dlp chapters into the extractor contract, pass them to the research prompt as untrusted external structure, and render them in composed findings.

- [x] **Step 4: Fix dashboard evidence boundaries**

Split transcript, chapters, OCR, extraction path, source links, and comments into separate detail panels so evidence blocks do not get folded into OCR.

- [x] **Step 5: Verify**

Run Python unit tests, py_compile, full Vitest, TypeScript build, and a live smoke extraction against `https://www.youtube.com/watch?v=iQyg-KypKAA`.
