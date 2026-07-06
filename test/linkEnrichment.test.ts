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

  it("resolves curated high-confidence tool aliases when social posts omit the repo link", async () => {
    const githubLookup = vi.fn(async () => ({
      stars: 51_000,
      lastPushed: "2026-07-03T00:00:00Z",
      openIssues: 30,
      language: "Python",
      license: "MIT",
      archived: false,
    }));

    const enriched = await enrichLinksFromExtract(
      {
        ...baseExtract,
        title: "Video by parasmadan.in",
        caption: "AI Agents on Twitter, Linkedin and WA. Agent reach can now work with your social accounts.",
        transcript:
          "Our AI agent can now read Twitter, Reddit, YouTube and GitHub in real time. " +
          "There is a free open source tool for this called Agent Reach, already past 20,000 stars on GitHub.",
      },
      githubLookup,
    );

    expect(githubLookup).toHaveBeenCalledWith("Panniantong/Agent-Reach");
    expect(enriched.confirmed.github).toBe("https://github.com/Panniantong/Agent-Reach");
    expect(enriched.confirmed.docs).toBe("https://github.com/Panniantong/Agent-Reach/blob/main/docs/README_en.md");
    expect(enriched.github?.license).toBe("MIT");
  });

  it("does not resolve curated aliases without corroborating evidence", async () => {
    const githubLookup = vi.fn(async () => ({
      stars: 51_000,
      lastPushed: "2026-07-03T00:00:00Z",
      openIssues: 30,
      language: "Python",
      license: "MIT",
      archived: false,
    }));

    const enriched = await enrichLinksFromExtract(
      {
        ...baseExtract,
        caption: "Agent Reach sounds interesting, but this post is only a vague mention.",
        transcript: null,
      },
      githubLookup,
    );

    expect(githubLookup).not.toHaveBeenCalled();
    expect(enriched.confirmed.github).toBeNull();
    expect(enriched.candidates).toEqual([]);
  });

  it("downgrades curated aliases when GitHub validation fails", async () => {
    const githubLookup = vi.fn(async () => {
      throw new Error("GitHub API returned 503");
    });

    const enriched = await enrichLinksFromExtract(
      {
        ...baseExtract,
        caption: "Agent reach can now work with your social accounts.",
        transcript:
          "Our AI agent can now read Twitter, Reddit, YouTube and GitHub in real time. " +
          "There is a free open source tool for this called Agent Reach, already past 20,000 stars on GitHub.",
      },
      githubLookup,
    );

    expect(enriched.confirmed.github).toBeNull();
    expect(enriched.confirmed.docs).toBeNull();
    expect(enriched.candidates).toContainEqual({
      kind: "github",
      url: "https://github.com/Panniantong/Agent-Reach",
      source: "caption",
      confidence: "candidate",
    });
    expect(enriched.warnings[0]).toContain("GitHub API returned 503");
  });

  it("resolves curated Palmier Pro and Loop Engineering aliases", async () => {
    const githubLookup = vi.fn(async (repo: string) => ({
      stars: repo === "palmier-io/palmier-pro" ? 10_000 : 5_900,
      lastPushed: "2026-07-06T00:00:00Z",
      openIssues: 12,
      language: repo === "palmier-io/palmier-pro" ? "Swift" : "JavaScript",
      license: repo === "palmier-io/palmier-pro" ? "GPL-3.0" : "MIT",
      archived: false,
    }));

    const palmier = await enrichLinksFromExtract(
      {
        ...baseExtract,
        title: "A new open-source video editor called Palmier",
        caption:
          "A new open-source video editor called Palmier has been released that lets Claude directly edit and manage video timelines using AI.",
      },
      githubLookup,
    );
    const loop = await enrichLinksFromExtract(
      {
        ...baseExtract,
        title: "[Open Source] Loop Engineering",
        caption:
          "Loop Engineering is an open-source comprehensive practice library for AI code agents, featuring an automated looping system.",
      },
      githubLookup,
    );

    expect(githubLookup).toHaveBeenCalledWith("palmier-io/palmier-pro");
    expect(githubLookup).toHaveBeenCalledWith("cobusgreyling/loop-engineering");
    expect(palmier.confirmed).toMatchObject({
      github: "https://github.com/palmier-io/palmier-pro",
      docs: "https://github.com/palmier-io/palmier-pro#readme",
    });
    expect(loop.confirmed).toMatchObject({
      github: "https://github.com/cobusgreyling/loop-engineering",
      docs: "https://cobusgreyling.github.io/loop-engineering/",
    });
  });
});
