import type { PublicFindingSummary } from "./findings.js";

export interface RssOptions {
  siteBase: string;
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

function rssItem(finding: PublicFindingSummary, siteBase: string): string {
  const link = `${siteBase}/${finding.filename.replace(/\.md$/, "")}`;
  const pubDate = finding.saved ? rfc822Date(finding.saved) : null;
  return [
    "    <item>",
    `      <title>${xmlEscape(finding.title)}</title>`,
    `      <link>${xmlEscape(link)}</link>`,
    `      <guid>${xmlEscape(link)}</guid>`,
    `      <description>${xmlEscape(finding.summary)}</description>`,
    ...(pubDate ? [`      <pubDate>${pubDate}</pubDate>`] : []),
    "    </item>",
  ].join("\n");
}

export function buildRssXml(findings: PublicFindingSummary[], opts: RssOptions): string {
  const siteBase = opts.siteBase.replace(/\/+$/, "");
  const items = findings.slice(0, MAX_RSS_ITEMS).map((finding) => rssItem(finding, siteBase));
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
