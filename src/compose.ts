import { findingFilename } from "./lib/slug.js";
import type { ExtractResult } from "./extract.js";
import type { ResearchOutput } from "./agents/research.js";
import type { ImplementationOutput } from "./agents/implementation.js";

const OWNER_NAME = process.env["OWNER_NAME"] ?? "the developer";

export interface ComposedFinding {
  filename: string;
  body: string;
}

export function composeFinding(input: {
  extract: ExtractResult;
  research: ResearchOutput;
  implementation: ImplementationOutput;
}): ComposedFinding {
  const { extract, research, implementation } = input;

  const date = extract.upload_date ?? new Date().toISOString().slice(0, 10);
  const title = extract.title ?? research.what.slice(0, 60);
  const filename = findingFilename(title, date);

  const tags = [
    extract.platform,
    ...(extract.hashtags ?? []).slice(0, 3),
  ].filter(Boolean).join(", ");

  const starsFormatted = research.viability_signals.github_stars.toLocaleString("en-US");

  const links: string[] = [];
  if (research.links.github) links.push(`- Repo: ${research.links.github}`);
  if (research.links.docs) links.push(`- Docs: ${research.links.docs}`);
  if (research.links.npm) links.push(`- npm: ${research.links.npm}`);
  if (links.length === 0) links.push("- (no links found)");

  const comparisons = research.comparisons.length > 0
    ? research.comparisons.map((c) => `  - ${c}`).join("\n")
    : "  - (none identified)";

  const verdict = implementation.target_project === "none" ? "#skip" : "#try-soon";
  const visualTextBlock = extract.visual_text?.trim()
    ? `\nOn-screen text / OCR:\n${extract.visual_text.slice(0, 400)}\n`
    : "";

  const body = `# ${title}

**Source:** ${extract.platform} · [${extract.creator ?? "unknown"}](${extract.url})
**Saved:** ${date}
**Tags:** ${tags}

## TL;DR

${research.what} ${research.why}

## What the post showed

> Caption: ${extract.caption ?? "(none)"}

Key claims from transcript:
${(extract.transcript ?? "").slice(0, 400) || "- (no transcript available)"}
${visualTextBlock}

## What it actually is

- What: ${research.what}
- Who built it / maintained by: ${research.who}
- Status: ${research.status}
- Why it matters: ${research.why}
- How it compares to alternatives:
${comparisons}
- GitHub stars: ${starsFormatted} · License: ${research.viability_signals.license ?? "unknown"} · Archived: ${research.viability_signals.archived ? "yes" : "no"}

## Links

${links.join("\n")}

## Kickstarter guide

${research.kickstarter}

## Fit for ${OWNER_NAME}

- Target project: ${implementation.target_project}
- ${implementation.fit_for_owner}
- Verdict: \`${verdict}\`

## Implementation Idea

${implementation.implementation_idea_markdown.trim()}

## Follow-ups

${implementation.follow_ups.map((f) => `- [ ] ${f}`).join("\n")}
`;

  return { filename, body };
}
