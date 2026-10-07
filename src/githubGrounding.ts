import { githubRepo } from './researchGrounding.js';
import { SourceEvidenceSchema, type SourceEvidence } from './schemas/researchOutput.js';

interface FetchOptions { fetcher?: typeof fetch; timeoutMs?: number }
const MAX_BYTES = 256 * 1024;

async function githubJson(repo: string, suffix: string, options: FetchOptions): Promise<unknown> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const timeoutMs = Math.max(1, Math.min(8000, options.timeoutMs ?? 8000));
  try {
    return await Promise.race([
      (async () => {
        const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'tech-radar-api/1.0' };
        // Public evidence only: never send owner credentials to source collection.
        // A private repository must remain unavailable even if the service has a token.
        const response = await (options.fetcher ?? fetch)(`https://api.github.com/repos/${repo}${suffix}`, { headers, signal: controller.signal, redirect: 'error' });
        if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
        if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('GitHub response exceeds byte budget');
        reader = response.body?.getReader();
        if (!reader) throw new Error('GitHub returned an empty body');
        const chunks: Uint8Array[] = []; let size = 0;
        while (true) {
          const chunk = await reader.read(); if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > MAX_BYTES) throw new Error('GitHub response exceeds byte budget');
          chunks.push(chunk.value);
        }
        return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
      })(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('GitHub request timed out')); }, timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    controller.abort();
    void reader?.cancel().catch(() => {});
  }
}
function obj(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function date(value: unknown): string | null { return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null; }
function count(value: unknown): number | null { return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null; }
function sourceUrl(value: unknown, repo: string): string | null {
  if (typeof value !== 'string') return null;
  try { const u = new URL(value); return u.protocol === 'https:' && u.hostname === 'github.com' && !u.port && !u.username && !u.password && u.pathname.toLowerCase().startsWith(`/${repo.toLowerCase()}/`) ? u.href : null; } catch { return null; }
}

export async function lookupGithubGrounded(repoInput: string, options: FetchOptions = {}) {
  const repo = githubRepo(repoInput); if (!repo) throw new Error('Expected GitHub owner/name');
  const data = obj(await githubJson(repo, '', options));
  if (typeof data.full_name !== 'string' || data.full_name.toLowerCase() !== repo.toLowerCase() || data.private !== false) {
    throw new Error('GitHub metadata missing a matching public repository identity');
  }
  const signals = { github_stars: count(data.stargazers_count), open_issues: count(data.open_issues_count), last_pushed: date(data.pushed_at), license: typeof obj(data.license).spdx_id === 'string' ? obj(data.license).spdx_id as string : null, archived: typeof data.archived === 'boolean' ? data.archived : null };
  const evidence: SourceEvidence = { id: 'github-metadata', kind: 'metadata', url: `https://github.com/${repo}`, retrieved_at: new Date().toISOString(), published_at: null, excerpt: JSON.stringify(signals) };
  const unavailable = Object.entries(signals).filter(([, value]) => value === null).map(([key]) => key);
  return { repo, signals, evidence, warnings: unavailable.length ? [`metadata: unavailable fields: ${unavailable.join(', ')}`] : [] };
}

/** Three fixed requests. Issue bodies remain reporter claims; retrieval never proves their outcome. */
export async function reviewGithubSources(repoInput: string, options: FetchOptions = {}): Promise<{ evidence: SourceEvidence[]; warnings: string[] }> {
  const repo = githubRepo(repoInput); if (!repo) throw new Error('Expected GitHub owner/name');
  const evidence: SourceEvidence[] = []; const warnings: string[] = [];
  const endpoints = [{ kind: 'readme' as const, suffix: '/readme' }, { kind: 'release' as const, suffix: '/releases?per_page=3' }, { kind: 'issue' as const, suffix: '/issues?state=all&sort=updated&per_page=3' }];
  for (const { kind, suffix } of endpoints) {
    try {
      const payload = await githubJson(repo, suffix, options);
      if (kind === 'readme' && (typeof obj(payload).content !== 'string' || obj(payload).encoding !== 'base64')) {
        warnings.push('readme: malformed README payload');
        continue;
      }
      if (kind !== 'readme' && !Array.isArray(payload)) {
        warnings.push(`${kind}: expected a list of source entries`);
        continue;
      }
      const rows = kind === 'readme' ? [payload] : (payload as unknown[]).slice(0, 3);
      if (!rows.length) warnings.push(`${kind}: no entries returned`);
      for (const [index, row] of rows.entries()) {
        const data = obj(row);
        if (kind === 'issue' && data.pull_request) {
          warnings.push(`issue: entry ${index + 1} is a pull request; no issue evidence captured from it`);
          continue;
        }
        const url = sourceUrl(data.html_url, repo);
        if (!url) {
          warnings.push(`${kind}: entry ${index + 1} has an invalid or off-repository source URL`);
          continue;
        }
        const excerpt = kind === 'readme' ? (data.encoding === 'base64' && typeof data.content === 'string' ? Buffer.from(data.content, 'base64').toString('utf8') : '') : [data.title ?? data.name ?? '', data.body ?? ''].filter(value => typeof value === 'string').join('\n');
        if (!excerpt.trim()) {
          warnings.push(`${kind}: entry ${index + 1} has no usable source text`);
          continue;
        }
        const item = SourceEvidenceSchema.parse({ id: `github-${kind}-${index}`, kind, url, retrieved_at: new Date().toISOString(), published_at: date(data.published_at ?? data.created_at), excerpt: excerpt.slice(0, 12000) });
        evidence.push(item);
      }
    } catch (error) { warnings.push(`${kind}: ${error instanceof Error ? error.message : 'source unavailable'}`.slice(0, 500)); }
  }
  return { evidence, warnings: warnings.slice(0, 12) };
}
