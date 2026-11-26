import type { PublicFindingSummary } from "./findings.js";

export interface RssOptions {
  siteBase: string;
  dashboardLinks?: boolean;
}

const MAX_RSS_ITEMS = 20;

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function rfc822Date(saved: string): string | null {
  const date = new Date(`${saved}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toUTCString();
}

function rssItem(finding: PublicFindingSummary, siteBase: string, dashboardLinks: boolean): string {
  const guid = `${siteBase}/${finding.filename.replace(/\.md$/, "")}`;
  const link = dashboardLinks ? `${siteBase}/?finding=${encodeURIComponent(finding.filename)}` : guid;
  const coverage = finding.captureCoverage;
  const description = coverage
    ? [finding.displaySummary, coverage.listed === null ? "Slide coverage unknown." : `OCR returned text for ${coverage.withText} of ${coverage.listed} listed media items.`].join(" ")
    : finding.displaySummary;
  const pubDate = finding.saved ? rfc822Date(finding.saved) : null;
  return [
    "    <item>",
    `      <title>${xmlEscape(finding.displayTitle)}</title>`,
    `      <link>${xmlEscape(link)}</link>`,
    `      <guid${dashboardLinks ? ' isPermaLink="false"' : ""}>${xmlEscape(guid)}</guid>`,
    `      <description>${xmlEscape(description)}</description>`,
    ...(pubDate ? [`      <pubDate>${pubDate}</pubDate>`] : []),
    "    </item>",
  ].join("\n");
}

export function buildRssXml(findings: PublicFindingSummary[], opts: RssOptions): string {
  const siteBase = opts.siteBase.replace(/\/+$/, "");
  const items = findings
    .filter((finding) => finding.publicStatus.publishable)
    .slice(0, MAX_RSS_ITEMS)
    .map((finding) => rssItem(finding, siteBase, opts.dashboardLinks === true));
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<rss version="2.0">`,
    "  <channel>",
    "    <title>Tech Radar — Public Findings</title>",
    `    <link>${xmlEscape(siteBase)}</link>`,
    "    <description>Public research findings from the tech radar pipeline.</description>",
    ...items,
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
}
