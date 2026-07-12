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

    // Enriched learning evidence
    expect(body).toContain("Extraction path:");
    expect(body).toContain("- yt-dlp:metadata");
    expect(body).toContain("- yt-dlp:subtitles");
    expect(body).toContain("Learning chapters:");
    expect(body).toContain("- 00:00 Why Zod 4 matters");
    expect(body).toContain("- 00:24 Migration notes");
    expect(body).toContain("Source links found:");
    expect(body).toContain("- https://github.com/colinhacks/zod");
    expect(body).toContain("Linked artifacts:");
    expect(body).toContain("- github_repo · linked GitHub repository: https://github.com/colinhacks/zod");
    expect(body).toContain("- docs · documentation site: https://zod.dev/");
    expect(body).not.toContain("## Workflow Audit");
    expect(body).toContain("Top comments:");
    expect(body).toContain("@viewer");
    expect(body).toContain("migration notes");
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

  it("preserves extraction warnings in the source-evidence section", async () => {
    const { composeFinding } = await import("../src/compose.js");
    const { body } = composeFinding({
      extract: {
        ...extractFixture,
        visual_text: null,
        extraction_warnings: [
          "Vision OCR skipped: OPENAI_API_KEY is not configured",
          "Only carousel metadata was available",
        ],
      },
      research: researchFixture,
      implementation: implementationFixture,
    });

    expect(body).toContain("Extraction warnings:");
    expect(body).toContain("- Vision OCR skipped: OPENAI_API_KEY is not configured");
    expect(body).toContain("- Only carousel metadata was available");
  });

  it("adds a workflow audit section for agent workflow artifacts", async () => {
    const { composeFinding } = await import("../src/compose.js");

    const { body } = composeFinding({
      extract: {
        ...extractFixture,
        linked_artifacts: [
          {
            url: "https://github.com/kunchenguid/no-mistakes",
            type: "validation_gate",
            role: "pre-push validation gate",
          },
          {
            url: "https://github.com/kunchenguid/lavish-axi",
            type: "interactive_planning",
            role: "interactive planning artifact",
          },
        ],
      },
      research: researchFixture,
      implementation: implementationFixture,
    });

    expect(body).toContain("## Workflow Audit");
    expect(body).toContain("Workflow type: agentic engineering workflow");
    expect(body).toContain("Validation gates:");
    expect(body).toContain("Planning artifacts:");
  });
});

describe("composeFinding() display header", () => {
  it("writes a Display header when research provides display fields", async () => {
    const { composeFinding } = await import("../src/compose.js");
    const { body } = composeFinding({
      extract: extractFixture,
      research: {
        ...researchFixture,
        display_name: "Zod 4 — schema validation",
        display_summary: "TypeScript-first validation library with faster parsing than Zod 3.",
      },
      implementation: implementationFixture,
    });
    expect(body).toContain(
      "**Display:** Zod 4 — schema validation — TypeScript-first validation library with faster parsing than Zod 3.",
    );
  });

  it("omits the Display header when research display fields are absent", async () => {
    const { composeFinding } = await import("../src/compose.js");
    const { body } = composeFinding({
      extract: extractFixture,
      research: researchFixture,
      implementation: implementationFixture,
    });
    expect(body).not.toContain("**Display:**");
  });
});
