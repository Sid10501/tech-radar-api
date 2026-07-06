import type { EnrichedLinkCandidate, EnrichedLinks, ExtractResult } from "./extract.js";
import { githubLookup, type GithubRepoInfo } from "./tools/github.js";

type TextSource = EnrichedLinkCandidate["source"];
type GithubLookup = (repo: string) => Promise<GithubRepoInfo>;

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
): Promise<EnrichedLinks> {
  const candidates = extractLinkCandidates(extract);
  const confirmed: EnrichedLinks["confirmed"] = { github: null, docs: null, npm: null };
  const warnings: string[] = [];
  let github: EnrichedLinks["github"] = null;

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
