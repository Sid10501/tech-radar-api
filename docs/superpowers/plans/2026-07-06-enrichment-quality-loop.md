# Enrichment Quality Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make weak-post retries higher yield by adding deterministic GitHub search, avoiding duplicate findings for the same source URL, exposing retry history, and making OCR/vision gaps visible.

**Architecture:** Keep the current pipeline shape: extract -> deterministic enrichment -> research -> implementation -> compose -> ai-memory git write. Add structured GitHub search as a deterministic helper behind validation, add source-aware replacement in `AiMemoryRepo`, and expose retry history through the existing public/private finding APIs and current single-file dashboard.

**Tech Stack:** Node.js 20, TypeScript, Fastify, native `node:https`, simple-git, Vitest, current dashboard in `src/dashboard.ts`.

---

## File Map

| File | Purpose |
| --- | --- |
| `src/tools/github.ts` | Add GitHub repository search helper using GitHub's REST search API. |
| `src/linkEnrichment.ts` | Use curated resolvers first, then conservative GitHub search fallback for named tools with no explicit repo. |
| `src/extract.ts` | Extend enriched candidate metadata with search provenance. |
| `src/git.ts` | Add source-url aware finding replacement/superseding so forced retries do not create duplicate active findings. |
| `src/runner.ts` | Use source-aware write result and expose replaced finding metadata in run state. |
| `src/findings.ts` | Parse retry/superseded metadata and expose it in private/public summaries/details. |
| `src/dashboard.ts` | Render retry history and OCR/vision warnings in the existing explorer. |
| `test/linkEnrichment.test.ts` | TDD coverage for GitHub search fallback confidence gates. |
| `test/git.test.ts` | TDD coverage for replacing prior finding by source URL. |
| `test/findings.test.ts` | TDD coverage for retry/superseded metadata parsing. |
| `test/dashboard.test.ts` | TDD coverage for retry/diagnostic hooks. |

## Task 1: Deterministic GitHub Search Fallback

- [ ] Write failing tests in `test/linkEnrichment.test.ts` for a named tool with no URL resolving through a mocked GitHub search and lookup.
- [ ] Add `githubSearchRepositories()` to `src/tools/github.ts`.
- [ ] Add conservative name extraction and search candidate scoring in `src/linkEnrichment.ts`.
- [ ] Verify explicit links and curated resolvers still take precedence.

## Task 2: Source-Aware Retry Replacement

- [ ] Write failing tests in `test/git.test.ts` for replacing an old finding with the same source URL and writing a superseded marker.
- [ ] Add `writeFindingForSource()` in `src/git.ts`.
- [ ] Update `src/runner.ts` to use replacement result for run metadata, inbox, and index updates.

## Task 3: Retry History And Diagnostics In API/Dashboard

- [ ] Write failing parser/dashboard tests for superseded/retry metadata and extraction warnings.
- [ ] Extend finding summary/detail types in `src/findings.ts`.
- [ ] Render retry history and warnings in `src/dashboard.ts` without changing frameworks or public/private auth boundaries.

## Task 4: Verify And Deploy

- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Run browser/local smoke if dashboard markup changes are non-trivial.
- [ ] Merge through PR, deploy with `railway up --detach`, and production smoke-check `/healthz`, `/api/public/audit`, and known detail pages.
