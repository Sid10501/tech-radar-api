import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const FIXTURE_DIR = path.resolve(fileURLToPath(import.meta.url), "../fixtures");

const extractFixture = JSON.parse(
  fs.readFileSync(path.join(FIXTURE_DIR, "extract_youtube.json"), "utf8"),
);

const researchFixture = {
  what: "Zod 4 is a TypeScript-first schema validation library with improved performance.",
  who: "Colin McDonnell (@colinhacks)",
  status: "stable" as const,
  why: "Faster parsing, smaller bundle, better TypeScript inference over Zod 3.",
  comparisons: ["Valibot", "Yup", "io-ts"],
  links: {
    github: "https://github.com/colinhacks/zod",
    docs: "https://zod.dev",
    npm: "https://www.npmjs.com/package/zod",
  },
  kickstarter: "Install with `npm install zod@^4.0.0`. Import `z` and define schemas.",
  viability_signals: {
    github_stars: 32000,
    last_pushed: "2026-04-01T00:00:00Z",
    open_issues: 42,
    license: "MIT",
    archived: false,
  },
};

const implementationFixture = {
  fit_for_owner: "Zod 4 is a direct upgrade for Cross-Tax, which already uses Zod 3.",
  target_project: "Cross-Tax" as const,
  implementation_idea_markdown: "Upgrade the Cross-Tax API input validation layer from Zod 3 to Zod 4. The new `.parse()` is 14x faster and tree-shaking reduces bundle size.\n\n```typescript\nimport { z } from 'zod';\nconst schema = z.object({ amount: z.number() });\n```\n",
  follow_ups: ["Check current Zod version in Cross-Tax", "Run codemods for breaking changes"],
};

describe("composeFinding()", () => {
  it("produces a markdown file with all required sections", async () => {
    const { composeFinding } = await import("../src/compose.js");

    const { filename, body } = composeFinding({
      extract: extractFixture,
      research: researchFixture,
      implementation: implementationFixture,
    });

    // filename should be date-prefixed and slugified
    expect(filename).toMatch(/^\d{4}-\d{2}-\d{2}-/);
    expect(filename).toMatch(/\.md$/);

    // All template sections must be present
    expect(body).toContain("## TL;DR");
    expect(body).toContain("## What the post showed");
    expect(body).toContain("## What it actually is");
    expect(body).toContain("## Links");
    expect(body).toContain("## Kickstarter guide");
    expect(body).toMatch(/## Fit for /);
    expect(body).toContain("## Implementation Idea");
    expect(body).toContain("## Follow-ups");

    // Section order: Implementation Idea must come after Fit for …
    const fitIdx = body.search(/## Fit for /);
    const implIdx = body.indexOf("## Implementation Idea");
    const followIdx = body.indexOf("## Follow-ups");
    expect(implIdx).toBeGreaterThan(fitIdx);
    expect(followIdx).toBeGreaterThan(implIdx);

    // Content must come from fixtures
    expect(body).toContain("Zod 4 is a TypeScript-first schema validation library");
    expect(body).toContain("Cross-Tax");
    expect(body).toContain("32,000"); // stars formatted

    // Source metadata
    expect(body).toContain("@colinhacks");
    expect(body).toContain("youtube");
  });

  it("filename slug is derived from the title", async () => {
    const { composeFinding } = await import("../src/compose.js");
    const { filename } = composeFinding({
      extract: extractFixture,
      research: researchFixture,
      implementation: implementationFixture,
    });
    // Title: "Introducing Zod 4: TypeScript-first schema validation"
    // should produce something like 2026-04-28-introducing-zod-4-typescript-first-schema-validation.md
    expect(filename.toLowerCase()).toContain("zod");
  });
});
