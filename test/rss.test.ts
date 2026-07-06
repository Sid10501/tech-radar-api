import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildRssXml } from "../src/rss.js";
import type { PublicFindingSummary } from "../src/findings.js";

vi.mock("../src/runner.js", () => ({
  runPipeline: vi.fn(async () => ({ runId: "mock-run-id", findingPath: "tech-radar/findings/test.md" })),
  getRun: vi.fn(() => undefined),
  listRuns: vi.fn(() => []),
}));

vi.mock("../src/git.js", () => ({
  setupSshKey: vi.fn(() => "/tmp/mock-key"),
  AiMemoryRepo: vi.fn().mockImplementation(() => ({
    init: vi.fn(async () => {}),
    pullLatest: vi.fn(async () => {}),
  })),
}));

const { buildServer } = await import("../src/server.js");

function publicFinding(overrides: Partial<PublicFindingSummary> = {}): PublicFindingSummary {
  return {
    id: "20260615-video-by-shawnchee.md",
    filename: "20260615-video-by-shawnchee.md",
    path: "tech-radar/findings/20260615-video-by-shawnchee.md",
    title: "Ponytail agent rubric",
    saved: "2026-06-15",
    tags: ["instagram"],
    source: { platform: "instagram", label: "Shawn", url: "https://example.com/post", classification: "unknown" },
    summary: "A reusable senior-dev prompt rubric.",
    evidence: { caption: true, transcript: false, ocr: false, repo: false, docs: false },
    quality: { score: 60, level: "review", reasons: ["caption"] },
    retry: null,
    diagnostics: { extractionWarnings: [] },
    isPrivate: false,
    applied: null,
    ...overrides,
  };
}

describe("buildRssXml()", () => {
  const BASE = "https://sid.dev/radar";

  it("builds a valid RSS 2.0 channel with items linking to the radar base", () => {
    const xml = buildRssXml([publicFinding()], { siteBase: BASE });

    expect(xml).toContain(`<?xml version="1.0" encoding="UTF-8"?>`);
    expect(xml).toContain(`<rss version="2.0">`);
    expect(xml).toContain("<channel>");
    expect(xml).toMatch(/<channel>[\s\S]*<title>[^<]+<\/title>[\s\S]*<link>https:\/\/sid\.dev\/radar<\/link>[\s\S]*<description>[^<]+<\/description>/);
    expect(xml).toContain("<item>");
    expect(xml).toContain("<title>Ponytail agent rubric</title>");
    expect(xml).toContain(`<link>${BASE}/20260615-video-by-shawnchee</link>`);
    expect(xml).toContain(`<guid>${BASE}/20260615-video-by-shawnchee</guid>`);
    expect(xml).toContain("<description>A reusable senior-dev prompt rubric.</description>");
    expect(xml).toMatch(/<pubDate>[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} 2026 00:00:00 GMT<\/pubDate>/);
    expect(xml).toContain("</channel>");
    expect(xml).toContain("</rss>");
  });

  it("escapes XML-sensitive characters in text fields", () => {
    const xml = buildRssXml(
      [
        publicFinding({
          title: `Tips & tricks <fast> "quoted" 'single'`,
          summary: `Ship <em>fast</em> & safe`,
        }),
      ],
      { siteBase: `${BASE}?a=1&b=2` },
    );

    expect(xml).toContain("<title>Tips &amp; tricks &lt;fast&gt; &quot;quoted&quot; &apos;single&apos;</title>");
    expect(xml).toContain("<description>Ship &lt;em&gt;fast&lt;/em&gt; &amp; safe</description>");
    expect(xml).toContain("a=1&amp;b=2");
    expect(xml).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;)/);
  });

  it("keeps at most the 20 newest items in feed order", () => {
    const findings = Array.from({ length: 25 }, (_, index) =>
      publicFinding({
        id: `finding-${index}.md`,
        filename: `finding-${index}.md`,
        title: `Finding ${index}`,
        saved: `2026-06-${String(25 - index).padStart(2, "0")}`,
      }),
    );

    const xml = buildRssXml(findings, { siteBase: BASE });

    expect(xml.match(/<item>/g)).toHaveLength(20);
    expect(xml).toContain("<title>Finding 0</title>");
    expect(xml).toContain("<title>Finding 19</title>");
    expect(xml).not.toContain("<title>Finding 20</title>");
    expect(xml.indexOf("<title>Finding 0</title>")).toBeLessThan(xml.indexOf("<title>Finding 19</title>"));
  });

  it("omits pubDate when a finding has no saved date", () => {
    const xml = buildRssXml([publicFinding({ saved: null })], { siteBase: BASE });

    expect(xml).toContain("<item>");
    expect(xml).not.toContain("<pubDate>");
  });
});

describe("GET /api/public/findings/rss", () => {
  const app = buildServer();

  beforeAll(() => app.ready());
  afterAll(() => app.close());

  it("serves the feed as application/rss+xml without auth", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "server-rss-"));
    const findingsDir = path.join(dir, "tech-radar", "findings");
    fs.mkdirSync(findingsDir, { recursive: true });
    fs.writeFileSync(
      path.join(findingsDir, "sample.md"),
      ["# RSS Sample", "", "**Saved:** 20260615", "", "## TL;DR", "", "Feed item summary."].join("\n"),
    );
    process.env["AI_MEMORY_LOCAL_DIR"] = dir;
    process.env["PUBLIC_SITE_RADAR_BASE"] = "https://sid.dev/radar/";

    const res = await app.inject({ method: "GET", url: "/api/public/findings/rss" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/rss+xml; charset=utf-8");
    expect(res.body).toContain(`<rss version="2.0">`);
    expect(res.body).toContain("<title>RSS Sample</title>");
    expect(res.body).toContain("<link>https://sid.dev/radar/sample</link>");
    delete process.env["PUBLIC_SITE_RADAR_BASE"];
  });

  it("falls back to the dashboard origin when PUBLIC_SITE_RADAR_BASE is unset", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "server-rss-fallback-"));
    const findingsDir = path.join(dir, "tech-radar", "findings");
    fs.mkdirSync(findingsDir, { recursive: true });
    fs.writeFileSync(path.join(findingsDir, "sample.md"), "# Fallback Sample\n\n## TL;DR\n\nFeed item.");
    process.env["AI_MEMORY_LOCAL_DIR"] = dir;
    delete process.env["PUBLIC_SITE_RADAR_BASE"];

    const res = await app.inject({ method: "GET", url: "/api/public/findings/rss", headers: { host: "radar.example.com" } });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("<link>http://radar.example.com/sample</link>");
  });

  it("returns 200 with an empty channel when there are no findings", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "server-rss-empty-"));
    fs.mkdirSync(path.join(dir, "tech-radar", "findings"), { recursive: true });
    process.env["AI_MEMORY_LOCAL_DIR"] = dir;

    const res = await app.inject({ method: "GET", url: "/api/public/findings/rss" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/rss+xml; charset=utf-8");
    expect(res.body).toContain("<channel>");
    expect(res.body).not.toContain("<item>");
  });
});
