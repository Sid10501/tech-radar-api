import fs from 'node:fs/promises';
import path from 'node:path';
import { defaultMemoryDir, readBoundedMemoryFile } from './tools/ai_memory.js';

export interface PriorIdentity {
  finding_id: string;
  repo: string;
  saved_at: string | null;
  title: string;
  summary: string;
}

export function githubRepo(value: string): string | null {
  if (/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/.test(value) && !value.includes('..') && !value.endsWith('/.')) return value;
  try {
    const url = new URL(value.startsWith('github.com/') ? `https://${value}` : value);
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password || url.search) return null;
    // Reject raw traversal before URL parsing can silently normalize it away.
    const rawPath = value.replace(/^(?:https:\/\/)?github\.com/i, '').split(/[?#]/, 1)[0];
    if (rawPath.split('/').some(segment => segment === '.' || segment === '..' || /%2e|%2f|%5c/i.test(segment))) return null;
    const match = url.pathname.match(/^\/([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9_.-]{1,100})(?:\/(.*))?\/?$/);
    if (!match || match[2].includes('..') || match[2] === '.') return null;
    const tail = match[3] ?? '';
    if (tail && !/^README\.md$/i.test(tail) && !/^blob\/(?:[^/]+\/)+[^/]+$/.test(tail)) return null;
    return `${match[1]}/${match[2]}`;
  } catch { return null; }
}

/** Exact repository-name/module matches only. The archive is a candidate source, never current metrics. */
export async function findPriorIdentities(query: string, memoryDir = defaultMemoryDir()): Promise<PriorIdentity[]> {
  const words: string[] = query.slice(0, 24000).toLowerCase().replace(/[_-]/g, ' ').match(/[a-z0-9]+/g) ?? [];
  const normalized = ` ${words.join(' ')} `;
  const genericNames = new Set(['skills', 'tools', 'agents', 'examples', 'server', 'client', 'website', 'memory']);
  const results: PriorIdentity[] = [];
  let bytes = 0;
  try {
    const entries = await fs.readdir(path.join(memoryDir, 'tech-radar/findings'), { withFileTypes: true });
    const files = entries.filter(e => e.isFile() && /^\d[\w-]*\.md$/.test(e.name)).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 200);
    for (const entry of files) {
      if (bytes >= 2 * 1024 * 1024) break;
      let content: string;
      try { content = await readBoundedMemoryFile(memoryDir, `tech-radar/findings/${entry.name}`, 48000); } catch { continue; }
      bytes += Buffer.byteLength(content);
      const repo = githubRepo(content.match(/^- Repo:\s*(https:\/\/github\.com\/[^\s)]+)/m)?.[1] ?? '');
      if (!repo) continue;
      const basename = repo.split('/')[1].toLowerCase().replace(/[_-]/g, ' ');
      // Short/generic identifiers require the owner as well, avoiding incidental word collisions.
      if (!normalized.includes(` ${basename} `) || ((basename.length < 6 || genericNames.has(basename)) && !normalized.includes(` ${repo.split('/')[0].toLowerCase().replace(/[_-]/g, ' ')} `))) continue;
      results.push({ finding_id: entry.name.slice(0, -3), repo, saved_at: content.match(/^\*\*Saved:\*\*\s*(\S+)/m)?.[1] ?? null,
        title: (content.match(/^\*\*Display:\*\*\s*(.+)$/m)?.[1] ?? content.match(/^# (.+)$/m)?.[1] ?? repo).slice(0, 180),
        summary: (content.match(/## TL;DR\s+([\s\S]*?)(?=\n## |$)/)?.[1] ?? '').trim().slice(0, 600) });
      if (results.length >= 5) break;
    }
  } catch { /* No local archive is a valid unresolved state. */ }
  return results;
}

import { ResearchOutputSchema, type ResearchOutput, type SourceEvidence } from './schemas/researchOutput.js';
export interface GroundingContext {
  prior: PriorIdentity[];
  sourceRepo: string | null;
  candidateRepos?: string[];
  evidence: SourceEvidence[];
  warnings?: string[];
  metrics?: { repo: string; signals: ResearchOutput['viability_signals'] };
}
/** Only collector-owned receipts and metrics survive. A source-verified claim is an exact quotation. */
export function finalizeResearch(output: ResearchOutput, context: GroundingContext): ResearchOutput {
  const repos = [...new Map(context.prior.map(item => [item.repo.toLowerCase(), item.repo])).values()];
  const selected = output.links.github ? githubRepo(output.links.github) : null;
  const archiveRepo = selected ? repos.find(candidate => candidate.toLowerCase() === selected.toLowerCase()) ?? null : null;
  const selectedCandidate = selected && context.candidateRepos?.some(candidate => candidate.toLowerCase() === selected.toLowerCase()) ? selected : null;
  const repo = context.sourceRepo ?? selectedCandidate ?? archiveRepo;
  const evidence = context.evidence;
  const claims = (output.claims ?? [{ statement: output.what.slice(0, 2000), status: 'reported' as const, evidence_ids: [] }]).map(claim => {
    const ids = claim.evidence_ids.filter(id => evidence.some(item => item.id === id));
    const verified = claim.status === 'source_verified' && !!claim.quoted_text && claim.statement === claim.quoted_text && ids.some(id => evidence.some(item => item.id === id && item.kind !== 'metadata' && item.excerpt.includes(claim.quoted_text!)));
    return { ...claim, status: verified ? 'source_verified' as const : 'reported' as const, evidence_ids: ids };
  });
  return ResearchOutputSchema.parse({ ...output,
    links: { ...output.links, github: repo ? `https://github.com/${repo}` : null },
    identity: { status: repo ? 'resolved' : 'unresolved', repo, basis: context.sourceRepo || selectedCandidate ? 'source_reported' : archiveRepo ? 'archive_reported' : 'unresolved', finding_ids: context.prior.filter(item => item.repo.toLowerCase() === repo?.toLowerCase()).map(item => item.finding_id) },
    evidence, claims, grounding_warnings: (context.warnings ?? []).slice(0, 12), kickstarter_kind: 'pseudocode',
    viability_signals: repo && context.metrics?.repo.toLowerCase() === repo.toLowerCase() ? context.metrics.signals : { github_stars: null, open_issues: null, last_pushed: null, license: null, archived: null },
  });
}
