import { describe, expect, it, vi } from "vitest";
import type { ExtractResult } from "../src/extract.js";
import { enrichLinksFromExtract, extractLinkCandidates } from "../src/linkEnrichment.js";

const baseExtract: ExtractResult = {
  url: "https://www.instagram.com/p/example/",
  platform: "instagram",
  status: "ok",
  error: null,
  title: "Palmier demo",
  creator: "uncover.ai",
  caption: "A new open-source video editor called Palmier has been released.",
  hashtags: ["ai"],
  duration_sec: null,
  transcript: null,
  transcript_source: null,
  visual_text: null,
  visual_text_source: null,
  upload_date: "20260619",
  raw_metadata_keys: [],
};

describe("link enrichment", () => {
  it("extracts GitHub, docs, and npm links from OCR/caption evidence", () => {
    const candidates = extractLinkCandidates({
      ...baseExtract,
      visual_text: [
        "Repo: https://github.com/marcosricopeng/palmier",
        "Docs: https://palmier.app/docs",
        "npm install @palmier/mcp",
      ].join("\n"),
    });

    expect(candidates).toEqual([
      { kind: "github", url: "https://github.com/marcosricopeng/palmier", source: "visual_text", confidence: "confirmed" },
      { kind: "docs", url: "https://palmier.app/docs", source: "visual_text", confidence: "candidate" },
      { kind: "npm", url: "https://www.npmjs.com/package/@palmier/mcp", source: "visual_text", confidence: "candidate" },
    ]);
  });

  it("deduplicates candidates and validates GitHub repos with lookup metadata", async () => {
    const githubLookup = vi.fn(async () => ({
      stars: 42,
      lastPushed: "2026-06-20T00:00:00Z",
      openIssues: 2,
      language: "Swift",
      license: "MIT",
      archived: false,
    }));

    const enriched = await enrichLinksFromExtract(
      {
        ...baseExtract,
        caption: "Repo https://github.com/marcosricopeng/palmier",
        visual_text: "github.com/marcosricopeng/palmier",
      },
      githubLookup,
    );

    expect(githubLookup).toHaveBeenCalledWith("marcosricopeng/palmier");
    expect(enriched.confirmed.github).toBe("https://github.com/marcosricopeng/palmier");
    expect(enriched.github?.stars).toBe(42);
    expect(enriched.candidates).toHaveLength(1);
  });

  it("keeps invalid GitHub URLs as unconfirmed candidates with warnings", async () => {
    const githubLookup = vi.fn(async () => {
      throw new Error("GitHub API returned 404");
    });

    const enriched = await enrichLinksFromExtract(
      {
        ...baseExtract,
        visual_text: "Repo: https://github.com/not-real/nope",
      },
      githubLookup,
    );

    expect(enriched.confirmed.github).toBeNull();
    expect(enriched.candidates[0]).toMatchObject({
      kind: "github",
      url: "https://github.com/not-real/nope",
      confidence: "candidate",
    });
    expect(enriched.warnings[0]).toContain("GitHub API returned 404");
  });
});
