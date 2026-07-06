import type { EnrichedLinkCandidate, EnrichedLinks, ExtractResult } from "./extract.js";
import {
  githubLookup,
  githubSearchRepositories,
  type GithubRepoInfo,
  type GithubRepoSearchResult,
} from "./tools/github.js";

type TextSource = EnrichedLinkCandidate["source"];
type GithubLookup = (repo: string) => Promise<GithubRepoInfo>;
type GithubSearch = (query: string, limit: number) => Promise<GithubRepoSearchResult[]>;

const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;
const GITHUB_RE = /(?:https?:\/\/)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/gi;
const NPM_PACKAGE_RE = /(?:npm\s+(?:install|i)\s+|pnpm\s+add\s+|yarn\s+add\s+)(@[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+|[A-Za-z0-9_.-]+)/gi;

interface CuratedProject {
  aliases: RegExp[];
  evidence: RegExp[];
  github: string;
  docs?: string;
}

const CURATED_PROJECTS: CuratedProject[] = [
  {
    aliases: [/\bagent\s*-?\s*reach\b/i],
    evidence: [
      /\b(twitter|x)\b[\s\S]{0,120}\breddit\b[\s\S]{0,120}\byoutube\b[\s\S]{0,120}\bgithub\b/i,
      /\byoutube\b[\s\S]{0,120}\bgithub\b[\s\S]{0,120}\b(no setup|just works|real[-\s]?time)\b/i,
      /\b(20,?000|50,?000)\s+stars?\b/i,
    ],
    github: "https://github.com/Panniantong/Agent-Reach",
    docs: "https://github.com/Panniantong/Agent-Reach/blob/main/docs/README_en.md",
  },
  {
    aliases: [/\bpalmier(?:\s+pro)?\b/i],
    evidence: [
      /\bopen[-\s]?source\b[\s\S]{0,80}\bvideo editor\b/i,
      /\bclaude\b[\s\S]{0,120}\b(edit|manage)\b[\s\S]{0,80}\b(video|timeline)/i,
      /\bvideo timelines?\b[\s\S]{0,80}\bAI\b/i,
    ],
    github: "https://github.com/palmier-io/palmier-pro",
    docs: "https://github.com/palmier-io/palmier-pro#readme",
  },
  {
    aliases: [/\bloop\s+engineering\b/i],
    evidence: [
      /\bpractice library\b[\s\S]{0,100}\bAI code agents?\b/i,
      /\bautomated looping system\b/i,
      /\bloop(?:ing)?\b[\s\S]{0,80}\bAI code agents?\b/i,
    ],
    github: "https://github.com/cobusgreyling/loop-engineering",
    docs: "https://cobusgreyling.github.io/loop-engineering/",
  },
  {
    aliases: [/\bponytail\b/i],
    evidence: [
      /\bsenior dev\b[\s\S]{0,120}\bponytail\b/i,
      /\bhe says nothing\b[\s\S]{0,100}\bhe writes one line\b/i,
      /\b80\s*-\s*94%\s+less code\b[\s\S]{0,80}\b3\s*-\s*6x faster\b/i,
      /\b13 agents?\b[\s\S]{0,80}\b(less code|faster|cheaper)\b/i,
      /\bsave tokens?\b[\s\S]{0,120}\barchitecture decisions?\b/i,
    ],
    github: "https://github.com/DietrichGebert/ponytail",
    docs: "https://github.com/DietrichGebert/ponytail#readme",
  },
  {
    aliases: [
      /\bkronos\b/i,
      /\bK-line\s+Tokenization\b/i,
      /\breads?\s+candlestick charts?\b/i,
    ],
    evidence: [
      /\b12\s+billion records\b[\s\S]{0,80}\b45 exchanges\b/i,
      /\bK-line\s+Tokenization\b[\s\S]{0,160}\bAutoregressive Pre-training\b/i,
      /\bcoarse-grained subtoken\b[\s\S]{0,120}\bfine-grained subtoken\b/i,
      /\bdecoder-only foundation models?\b[\s\S]{0,120}\bK-line sequences?\b/i,
    ],
    github: "https://github.com/shiyu-coder/Kronos",
    docs: "https://github.com/shiyu-coder/Kronos#readme",
  },
  {
    aliases: [
      /\b(?:mcp|gen\s*ai)\s+toolbox\s+for\s+databases\b/i,
      /\bgoogle\b[\s\S]{0,120}\b(?:mcp|gen\s*ai)\s+toolbox\b/i,
      /\bgoogle\b[\s\S]{0,120}\btoolbox\s+for\s+databases\b/i,
    ],
    evidence: [
      /\b(cloud\s+sql|bigquery|alloydb|spanner|enterprise databases?)\b/i,
    ],
    github: "https://github.com/googleapis/mcp-toolbox",
    docs: "https://github.com/googleapis/mcp-toolbox#readme",
  },
];

export function extractLinkCandidates(extract: ExtractResult): EnrichedLinkCandidate[] {
  const candidates: EnrichedLinkCandidate[] = [];
  for (const [source, value] of sourceTexts(extract)) {
    collectUrlCandidates(value, source, candidates);
    collectGithubTextCandidates(value, source, candidates);
    collectNpmInstallCandidates(value, source, candidates);
  }
  collectCuratedProjectCandidates(extract, candidates);
  return dedupeCandidates(candidates);
}

export async function enrichLinksFromExtract(
  extract: ExtractResult,
  lookup: GithubLookup = githubLookup,
  search: GithubSearch = githubSearchRepositories,
): Promise<EnrichedLinks> {
  const candidates = extractLinkCandidates(extract);
  const confirmed: EnrichedLinks["confirmed"] = { github: null, docs: null, npm: null };
  const warnings: string[] = [];
  let github: EnrichedLinks["github"] = null;

  if (!candidates.some((candidate) => candidate.kind === "github")) {
    try {
      candidates.push(...await githubSearchCandidates(extract, search));
    } catch (err) {
      warnings.push(`GitHub search failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  for (const candidate of candidates) {
    if (candidate.kind === "docs" && !confirmed.docs && isCandidateConfirmed(candidate, confirmed)) {
      confirmed.docs = candidate.url;
    }
    if (candidate.kind === "npm" && !confirmed.npm) confirmed.npm = candidate.url;
    if (candidate.kind !== "github" || confirmed.github) continue;

    try {
      const repo = githubRepoFromUrl(candidate.url);
      github = await lookup(repo);
      candidate.confidence = "confirmed";
      confirmed.github = candidate.url;
      confirmValidatedCompanionLinks(candidates, confirmed);
    } catch (err) {
      candidate.confidence = "candidate";
      warnings.push(`GitHub candidate rejected: ${candidate.url} (${err instanceof Error ? err.message : String(err)})`);
    }
  }

  return { confirmed, candidates, warnings, github };
}

function sourceTexts(extract: ExtractResult): Array<[TextSource, string]> {
  const values: Array<[TextSource, string | null | undefined]> = [
    ["title", extract.title],
    ["caption", extract.caption],
    ["transcript", extract.transcript],
    ["visual_text", extract.visual_text],
    ["source_url", extract.url],
  ];
  return values.flatMap(([source, value]) => value?.trim() ? [[source, value]] : []);
}

function collectUrlCandidates(value: string, source: TextSource, candidates: EnrichedLinkCandidate[]): void {
  for (const match of value.matchAll(URL_RE)) {
    const url = cleanUrl(match[0]);
    const kind = linkKind(url);
    if (!kind) continue;
    candidates.push({
      kind,
      url: kind === "github" ? normalizeGithubUrl(url) : normalizeNpmUrl(url),
      source,
      confidence: kind === "github" ? "confirmed" : "candidate",
    });
  }
}

function collectGithubTextCandidates(value: string, source: TextSource, candidates: EnrichedLinkCandidate[]): void {
  for (const match of value.matchAll(GITHUB_RE)) {
    candidates.push({
      kind: "github",
      url: `https://github.com/${match[1]}/${match[2]}`,
      source,
      confidence: "confirmed",
    });
  }
}

function collectNpmInstallCandidates(value: string, source: TextSource, candidates: EnrichedLinkCandidate[]): void {
  for (const match of value.matchAll(NPM_PACKAGE_RE)) {
    candidates.push({
      kind: "npm",
      url: `https://www.npmjs.com/package/${match[1]}`,
      source,
      confidence: "candidate",
    });
  }
}

function collectCuratedProjectCandidates(extract: ExtractResult, candidates: EnrichedLinkCandidate[]): void {
  if (candidates.some((candidate) => candidate.kind === "github")) return;
  const texts = sourceTexts(extract);
  const combined = texts.map(([, value]) => value).join("\n");
  if (!combined.trim()) return;

  for (const project of CURATED_PROJECTS) {
    const aliasSource = texts.find(([, value]) => project.aliases.some((alias) => alias.test(value)))?.[0];
    if (!aliasSource) continue;
    if (!project.evidence.some((evidence) => evidence.test(combined))) continue;

    candidates.push({
      kind: "github",
      url: project.github,
      source: aliasSource,
      confidence: "candidate",
    });
    if (project.docs) {
      candidates.push({
        kind: "docs",
        url: project.docs,
        source: aliasSource,
        confidence: "candidate",
        requires_github: project.github,
      });
    }
  }
}

async function githubSearchCandidates(
  extract: ExtractResult,
  search: GithubSearch,
): Promise<EnrichedLinkCandidate[]> {
  const searchSpec = githubSearchSpec(extract);
  if (!searchSpec) return [];
  const results = await search(searchSpec.query, 3);
  const best = results.find((result) => isHighConfidenceSearchHit(result, searchSpec.name));
  if (!best) return [];
  return [{
    kind: "github",
    url: normalizeGithubUrl(best.htmlUrl),
    source: searchSpec.source,
    confidence: "candidate",
    discovered_by: "github_search",
    search_query: searchSpec.query,
  }];
}

function githubSearchSpec(extract: ExtractResult): { name: string; query: string; source: TextSource } | null {
  const texts = sourceTexts(extract);
  const combined = texts.map(([, value]) => value).join("\n");
  if (!/\b(github|open[-\s]?source|repo|repository)\b/i.test(combined)) return null;
  const named = findNamedTool(texts);
  if (!named) return null;
  const context: string[] = [];
  if (/\bAI agents?\b/i.test(combined)) context.push("AI agents");
  if (/\bClaude Code\b/i.test(combined)) context.push("Claude Code");
  if (/\bvideo editor\b/i.test(combined)) context.push("video editor");
  context.push("GitHub");
  return {
    name: named.name,
    source: named.source,
    query: [named.name, ...context].join(" "),
  };
}

function findNamedTool(texts: Array<[TextSource, string]>): { name: string; source: TextSource } | null {
  const patterns = [
    /\btool called\s+([A-Z][A-Za-z0-9_.-]{1,40})\b/,
    /\bcalled\s+([A-Z][A-Za-z0-9_.-]{1,40})\b/,
    /\bopen[-\s]?sourced?\s+([A-Z][A-Za-z0-9_.-]{1,40})\b/,
  ];
  for (const [source, value] of texts) {
    for (const pattern of patterns) {
      const match = pattern.exec(value);
      if (match?.[1] && isSearchableToolName(match[1])) return { name: match[1], source };
    }
  }
  return null;
}

function isHighConfidenceSearchHit(result: GithubRepoSearchResult, name: string): boolean {
  if (result.archived) return false;
  const normalizedName = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const repoName = result.fullName.split("/").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") ?? "";
  if (repoName === normalizedName) return true;
  if (normalizedName.length >= 5 && repoName.includes(normalizedName)) return true;
  const description = result.description?.toLowerCase() ?? "";
  return result.stars >= 50 && normalizedName.length >= 5 && description.includes(name.toLowerCase());
}

function isSearchableToolName(name: string): boolean {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (normalized.length < 3) return false;
  return !new Set([
    "ai",
    "app",
    "bot",
    "code",
    "github",
    "open",
    "repo",
    "tool",
    "video",
  ]).has(normalized);
}

function confirmValidatedCompanionLinks(
  candidates: EnrichedLinkCandidate[],
  confirmed: EnrichedLinks["confirmed"],
): void {
  if (!confirmed.github) return;
  for (const candidate of candidates) {
    if (candidate.kind !== "docs" || confirmed.docs) continue;
    if (candidate.requires_github === confirmed.github) confirmed.docs = candidate.url;
  }
}

function isCandidateConfirmed(
  candidate: EnrichedLinkCandidate,
  confirmed: EnrichedLinks["confirmed"],
): boolean {
  if (!candidate.requires_github) return true;
  return confirmed.github === candidate.requires_github;
}

function linkKind(url: string): EnrichedLinkCandidate["kind"] | null {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (host === "github.com" || host.endsWith(".github.com")) return "github";
  if (host === "npmjs.com" || host === "www.npmjs.com") return "npm";
  if (host.includes("docs") || /\/docs(?:\/|$)/i.test(url) || host.endsWith(".dev") || host.endsWith(".app")) return "docs";
  return null;
}

function cleanUrl(url: string): string {
  return url.replace(/[),.;]+$/g, "");
}

function normalizeGithubUrl(url: string): string {
  const repo = githubRepoFromUrl(url);
  return `https://github.com/${repo}`;
}

function normalizeNpmUrl(url: string): string {
  return url.replace(/\/$/, "");
}

function githubRepoFromUrl(url: string): string {
  const parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
  const [owner, repo] = parsed.pathname.split("/").filter(Boolean);
  if (!owner || !repo) throw new Error(`invalid GitHub repo URL: ${url}`);
  return `${owner}/${repo.replace(/\.git$/, "")}`;
}

function dedupeCandidates(candidates: EnrichedLinkCandidate[]): EnrichedLinkCandidate[] {
  const seen = new Set<string>();
  const deduped: EnrichedLinkCandidate[] = [];
  for (const candidate of candidates) {
    const key = `${candidate.kind}:${candidate.url.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(candidate);
  }
  return deduped;
}
