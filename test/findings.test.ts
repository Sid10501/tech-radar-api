import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getFindingDetail, getPublicFindingDetail, listFindings, listPublicFindings, parseFindingMarkdown, toPublicFinding } from "../src/findings.js";

const SAMPLE_FINDING = `# Ponytail agent rubric

**Source:** instagram · [Shawn](https://www.instagram.com/reel/DZmyMFoqCRm/)
**Saved:** 20260615
**Tags:** instagram, computerscience, skill, tech

## TL;DR

Ponytail is useful as operating-system guidance, not a replacement for Superpowers.

## What the post showed

> Caption: this skill mimics that one senior dev with glasses and ponytail

Key claims from transcript:
It helps save tokens and make better architecture decisions.

On-screen text / OCR:
Token usage down
smallest useful diff

## What it actually is

- What: A reusable senior-dev prompt/rubric.
- Who built it / maintained by: Shawn
- Status: unknown
- Why it matters: It improves signal-to-noise in AI code review.
- GitHub stars: 120 · License: MIT · Archived: no

## Links

- Repo: https://github.com/example/ponytail

## Kickstarter guide

Read the repo and copy the prompt into your agent instructions.

## Fit for Sid

- Target project: ai-memory
- Verdict: \`#try-soon\`

## Implementation Idea

Add this to Sid's shared rubric.
`;

describe("parseFindingMarkdown()", () => {
  it("extracts dashboard metadata, evidence flags, and quality from a finding", () => {
    const finding = parseFindingMarkdown("20260615-video-by-shawnchee.md", SAMPLE_FINDING);

    expect(finding.id).toBe("20260615-video-by-shawnchee.md");
    expect(finding.title).toBe("Ponytail agent rubric");
    expect(finding.source.platform).toBe("instagram");
    expect(finding.source.url).toBe("https://www.instagram.com/reel/DZmyMFoqCRm/");
    expect(finding.saved).toBe("2026-06-15");
    expect(finding.tags).toEqual(["instagram", "computerscience", "skill", "tech"]);
    expect(finding.targetProject).toBe("ai-memory");
    expect(finding.verdict).toBe("#try-soon");
    expect(finding.evidence.caption).toBe(true);
    expect(finding.evidence.transcript).toBe(true);
    expect(finding.evidence.ocr).toBe(true);
    expect(finding.evidence.repo).toBe(true);
    expect(finding.quality.score).toBeGreaterThanOrEqual(80);
    expect(finding.quality.level).toBe("strong");
    expect(finding.recommendedAction).toBe("Create task");
  });

  it("scores caption plus confirmed repo and docs as review quality", () => {
    const finding = parseFindingMarkdown(
      "20260706-palmier.md",
      SAMPLE_FINDING
        .replace("Ponytail agent rubric", "Palmier Pro")
        .replace("Key claims from transcript:\nIt helps save tokens and make better architecture decisions.\n\n", "")
        .replace("On-screen text / OCR:\nToken usage down\nsmallest useful diff\n\n", "")
        .replace("- Repo: https://github.com/example/ponytail", [
          "- Repo: https://github.com/palmier-io/palmier-pro",
          "- Docs: https://github.com/palmier-io/palmier-pro#readme",
        ].join("\n"))
        .replace("- Target project: ai-memory", "- Target project: none")
        .replace("- Verdict: `#try-soon`", "- Verdict: `#watch`"),
    );

    expect(finding.evidence).toMatchObject({
      caption: true,
      transcript: false,
      ocr: false,
      repo: true,
      docs: true,
    });
    expect(finding.quality.score).toBeGreaterThanOrEqual(60);
    expect(finding.quality.level).toBe("review");
  });

  it("keeps public and Sid-specific detail sections for the private dashboard", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "private-finding-sections-"));
    const findingsDir = path.join(dir, "tech-radar", "findings");
    fs.mkdirSync(findingsDir, { recursive: true });
    fs.writeFileSync(
      path.join(findingsDir, "20260615-video-by-shawnchee.md"),
      SAMPLE_FINDING + "\n## Follow-ups\n\n- Re-run extraction if the source changes.\n",
    );

    const detail = getFindingDetail("20260615-video-by-shawnchee.md", dir);

    expect(detail?.sections.research).toContain("reusable senior-dev prompt");
    expect(detail?.sections.links).toContain("https://github.com/example/ponytail");
    expect(detail?.sections.kickstarter).toContain("copy the prompt");
    expect(detail?.sections.fit).toContain("Target project");
    expect(detail?.sections.implementation).toContain("shared rubric");
    expect(detail?.sections.followups).toContain("Re-run extraction");
  });

  it("keeps multi-paragraph extraction sections instead of stopping at the first line", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "multiline-finding-sections-"));
    const findingsDir = path.join(dir, "tech-radar", "findings");
    fs.mkdirSync(findingsDir, { recursive: true });
    fs.writeFileSync(path.join(findingsDir, "20260615-video-by-shawnchee.md"), SAMPLE_FINDING);

    const detail = getFindingDetail("20260615-video-by-shawnchee.md", dir);

    expect(detail?.sections.shown).toContain("Key claims from transcript:");
    expect(detail?.sections.shown).toContain("Token usage down");
    expect(detail?.sections.shown).not.toContain("## What it actually is");
  });

  it("keeps implementation content that starts with a nested markdown heading", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "implementation-heading-section-"));
    const findingsDir = path.join(dir, "tech-radar", "findings");
    fs.mkdirSync(findingsDir, { recursive: true });
    fs.writeFileSync(
      path.join(findingsDir, "20260615-video-by-shawnchee.md"),
      SAMPLE_FINDING.replace(
        "Add this to Sid's shared rubric.",
        "## Senior Review Skill\n\nAdd this to Sid's shared rubric.",
      ) + "\n## Follow-ups\n\n- Re-run extraction if the source changes.\n",
    );

    const detail = getFindingDetail("20260615-video-by-shawnchee.md", dir);

    expect(detail?.sections.implementation).toContain("## Senior Review Skill");
    expect(detail?.sections.implementation).toContain("shared rubric");
    expect(detail?.sections.implementation).not.toContain("## Follow-ups");
  });

  it("exposes retry history without leaking it into follow-ups", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "retry-history-section-"));
    const findingsDir = path.join(dir, "tech-radar", "findings");
    fs.mkdirSync(findingsDir, { recursive: true });
    fs.writeFileSync(
      path.join(findingsDir, "20260615-video-by-shawnchee.md"),
      SAMPLE_FINDING + [
        "",
        "## Follow-ups",
        "",
        "- Verify the source repo.",
        "",
        "## Retry history",
        "",
        "- Updated: 2026-07-06",
        "- Previous filename: `20260615-video-by-shawnchee.md`",
        "- Generated filename: `20260706-new-title.md`",
        "",
      ].join("\n"),
    );

    const detail = getFindingDetail("20260615-video-by-shawnchee.md", dir);

    expect(detail?.finding.retry).toEqual({
      updated: "2026-07-06",
      previousFilename: "20260615-video-by-shawnchee.md",
      generatedFilename: "20260706-new-title.md",
    });
    expect(detail?.sections.followups).toContain("Verify the source repo");
    expect(detail?.sections.followups).not.toContain("Retry history");
    expect(detail?.sections.retryHistory).toContain("Generated filename");
  });

  it("exposes extraction warnings from what-the-post-showed details", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "extraction-warnings-section-"));
    const findingsDir = path.join(dir, "tech-radar", "findings");
    fs.mkdirSync(findingsDir, { recursive: true });
    fs.writeFileSync(
      path.join(findingsDir, "20260615-video-by-shawnchee.md"),
      SAMPLE_FINDING.replace(
        "On-screen text / OCR:\nToken usage down\nsmallest useful diff",
        [
          "On-screen text / OCR:",
          "not captured",
          "",
          "Extraction warnings:",
          "- Vision OCR skipped: OPENAI_API_KEY is not configured",
          "- Only carousel metadata was available",
        ].join("\n"),
      ),
    );

    const detail = getFindingDetail("20260615-video-by-shawnchee.md", dir);

    expect(detail?.finding.diagnostics.extractionWarnings).toEqual([
      "Vision OCR skipped: OPENAI_API_KEY is not configured",
      "Only carousel metadata was available",
    ]);
    expect(detail?.sections.extractionWarnings).toContain("Vision OCR skipped");
  });

  it("keeps workflow audit as its own finding detail section", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-audit-section-"));
    const findingsDir = path.join(dir, "tech-radar", "findings");
    fs.mkdirSync(findingsDir, { recursive: true });
    fs.writeFileSync(
      path.join(findingsDir, "20260705-kun-workflow.md"),
      SAMPLE_FINDING.replace(
        "## What it actually is",
        "## Workflow Audit\n\nWorkflow type: agentic engineering workflow\n\nRecommended intake:\n- Promote stable rules to memory, reusable instructions to skills.\n\n## What it actually is",
      ),
    );

    const detail = getFindingDetail("20260705-kun-workflow.md", dir);

    expect(detail?.sections.workflow).toContain("agentic engineering workflow");
    expect(detail?.sections.workflow).toContain("Promote stable rules");
    expect(detail?.sections.research).toContain("reusable senior-dev prompt");
  });

  it("does not count placeholder extraction markers as captured evidence", () => {
    const finding = parseFindingMarkdown(
      "20260615-video-by-shawnchee.md",
      SAMPLE_FINDING
        .replace("It helps save tokens and make better architecture decisions.", "- (no transcript available)")
        .replace("Token usage down\nsmallest useful diff", "not captured"),
    );

    expect(finding.evidence.caption).toBe(true);
    expect(finding.evidence.transcript).toBe(false);
    expect(finding.evidence.ocr).toBe(false);
  });

  it("does not fold learning evidence blocks into OCR evidence", () => {
    const finding = parseFindingMarkdown(
      "20260615-video-by-shawnchee.md",
      SAMPLE_FINDING.replace(
        "On-screen text / OCR:\nToken usage down\nsmallest useful diff",
        [
          "On-screen text / OCR:",
          "not captured",
          "",
          "Learning chapters:",
          "- 00:00 Setup",
          "",
          "Extraction path:",
          "- youtube-transcript-api",
          "",
          "Linked artifacts:",
          "- validation_gate · pre-push validation gate: https://github.com/kunchenguid/no-mistakes",
        ].join("\n"),
      ),
    );

    expect(finding.evidence.transcript).toBe(true);
    expect(finding.evidence.ocr).toBe(false);
  });

  it("treats skip verdicts as skip actions even when quality is weak", () => {
    const finding = parseFindingMarkdown(
      "20260615-video-by-shawnchee.md",
      SAMPLE_FINDING
        .replace("- Target project: ai-memory", "- Target project: none")
        .replace("- Verdict: `#try-soon`", "- Verdict: `#skip`")
        .replace("- GitHub stars: 120", "- GitHub stars: 0")
        .replace("- Repo: https://github.com/example/ponytail", "- (no links found)"),
    );

    expect(finding.verdict).toBe("#skip");
    expect(finding.quality.level).toBe("weak");
    expect(finding.recommendedAction).toBe("Skip");
  });

  it("filters entity-like junk tags from social metadata", () => {
    const finding = parseFindingMarkdown(
      "20260615-video-by-shawnchee.md",
      SAMPLE_FINDING.replace("**Tags:** instagram, computerscience, skill, tech", "**Tags:** instagram, x201c, x1f449, 064, coding"),
    );

    expect(finding.tags).toEqual(["instagram", "coding"]);
  });

  it("treats direct GitHub findings as source-backed without requiring video evidence", () => {
    const finding = parseFindingMarkdown(
      "20260705-github-agent.md",
      [
        "# GitHub Agent",
        "",
        "**Source:** github · [Repo](https://github.com/example/github-agent)",
        "**Saved:** 20260705",
        "**Tags:** github, agent",
        "",
        "## TL;DR",
        "",
        "A direct repository for an agent workflow helper.",
        "",
        "## What it actually is",
        "",
        "- What: A source-backed GitHub project.",
        "- GitHub stars: 450 · License: MIT · Archived: no",
        "",
        "## Links",
        "",
        "- Repo: https://github.com/example/github-agent",
        "- Docs: https://github.com/example/github-agent#readme",
        "",
        "## Fit for Sid",
        "",
        "- Target project: ai-memory",
        "- Verdict: `#try-soon`",
      ].join("\n"),
    );

    expect(finding.source.classification).toBe("public_artifact");
    expect(finding.evidence.repo).toBe(true);
    expect(finding.quality.level).toBe("strong");
    expect(finding.recommendedAction).toBe("Create task");
    expect(toPublicFinding(finding).quality.level).not.toBe("weak");
  });

  it("treats direct GitHub Gist findings as source-backed public artifacts", () => {
    const finding = parseFindingMarkdown(
      "20260519-system-prompt-for-coding-agents.md",
      [
        "# System prompt for coding agents",
        "",
        "**Source:** github · [Gist](https://gist.github.com/acidgreenservers/001185d63e5cd65f9fbe6f7a1c70a200)",
        "**Saved:** 20260519",
        "**Tags:** github, agents",
        "",
        "## TL;DR",
        "",
        "A public Gist containing a coding-agent prompt.",
        "",
        "## What it actually is",
        "",
        "- What: A source-backed prompt artifact.",
        "- GitHub stars: unknown · License: unknown · Archived: no",
        "",
        "## Links",
        "",
        "- (no links found)",
        "",
        "## Fit for Sid",
        "",
        "- Target project: ai-memory",
        "- Verdict: `#try-soon`",
      ].join("\n"),
    );

    expect(finding.source.classification).toBe("public_artifact");
    expect(finding.quality.level).toBe("review");
    expect(finding.quality.reasons).toContain("source-backed");
    expect(finding.recommendedAction).toBe("Review");
  });

  it("does not count GitHub search pages as repository evidence", () => {
    const finding = parseFindingMarkdown(
      "20260705-search-placeholder.md",
      SAMPLE_FINDING.replace("- Repo: https://github.com/example/ponytail", "- Repo: https://github.com/search?q=ponytail+agent"),
    );

    expect(finding.evidence.repo).toBe(false);
    expect(finding.source.classification).toBe("unknown");
  });

  it("classifies DM-gated posts with no public artifact as weak skip candidates", () => {
    const finding = parseFindingMarkdown(
      "20260705-dm-gated.md",
      SAMPLE_FINDING
        .replace("Ponytail is useful as operating-system guidance, not a replacement for Superpowers.", "The post asks viewers to comment AGENT and says the repo will be sent by DM.")
        .replace("this skill mimics that one senior dev with glasses and ponytail", "comment AGENT and I will DM you the repo")
        .replace("- Repo: https://github.com/example/ponytail", "- (no links found)")
        .replace("- Target project: ai-memory", "- Target project: none")
        .replace("- Verdict: `#try-soon`", "- Verdict: `#skip`"),
    );

    expect(finding.source.classification).toBe("dm_gated");
    expect(finding.quality.level).toBe("weak");
    expect(finding.quality.reasons).toContain("dm gated");
    expect(finding.recommendedAction).toBe("Skip");
  });

  it("classifies comment keyword posts that promise to send the resource as DM-gated", () => {
    const finding = parseFindingMarkdown(
      "20260504-comment-scrape.md",
      SAMPLE_FINDING
        .replace("Ponytail is useful as operating-system guidance, not a replacement for Superpowers.", "The post asks viewers to comment scrape and says I’ll send it over.")
        .replace("this skill mimics that one senior dev with glasses and ponytail", "comment scrape and I’ll send it over")
        .replace("- Repo: https://github.com/example/ponytail", "- (no links found)")
        .replace("- Target project: ai-memory", "- Target project: none")
        .replace("- Verdict: `#try-soon`", "- Verdict: `#skip`"),
    );

    expect(finding.source.classification).toBe("dm_gated");
    expect(finding.recommendedAction).toBe("Skip");
  });

  it("adds actionable weak-quality reasons for repo-backed posts that still need extraction review", () => {
    const finding = parseFindingMarkdown(
      "20260706-repo-backed-weak.md",
      [
        "# Repo-backed weak workflow",
        "",
        "**Source:** instagram · [Creator](https://www.instagram.com/reel/weak/)",
        "**Saved:** 20260706",
        "**Tags:** instagram, workflow",
        "",
        "## TL;DR",
        "",
        "A repository was found, but the source post has little usable extraction context.",
        "",
        "## What the post showed",
        "",
        "> Caption: (none)",
        "",
        "Key claims from transcript:",
        "(no transcript available)",
        "",
        "## What it actually is",
        "",
        "- What: A thin source mention with a repository.",
        "- GitHub stars: 0 · License: unknown · Archived: no",
        "",
        "## Links",
        "",
        "- Repo: https://github.com/example/repo-backed-weak",
        "",
        "## Fit for Sid",
        "",
        "- Target project: ai-memory",
        "- Verdict: `#watch`",
      ].join("\n"),
    );

    expect(finding.quality.level).toBe("weak");
    expect(finding.quality.reasons).toContain("repo found, source weak");
    expect(finding.quality.reasons).toContain("needs transcript");
    expect(finding.recommendedAction).toBe("Retry");
  });

  it("explains why caption-plus-repo findings are still weak", () => {
    const finding = parseFindingMarkdown(
      "20260706-christian-quant-finance.md",
      SAMPLE_FINDING
        .replace("Ponytail agent rubric", "Christian quant finance repos")
        .replace("Key claims from transcript:\nIt helps save tokens and make better architecture decisions.\n\n", "")
        .replace("On-screen text / OCR:\nToken usage down\nsmallest useful diff\n\n", "")
        .replace("- Target project: ai-memory", "- Target project: none")
        .replace("- Verdict: `#try-soon`", "- Verdict: `#watch`"),
    );

    expect(finding.evidence).toMatchObject({
      caption: true,
      transcript: false,
      ocr: false,
      repo: true,
    });
    expect(finding.quality.score).toBe(50);
    expect(finding.quality.level).toBe("weak");
    expect(finding.quality.reasons).toEqual(
      expect.arrayContaining([
        "repo found, source weak",
        "needs transcript",
        "needs OCR",
        "triage skip",
      ]),
    );
  });

  it("keeps comment-to-receive posts DM-gated even when a repo URL is present", () => {
    const finding = parseFindingMarkdown(
      "20260706-ketan-loop-engineering.md",
      SAMPLE_FINDING
        .replace("Ponytail agent rubric", "Ketan loop engineering")
        .replace("Ponytail is useful as operating-system guidance, not a replacement for Superpowers.", "The post says comment LOOP and I will DM you the repo.")
        .replace("this skill mimics that one senior dev with glasses and ponytail", "comment LOOP and I will DM you the repo")
        .replace("Key claims from transcript:\nIt helps save tokens and make better architecture decisions.\n\n", "")
        .replace("On-screen text / OCR:\nToken usage down\nsmallest useful diff\n\n", "")
        .replace("- Target project: ai-memory", "- Target project: none")
        .replace("- Verdict: `#try-soon`", "- Verdict: `#watch`"),
    );

    expect(finding.evidence.repo).toBe(true);
    expect(finding.source.classification).toBe("dm_gated");
    expect(finding.quality.level).toBe("weak");
    expect(finding.quality.reasons).toEqual(expect.arrayContaining(["dm gated", "triage skip"]));
    expect(finding.recommendedAction).toBe("Skip");
  });

  it("routes stale skip verdicts with a real public artifact back to review", () => {
    const finding = parseFindingMarkdown(
      "20260705-stale-skip.md",
      SAMPLE_FINDING
        .replace("**Source:** instagram · [Shawn](https://www.instagram.com/reel/DZmyMFoqCRm/)", "**Source:** github · [Repo](https://github.com/example/ponytail)")
        .replace("- Target project: ai-memory", "- Target project: none")
        .replace("- Verdict: `#try-soon`", "- Verdict: `#skip`"),
    );

    expect(finding.source.classification).toBe("public_artifact");
    expect(finding.recommendedAction).toBe("Review");
  });
});

describe("public finding shape", () => {
  it("removes Sid-specific project fields and sections", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "public-finding-"));
    const findingsDir = path.join(dir, "tech-radar", "findings");
    fs.mkdirSync(findingsDir, { recursive: true });
    fs.writeFileSync(path.join(findingsDir, "20260615-video-by-shawnchee.md"), SAMPLE_FINDING);

    const [finding] = listPublicFindings(dir);
    const detail = getPublicFindingDetail("20260615-video-by-shawnchee.md", dir);

    expect(finding).not.toHaveProperty("targetProject");
    expect(finding).not.toHaveProperty("recommendedAction");
    expect(finding).not.toHaveProperty("verdict");
    expect(detail?.markdown).not.toContain("## Fit for Sid");
    expect(detail?.markdown).not.toContain("## Implementation Idea");
    expect(detail?.sections.research).toContain("reusable senior-dev prompt");
    expect(detail?.sections.kickstarter).toContain("copy the prompt");
  });

  it("keeps public-safe retry and extraction diagnostics in public detail", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "public-diagnostics-"));
    const findingsDir = path.join(dir, "tech-radar", "findings");
    fs.mkdirSync(findingsDir, { recursive: true });
    fs.writeFileSync(
      path.join(findingsDir, "20260615-video-by-shawnchee.md"),
      SAMPLE_FINDING.replace(
        "On-screen text / OCR:\nToken usage down\nsmallest useful diff",
        [
          "On-screen text / OCR:",
          "not captured",
          "",
          "Extraction warnings:",
          "- Vision OCR skipped: provider key is not configured",
        ].join("\n"),
      ) + [
        "",
        "## Retry history",
        "",
        "- Updated: 2026-07-06",
        "- Previous filename: `20260615-video-by-shawnchee.md`",
        "- Generated filename: `20260706-new-title.md`",
        "",
      ].join("\n"),
    );

    const detail = getPublicFindingDetail("20260615-video-by-shawnchee.md", dir);

    expect(detail?.finding.retry?.generatedFilename).toBe("20260706-new-title.md");
    expect(detail?.finding.diagnostics.extractionWarnings).toEqual(["Vision OCR skipped: provider key is not configured"]);
    expect(detail?.sections.retryHistory).toContain("Generated filename");
    expect(detail?.sections.extractionWarnings).toContain("Vision OCR skipped");
    expect(detail?.markdown).not.toContain("## Fit for Sid");
    expect(detail?.markdown).not.toContain("## Implementation Idea");
  });

  it("removes private project references from public retry and diagnostic metadata", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "public-diagnostics-private-"));
    const findingsDir = path.join(dir, "tech-radar", "findings");
    fs.mkdirSync(findingsDir, { recursive: true });
    fs.writeFileSync(
      path.join(findingsDir, "20260615-video-by-shawnchee.md"),
      SAMPLE_FINDING.replace(
        "On-screen text / OCR:\nToken usage down\nsmallest useful diff",
        [
          "On-screen text / OCR:",
          "not captured",
          "",
          "Extraction warnings:",
          "- Cross-Tax local screenshot path was unavailable",
          "- Public-safe warning remains",
        ].join("\n"),
      ) + [
        "",
        "## Retry history",
        "",
        "- Updated: 2026-07-06",
        "- Previous filename: `20260706-cross-tax-private.md`",
        "- Generated filename: `20260706-public-tool.md`",
        "",
      ].join("\n"),
    );

    const detail = getPublicFindingDetail("20260615-video-by-shawnchee.md", dir);

    expect(detail?.finding.retry?.previousFilename).toBe(null);
    expect(detail?.finding.retry?.generatedFilename).toBe("20260706-public-tool.md");
    expect(detail?.finding.diagnostics.extractionWarnings).toEqual(["Public-safe warning remains"]);
    expect(JSON.stringify(detail)).not.toContain("Cross-Tax");
    expect(JSON.stringify(detail)).not.toContain("cross-tax");
  });

  it("removes embedded private decision blocks from public detail text", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "public-embedded-private-"));
    const findingsDir = path.join(dir, "tech-radar", "findings");
    fs.mkdirSync(findingsDir, { recursive: true });
    const markdown = SAMPLE_FINDING
      .replace(
        "Read the repo and copy the prompt into your agent instructions.",
        [
          "Read the repo and copy the prompt into your agent instructions.",
          "",
          "- This is directly relevant because Sid runs tech-radar-api.",
          "- Verdict: `#try-soon`",
          "",
          "## Palmier as a tech-radar-api workflow accelerator",
          "",
          "Use this in Cross-Tax and Sid's video workflow.",
        ].join("\n"),
      )
      .replace(
        "Add this to Sid's shared rubric.",
        "## Private implementation heading\n\nUse this in Cross-Tax and Sid's video workflow.",
      );
    fs.writeFileSync(path.join(findingsDir, "20260619-palmier.md"), markdown);

    const detail = getPublicFindingDetail("20260619-palmier.md", dir);

    expect(detail?.sections.kickstarter).toContain("Read the repo");
    expect(detail?.sections.kickstarter).not.toContain("Sid");
    expect(detail?.sections.kickstarter).not.toContain("Verdict");
    expect(detail?.sections.kickstarter).not.toContain("Cross-Tax");
    expect(detail?.markdown).not.toContain("Target project");
    expect(detail?.markdown).not.toContain("Verdict");
    expect(detail?.markdown).not.toContain("Sid");
    expect(detail?.markdown).not.toContain("Cross-Tax");
  });

  it("removes private-only decision keys from public detail payloads", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "public-private-keys-"));
    const findingsDir = path.join(dir, "tech-radar", "findings");
    fs.mkdirSync(findingsDir, { recursive: true });
    fs.writeFileSync(
      path.join(findingsDir, "20260615-video-by-shawnchee.md"),
      SAMPLE_FINDING + [
        "",
        "## What it actually is",
        "",
        "- recommendedAction: Create task",
        "- targetProject: ai-memory",
        "- verdict: #try-soon",
        "- followups: private queue",
      ].join("\n"),
    );

    const detail = getPublicFindingDetail("20260615-video-by-shawnchee.md", dir);
    const serialized = JSON.stringify(detail);

    expect(serialized).not.toContain("recommendedAction");
    expect(serialized).not.toContain("targetProject");
    expect(serialized).not.toContain("verdict");
    expect(serialized).not.toContain("followups");
    expect(serialized).not.toContain("implementation");
    expect(serialized).not.toContain("fit");
  });

  it("removes private verdict scoring reasons from public finding quality", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "public-skip-quality-"));
    const findingsDir = path.join(dir, "tech-radar", "findings");
    fs.mkdirSync(findingsDir, { recursive: true });
    fs.writeFileSync(
      path.join(findingsDir, "20260615-video-by-shawnchee.md"),
      SAMPLE_FINDING
        .replace("- Target project: ai-memory", "- Target project: none")
        .replace("- Verdict: `#try-soon`", "- Verdict: `#skip`"),
    );
    const privateFinding = parseFindingMarkdown(
      "20260615-video-by-shawnchee.md",
      SAMPLE_FINDING
        .replace("- Target project: ai-memory", "- Target project: none")
        .replace("- Verdict: `#try-soon`", "- Verdict: `#skip`"),
    );

    const [publicFinding] = listPublicFindings(dir);

    expect(privateFinding.quality.reasons).toContain("skip verdict");
    expect(publicFinding.quality.reasons).not.toContain("skip verdict");
    expect(publicFinding.quality.reasons).not.toContain("triage skip");
    expect(publicFinding.quality.score).toBeGreaterThan(privateFinding.quality.score);
  });

  it("removes standalone private project references from public guidance", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "public-project-reference-"));
    const findingsDir = path.join(dir, "tech-radar", "findings");
    fs.mkdirSync(findingsDir, { recursive: true });
    fs.writeFileSync(
      path.join(findingsDir, "20260615-video-by-shawnchee.md"),
      SAMPLE_FINDING.replace(
        "Read the repo and copy the prompt into your agent instructions.",
        [
          "Read the repo and copy the prompt into your agent instructions.",
          "",
          "Drop-in swap in Cross-Tax or StockBot.",
          "",
          "Use the public README example first.",
        ].join("\n"),
      ),
    );

    const detail = getPublicFindingDetail("20260615-video-by-shawnchee.md", dir);

    expect(detail?.sections.kickstarter).toContain("Read the repo");
    expect(detail?.sections.kickstarter).toContain("public README");
    expect(detail?.sections.kickstarter).not.toContain("Cross-Tax");
    expect(detail?.sections.kickstarter).not.toContain("StockBot");
    expect(detail?.markdown).not.toContain("Cross-Tax");
    expect(detail?.markdown).not.toContain("StockBot");
  });
});

describe("listFindings()", () => {
  it("reads findings from an ai-memory checkout newest first", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-findings-"));
    const findingsDir = path.join(dir, "tech-radar", "findings");
    fs.mkdirSync(findingsDir, { recursive: true });
    fs.writeFileSync(path.join(findingsDir, "20260615-video-by-shawnchee.md"), SAMPLE_FINDING);
    fs.writeFileSync(
      path.join(findingsDir, "20260501-low-confidence.md"),
      SAMPLE_FINDING.replace("**Saved:** 20260615", "**Saved:** 20260501").replace("On-screen text / OCR:", "No visual text:"),
    );

    const findings = listFindings(dir);

    expect(findings).toHaveLength(2);
    expect(findings[0].saved).toBe("2026-06-15");
    expect(findings[1].saved).toBe("2026-05-01");
  });

  it("annotates duplicate findings by normalized source URL", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "duplicate-source-findings-"));
    const findingsDir = path.join(dir, "tech-radar", "findings");
    fs.mkdirSync(findingsDir, { recursive: true });
    fs.writeFileSync(
      path.join(findingsDir, "a.md"),
      SAMPLE_FINDING.replace("https://www.instagram.com/reel/DZmyMFoqCRm/", "https://www.instagram.com/reel/dupe/?utm_source=ig"),
    );
    fs.writeFileSync(
      path.join(findingsDir, "b.md"),
      SAMPLE_FINDING
        .replace("Ponytail agent rubric", "Same source, different title")
        .replace("https://www.instagram.com/reel/DZmyMFoqCRm/", "https://www.instagram.com/reel/dupe/"),
    );

    const findings = listFindings(dir);

    expect(findings.map((finding) => finding.diagnostics.duplicateGroup?.count)).toEqual([2, 2]);
    expect(findings[0].diagnostics.duplicateGroup?.reason).toBe("same source URL");
    expect(listPublicFindings(dir)[0].diagnostics.duplicateGroup?.count).toBe(2);
  });

  it("does not collapse source URLs that differ by identity-bearing query parameters", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "identity-query-findings-"));
    const findingsDir = path.join(dir, "tech-radar", "findings");
    fs.mkdirSync(findingsDir, { recursive: true });
    fs.writeFileSync(
      path.join(findingsDir, "a.md"),
      SAMPLE_FINDING.replace("https://www.instagram.com/reel/DZmyMFoqCRm/", "https://www.youtube.com/watch?v=alpha&utm_source=x"),
    );
    fs.writeFileSync(
      path.join(findingsDir, "b.md"),
      SAMPLE_FINDING
        .replace("Ponytail agent rubric", "Different video")
        .replace("https://www.instagram.com/reel/DZmyMFoqCRm/", "https://www.youtube.com/watch?v=beta&utm_source=x"),
    );

    const findings = listFindings(dir);

    expect(findings.map((finding) => finding.diagnostics.duplicateGroup)).toEqual([undefined, undefined]);
  });

  it("annotates duplicate findings by normalized title, creator, and platform when source URL is missing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "duplicate-title-findings-"));
    const findingsDir = path.join(dir, "tech-radar", "findings");
    fs.mkdirSync(findingsDir, { recursive: true });
    fs.writeFileSync(
      path.join(findingsDir, "a.md"),
      SAMPLE_FINDING.replace("**Source:** instagram · [Shawn](https://www.instagram.com/reel/DZmyMFoqCRm/)", "**Source:** instagram · Shawn"),
    );
    fs.writeFileSync(
      path.join(findingsDir, "b.md"),
      SAMPLE_FINDING.replace("**Source:** instagram · [Shawn](https://www.instagram.com/reel/DZmyMFoqCRm/)", "**Source:** instagram · Shawn"),
    );

    const findings = listFindings(dir);

    expect(findings[0].diagnostics.duplicateGroup).toMatchObject({
      count: 2,
      reason: "same title and creator",
    });
    expect(findings[0].diagnostics.duplicateGroup?.id).toBe(findings[1].diagnostics.duplicateGroup?.id);
  });
});
