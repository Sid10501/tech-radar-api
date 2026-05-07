# Contributing

This is a personal tool built for a specific workflow. Contributions are welcome but should stay within that scope — making it easier to self-host, more reliable, or more useful for other solo developers with a knowledge base.

## What fits

- Bug fixes
- Better error messages or observability
- Support for additional social platforms (YouTube Shorts, Twitter/X, LinkedIn)
- Improvements to the extraction quality or agent prompts
- Documentation improvements

## What doesn't fit

- Turning this into a multi-user SaaS
- Adding a database (the flat-file + git model is intentional)
- UI rewrites (the minimal web UI is intentional)

## Setup

```bash
git clone https://github.com/Sid10501/tech-radar-api
cd tech-radar-api
npm install
cp .env.example .env   # fill in your values
npm run dev
```

Tests:

```bash
npm test
```

## Before opening a PR

- Run `npm test` and `npm run build` — both must pass
- Keep changes focused; one thing per PR
- If you're changing agent prompts, include before/after example outputs in the PR description
