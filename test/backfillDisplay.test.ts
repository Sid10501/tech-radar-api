import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { backfillDir, extractPromptInputs, hasDisplayHeader, insertDisplayHeader } from "../scripts/backfill-display.js";

const FINDING = `# Sebastian Hardy | AI Marketing on Instagram: &quot;The 5 Claude Code plugins&quot;

**Source:** instagram · [unknown](https://example.com)
**Saved:** 2026-07-06
**Tags:** instagram

## TL;DR

A curated set of five open-source plugins for Claude Code.
`;

describe("backfill-display", () => {
  it("detects existing Display headers", () => {
    expect(hasDisplayHeader(FINDING)).toBe(false);
    const withHeader = insertDisplayHeader(FINDING, {
      display_name: "Five Claude Code plugins",
      display_summary: "Curated open-source plugin set for Claude Code.",
    });
    expect(hasDisplayHeader(withHeader)).toBe(true);
  });

  it("inserts the header directly after the Tags line", () => {
    const next = insertDisplayHeader(FINDING, {
      display_name: "Five Claude Code plugins",
      display_summary: "Curated open-source plugin set for Claude Code.",
    });
    expect(next).toContain(
      "**Tags:** instagram\n**Display:** Five Claude Code plugins — Curated open-source plugin set for Claude Code.",
    );
  });

  it("extracts decoded title and TL;DR for the prompt", () => {
    const { title, tldr } = extractPromptInputs(FINDING);
    expect(title).toContain('"The 5 Claude Code plugins"');
    expect(tldr).toContain("five open-source plugins");
  });

  it("backfills only findings without a header, honors dry-run and limit", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "backfill-"));
    fs.writeFileSync(path.join(dir, "a-finding.md"), FINDING);
    fs.writeFileSync(
      path.join(dir, "b-finding.md"),
      insertDisplayHeader(FINDING, { display_name: "Done", display_summary: "Already has one." }),
    );
    fs.writeFileSync(path.join(dir, "_template.md"), FINDING);

    const calls: string[] = [];
    const generate = async (title: string) => {
      calls.push(title);
      return { display_name: "Generated Name", display_summary: "Generated summary sentence." };
    };

    const dry = await backfillDir(dir, generate, { dryRun: true, limit: 10 });
    expect(dry.updated).toHaveLength(1);
    expect(dry.skipped).toBe(1);
    expect(fs.readFileSync(path.join(dir, "a-finding.md"), "utf8")).not.toContain("**Display:**");

    const wet = await backfillDir(dir, generate, { dryRun: false, limit: 10 });
    expect(wet.updated).toHaveLength(1);
    expect(fs.readFileSync(path.join(dir, "a-finding.md"), "utf8")).toContain("**Display:** Generated Name");
    expect(calls.length).toBe(2);

    const capped = await backfillDir(dir, generate, { dryRun: true, limit: 0 });
    expect(capped.updated).toHaveLength(0);
  });

  it("records failures without writing", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "backfill-"));
    fs.writeFileSync(path.join(dir, "a-finding.md"), FINDING);
    const generate = async () => {
      throw new Error("api down");
    };
    const result = await backfillDir(dir, generate, { dryRun: false, limit: 10 });
    expect(result.failed).toHaveLength(1);
    expect(fs.readFileSync(path.join(dir, "a-finding.md"), "utf8")).not.toContain("**Display:**");
  });
});
