/**
 * Backfill **Display:** headers on existing findings that lack one.
 *
 * Usage:
 *   npx tsx scripts/backfill-display.ts [--dry-run] [--limit N]
 *
 * Requires ANTHROPIC_API_KEY and AI_MEMORY_LOCAL_DIR (run via `railway run`
 * to use production env vars). Writes files only — commit/push manually.
 */
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { parseDisplayHeader, decodeEntities } from "../src/displayText.js";
import { wrapAsUntrusted } from "../src/lib/untrustedContent.js";
import { parseAgentOutput } from "../src/lib/validateAgentOutput.js";

const DisplaySchema = z.object({
  display_name: z.string().min(1).max(120),
  display_summary: z.string().min(1).max(240),
});

export type DisplayFields = z.infer<typeof DisplaySchema>;

export function hasDisplayHeader(markdown: string): boolean {
  return parseDisplayHeader(markdown) !== null;
}

export function insertDisplayHeader(markdown: string, fields: DisplayFields): string {
  const line = `**Display:** ${fields.display_name.trim()} — ${fields.display_summary.trim()}`;
  const tagsMatch = markdown.match(/^\*\*Tags:\*\*.*$/m);
  if (tagsMatch && tagsMatch.index !== undefined) {
    const insertAt = tagsMatch.index + tagsMatch[0].length;
    return `${markdown.slice(0, insertAt)}\n${line}${markdown.slice(insertAt)}`;
  }
  const titleMatch = markdown.match(/^#\s.*$/m);
  if (titleMatch && titleMatch.index !== undefined) {
    const insertAt = titleMatch.index + titleMatch[0].length;
    return `${markdown.slice(0, insertAt)}\n\n${line}${markdown.slice(insertAt)}`;
  }
  return `${line}\n\n${markdown}`;
}

export function extractPromptInputs(markdown: string): { title: string; tldr: string } {
  const title = decodeEntities(markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? "");
  const start = markdown.search(/^## TL;DR\s*$/m);
  let tldr = "";
  if (start >= 0) {
    const afterHeading = markdown.indexOf("\n", start) + 1;
    const nextSection = markdown.indexOf("\n## ", afterHeading);
    tldr = decodeEntities(markdown.slice(afterHeading, nextSection >= 0 ? nextSection : undefined).trim()).slice(0, 1200);
  }
  return { title, tldr };
}

function stripJsonFence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
}

export function parseDisplayFields(text: string): DisplayFields {
  const parsed = parseAgentOutput(stripJsonFence(text), DisplaySchema, "backfill-display");
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.data;
}

type Generate = (title: string, tldr: string) => Promise<DisplayFields>;

export async function backfillDir(
  findingsDir: string,
  generate: Generate,
  opts: { dryRun: boolean; limit: number },
): Promise<{ updated: string[]; skipped: number; failed: string[] }> {
  const updated: string[] = [];
  const failed: string[] = [];
  let skipped = 0;
  const files = fs
    .readdirSync(findingsDir)
    .filter((f) => f.endsWith(".md") && !f.startsWith("_"))
    .sort();
  for (const file of files) {
    if (updated.length >= opts.limit) break;
    const fullPath = path.join(findingsDir, file);
    const markdown = fs.readFileSync(fullPath, "utf8");
    if (hasDisplayHeader(markdown)) {
      skipped++;
      continue;
    }
    const { title, tldr } = extractPromptInputs(markdown);
    if (!title) {
      skipped++;
      continue;
    }
    try {
      const fields = await generate(title, tldr);
      const next = insertDisplayHeader(markdown, fields);
      if (!opts.dryRun) fs.writeFileSync(fullPath, next);
      updated.push(`${file} -> ${fields.display_name}`);
    } catch (err) {
      failed.push(`${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { updated, skipped, failed };
}

function anthropicGenerate(client: Anthropic): Generate {
  return async (title, tldr) => {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 300,
      system:
        "You write clean display metadata for a public tech-radar blog. Output ONLY raw JSON: " +
        '{"display_name": "<clean product/topic name, <=8 words, no platform/account boilerplate, no quotes/hashtags>", ' +
        '"display_summary": "<one plain factual sentence, <=160 chars, no hype>"}',
      messages: [
        {
          role: "user",
          content: [
            wrapAsUntrusted(title, { label: "raw finding title" }),
            wrapAsUntrusted(tldr, { label: "finding TL;DR" }),
          ].join("\n\n"),
        },
      ],
    });
    const text = response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "";
    return parseDisplayFields(text);
  };
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const limitIdx = process.argv.indexOf("--limit");
  const limit = limitIdx >= 0 ? Number.parseInt(process.argv[limitIdx + 1] ?? "", 10) : Number.POSITIVE_INFINITY;
  if (!process.env["ANTHROPIC_API_KEY"]) {
    console.error("ANTHROPIC_API_KEY is not set. Run via `railway run npx tsx scripts/backfill-display.ts`.");
    process.exit(1);
  }
  const aiMemoryDir = process.env["AI_MEMORY_LOCAL_DIR"];
  if (!aiMemoryDir) {
    console.error("AI_MEMORY_LOCAL_DIR is not set.");
    process.exit(1);
  }
  const findingsDir = path.join(aiMemoryDir, "tech-radar", "findings");
  const result = await backfillDir(findingsDir, anthropicGenerate(new Anthropic()), {
    dryRun,
    limit: Number.isFinite(limit) ? limit : Number.POSITIVE_INFINITY,
  });
  for (const line of result.updated) console.log(`${dryRun ? "[dry-run] " : ""}updated: ${line}`);
  for (const line of result.failed) console.warn(`failed: ${line}`);
  console.log(`done: ${result.updated.length} updated, ${result.skipped} skipped, ${result.failed.length} failed`);
}

const isDirectRun = process.argv[1]?.endsWith("backfill-display.ts");
if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
