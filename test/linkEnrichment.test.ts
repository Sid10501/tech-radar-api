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
  it("treats resolved source links as deterministic enrichment evidence", () => {
    const candidates = extractLinkCandidates({
      ...baseExtract,
      caption: "Project link: https://t.co/abc123",
      source_links: ["https://github.com/acme/tool"],
    });

    expect(candidates).toContainEqual({
      kind: "github",
      url: "https://github.com/acme/tool",
      source: "source_url",
      confidence: "confirmed",
    });
  });

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

  it("resolves curated Ponytail and Kronos aliases from OCR/transcript evidence", async () => {
    const githubLookup = vi.fn(async (repo: string) => ({
      stars: repo === "DietrichGebert/ponytail" ? 75_000 : 23_000,
      lastPushed: "2026-07-06T00:00:00Z",
      openIssues: 10,
      language: repo === "DietrichGebert/ponytail" ? "JavaScript" : "Python",
      license: "MIT",
      archived: false,
    }));

    const ponytail = await enrichLinksFromExtract(
      {
        ...baseExtract,
        title: "Video by shawnchee_",
        caption: "this skill mimics that one senior dev with glasses and ponytail, helps you save tokens and make better architecture decisions",
        visual_text:
          "Ponytail. He says nothing. He writes one line. It works. v4.4.0 release works with 13 agents. 80-94% less code - 3-6x faster - 47-77% cheaper.",
      },
      githubLookup,
    );
    const kronos = await enrichLinksFromExtract(
      {
        ...baseExtract,
        title: "Video by cooper.simson",
        caption:
          "Someone built a free AI model that reads candlestick charts the way GPT reads English. Trained on 12 billion records from 45 exchanges.",
        visual_text:
          "K-line Tokenization. Autoregressive Pre-training. Tokenizer Encoder. Coarse-grained Subtoken and Fine-grained Subtoken for stock prediction.",
      },
      githubLookup,
    );

    expect(githubLookup).toHaveBeenCalledWith("DietrichGebert/ponytail");
    expect(githubLookup).toHaveBeenCalledWith("shiyu-coder/Kronos");
    expect(ponytail.confirmed).toMatchObject({
      github: "https://github.com/DietrichGebert/ponytail",
      docs: "https://github.com/DietrichGebert/ponytail#readme",
    });
    expect(kronos.confirmed).toMatchObject({
      github: "https://github.com/shiyu-coder/Kronos",
      docs: "https://github.com/shiyu-coder/Kronos#readme",
    });
  });

  it("resolves Kronos from practical automated trading setup language", async () => {
    const githubLookup = vi.fn(async () => ({
      stars: 23_000,
      lastPushed: "2026-07-06T00:00:00Z",
      openIssues: 10,
      language: "Python",
      license: "MIT",
      archived: false,
    }));

    const enriched = await enrichLinksFromExtract(
      {
        ...baseExtract,
        title: "Kronos AI Automated Trading System",
        caption:
          "This video shows how anyone can build an automated AI system with Kronos integration for quant trading with zero experience.",
        transcript:
          "I read the research for a Chinese AI model that can make money while you sleep, and now everyone is asking how to use it.",
        visual_text: "YOU can BUILD a SYSTEM for AUTOMATED TRADING With ZERO EXPERIENCE",
      },
      githubLookup,
    );

    expect(githubLookup).toHaveBeenCalledWith("shiyu-coder/Kronos");
    expect(enriched.confirmed).toMatchObject({
      github: "https://github.com/shiyu-coder/Kronos",
      docs: "https://github.com/shiyu-coder/Kronos#readme",
    });
  });

  it("resolves Google's MCP Toolbox for Databases despite older Gen AI Toolbox naming", async () => {
    const githubLookup = vi.fn(async () => ({
      stars: 15_900,
      lastPushed: "2026-07-06T00:00:00Z",
      openIssues: 125,
      language: "Go",
      license: "Apache-2.0",
      archived: false,
    }));

    const enriched = await enrichLinksFromExtract(
      {
        ...baseExtract,
        title: "Google just open-sourced a MCP toolbox for databases",
        caption:
          "Google Just Open-Sourced a Gen AI Toolbox for Databases. It gives AI agents safe access to Cloud SQL, BigQuery and other enterprise databases.",
      },
      githubLookup,
    );

    expect(githubLookup).toHaveBeenCalledWith("googleapis/mcp-toolbox");
    expect(enriched.confirmed).toMatchObject({
      github: "https://github.com/googleapis/mcp-toolbox",
      docs: "https://github.com/googleapis/mcp-toolbox#readme",
    });
  });

  it("does not resolve generic non-Google MCP toolbox database posts to Google's repo", async () => {
    const githubLookup = vi.fn(async () => ({
      stars: 15_900,
      lastPushed: "2026-07-06T00:00:00Z",
      openIssues: 125,
      language: "Go",
      license: "Apache-2.0",
      archived: false,
    }));

    const enriched = await enrichLinksFromExtract(
      {
        ...baseExtract,
        title: "A new MCP toolbox for Postgres",
        caption: "This MCP toolbox connects agents to BigQuery-style analytics and Cloud SQL-compatible databases, but it is maintained by a small independent team.",
      },
      githubLookup,
    );

    expect(githubLookup).not.toHaveBeenCalledWith("googleapis/mcp-toolbox");
    expect(enriched.confirmed.github).toBeNull();
  });

  it("uses conservative GitHub search when a named tool has no explicit URL or curated resolver", async () => {
    const githubLookup = vi.fn(async () => ({
      stars: 2_400,
      lastPushed: "2026-07-05T00:00:00Z",
      openIssues: 7,
      language: "TypeScript",
      license: "MIT",
      archived: false,
    }));
    const githubSearch = vi.fn(async () => [
      {
        fullName: "example/rufflo",
        htmlUrl: "https://github.com/example/rufflo",
        description: "Runs 60+ AI agents simultaneously inside Claude Code.",
        stars: 2_400,
        archived: false,
      },
    ]);

    const enriched = await enrichLinksFromExtract(
      {
        ...baseExtract,
        title: "Someone open-sourced 147 pre-built AI agents",
        caption:
          "A tool called Rufflo just hit number one on GitHub and it runs 60+ AI agents simultaneously inside Claude Code.",
      },
      githubLookup,
      githubSearch,
    );

    expect(githubSearch).toHaveBeenCalledWith("Rufflo AI agents Claude Code GitHub", 3);
    expect(githubLookup).toHaveBeenCalledWith("example/rufflo");
    expect(enriched.confirmed.github).toBe("https://github.com/example/rufflo");
    expect(enriched.candidates[0]).toMatchObject({
      kind: "github",
      url: "https://github.com/example/rufflo",
      source: "caption",
      confidence: "confirmed",
      discovered_by: "github_search",
      search_query: "Rufflo AI agents Claude Code GitHub",
    });
  });

  it("does not use GitHub search when explicit GitHub evidence exists", async () => {
    const githubLookup = vi.fn(async () => ({
      stars: 42,
      lastPushed: "2026-06-20T00:00:00Z",
      openIssues: 2,
      language: "Swift",
      license: "MIT",
      archived: false,
    }));
    const githubSearch = vi.fn(async () => []);

    await enrichLinksFromExtract(
      {
        ...baseExtract,
        caption: "Repo https://github.com/marcosricopeng/palmier",
      },
      githubLookup,
      githubSearch,
    );

    expect(githubSearch).not.toHaveBeenCalled();
  });

  it("does not search GitHub for generic capitalized words after called", async () => {
    const githubLookup = vi.fn();
    const githubSearch = vi.fn(async () => [{
      fullName: "example/open-runtime",
      htmlUrl: "https://github.com/example/open-runtime",
      description: "Unrelated open source runtime",
      stars: 1000,
      archived: false,
    }]);

    const enriched = await enrichLinksFromExtract(
      {
        ...baseExtract,
        caption: "A thing called Open is trending on GitHub for developers.",
      },
      githubLookup,
      githubSearch,
    );

    expect(githubSearch).not.toHaveBeenCalled();
    expect(githubLookup).not.toHaveBeenCalled();
    expect(enriched.confirmed.github).toBeNull();
  });

  it("rejects GitHub search hits where a short name is only a partial repo-name match", async () => {
    const githubLookup = vi.fn();
    const githubSearch = vi.fn(async () => [{
      fullName: "example/aider-tools",
      htmlUrl: "https://github.com/example/aider-tools",
      description: "Tools for unrelated workflows",
      stars: 1000,
      archived: false,
    }]);

    const enriched = await enrichLinksFromExtract(
      {
        ...baseExtract,
        caption: "A tool called Aid just landed on GitHub for AI agents.",
      },
      githubLookup,
      githubSearch,
    );

    expect(githubSearch).toHaveBeenCalledWith("Aid AI agents GitHub", 3);
    expect(githubLookup).not.toHaveBeenCalled();
    expect(enriched.confirmed.github).toBeNull();
  });
});
