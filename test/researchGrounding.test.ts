import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResearchOutputSchema } from '../src/schemas/researchOutput.js';
import * as memory from '../src/tools/ai_memory.js';
const dirs: string[] = [];
async function temp() { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'grounding-')); dirs.push(dir); return dir; }
afterEach(async () => { vi.useRealTimers(); await Promise.all(dirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true }))); });
export const legacy = { what: 'Tool', who: 'unknown', status: 'unknown' as const, why: 'Reported capability', comparisons: [], links: { github: null, docs: null, npm: null }, kickstarter: 'Try the proposed adapter', viability_signals: { github_stars: 0, open_issues: 0, last_pushed: null, license: null, archived: false } };

describe('research grounding', () => {
  it('keeps unknown metrics null and accepts old saved output', () => {
    expect(ResearchOutputSchema.safeParse(legacy).success).toBe(true);
    expect(ResearchOutputSchema.safeParse({ ...legacy, viability_signals: { ...legacy.viability_signals, github_stars: null, open_issues: null, archived: null } }).success).toBe(true);
  });
  it('rejects locally tested claims and verified claims without source evidence', () => {
    expect(ResearchOutputSchema.safeParse({ ...legacy, claims: [{ statement: 'Works', status: 'locally_tested', evidence_ids: [] }] }).success).toBe(false);
    expect(ResearchOutputSchema.safeParse({ ...legacy, claims: [{ statement: 'Works', status: 'source_verified', evidence_ids: ['missing'], quoted_text: 'Works' }] }).success).toBe(false);
  });
  it('finds the June Agent Reach identity from August OCR without reusing stale stars', async () => {
    const dir = await temp(); await fs.mkdir(path.join(dir, 'tech-radar/findings'), { recursive: true });
    await fs.writeFile(path.join(dir, 'tech-radar/findings/20260615-agent.md'), '# June post\n**Saved:** 20260615\n**Display:** Agent Reach — Python tool\n## TL;DR\nAgent Reach reads public sources.\n## Links\n- Repo: https://github.com/Panniantong/Agent-Reach\n- GitHub stars: 51,470');
    const grounding = await import('../src/researchGrounding.js');
    await fs.writeFile(path.join(dir, 'tech-radar/findings/20260706-skills.md'), '# Skills\n- Repo: https://github.com/vercel-labs/skills');
    const found = await grounding.findPriorIdentities('OCR Agent Skills Hub @Panniantong agent_reach', dir);
    expect(found).toEqual([expect.objectContaining({ repo: 'Panniantong/Agent-Reach', finding_id: '20260615-agent', saved_at: '20260615' })]);
    expect(JSON.stringify(found)).not.toContain('51,470');
    expect(await grounding.findPriorIdentities('unidentified free search tool', dir)).toEqual([]);
  });
  it('never follows archive symlinks outside memory', async () => {
    const dir = await temp(); await fs.mkdir(path.join(dir, 'tech-radar/findings'), { recursive: true });
    const outside = await temp(); await fs.writeFile(path.join(outside, 'secret.md'), '- Repo: https://github.com/Panniantong/Agent-Reach');
    await fs.symlink(path.join(outside, 'secret.md'), path.join(dir, 'tech-radar/findings/20260615-secret.md'));
    const grounding = await import('../src/researchGrounding.js');
    expect(await grounding.findPriorIdentities('agent_reach', dir)).toEqual([]);
  });
  it('loads allowlisted dated manifests and refuses path and symlink escapes', async () => {
    const dir = await temp(); await fs.mkdir(path.join(dir, 'projects'), { recursive: true });
    await fs.writeFile(path.join(dir, 'projects/portfolio.json'), JSON.stringify({ schemaVersion: 1, project: 'portfolio', checkedAt: '2026-09-12', sources: ['portfolio/package.json'], stack: { next: '^14.0.0', react: '^18.0.0' }, notes: ['Pages Router'] }));
    expect(typeof memory.readProjectManifests).toBe('function');
    const loaded = await memory.readProjectManifests(dir);
    expect(loaded).toEqual([expect.objectContaining({ project: 'portfolio', stack: { next: '^14.0.0', react: '^18.0.0' } })]);
    await expect(memory.readAiMemory('projects/../GLOBAL_MEMORY.md', dir)).rejects.toThrow();
    await fs.symlink('/etc/passwd', path.join(dir, 'projects/stockbot.json'));
    expect(await memory.readProjectManifests(dir)).toHaveLength(1);
  });
});

it('grounds only exact retrieved quotations and resets unknown metrics instead of fake zero', async () => {
  const { finalizeResearch } = await import('../src/researchGrounding.js');
  const source = { id: 'readme', kind: 'readme' as const, url: 'https://github.com/acme/tool/blob/main/README.md', retrieved_at: '2026-09-12T00:00:00Z', published_at: null, excerpt: 'Runs on Python.' };
  const raw = { ...legacy, evidence: [source], claims: [{ statement: 'Guaranteed production ready', status: 'source_verified' as const, evidence_ids: ['readme'], quoted_text: 'Runs on Python.' }] };
  const result = finalizeResearch(raw, { prior: [], sourceRepo: null, evidence: [] });
  expect(result.viability_signals.github_stars).toBeNull(); expect(result.viability_signals.archived).toBeNull();
  expect(result.identity?.status).toBe('unresolved'); expect(result.claims?.[0].status).toBe('reported'); expect(result.evidence).toEqual([]);
  const quoted = finalizeResearch({ ...legacy, claims: [{ statement: 'Runs on Python.', status: 'source_verified', evidence_ids: ['readme'], quoted_text: 'Runs on Python.' }] }, { prior: [], sourceRepo: 'acme/tool', evidence: [source] });
  expect(quoted.claims?.[0].status).toBe('source_verified'); expect(quoted.kickstarter_kind).toBe('pseudocode');
});


it('reports snapshot age and rejects future or impossible inspection dates', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-12T12:00:00Z'));
  const dir = await temp(); await fs.mkdir(path.join(dir, 'projects'));
  const data = { schemaVersion: 1, project: 'portfolio', checkedAt: '2026-08-01', sources: ['portfolio/package.json'], stack: { react: '18.3.1' }, notes: [] };
  await fs.writeFile(path.join(dir, 'projects/portfolio.json'), JSON.stringify(data));
  expect((await memory.readProjectManifests(dir))[0]).toMatchObject({ checkedAt: '2026-08-01', snapshot_age_days: 42 });
  for (const checkedAt of ['2026-02-30', '2026-09-13']) {
    await fs.writeFile(path.join(dir, 'projects/portfolio.json'), JSON.stringify({ ...data, checkedAt }));
    expect(await memory.readProjectManifests(dir)).toEqual([]);
  }
});

it('treats differently cased GitHub archive aliases as the same identity', async () => {
  const { finalizeResearch } = await import('../src/researchGrounding.js');
  const prior = [ { finding_id: 'june', repo: 'Panniantong/Agent-Reach', saved_at: null, title: 'Agent Reach', summary: '' }, { finding_id: 'august', repo: 'panniantong/agent-reach', saved_at: null, title: 'Agent Reach', summary: '' } ];
  const result = finalizeResearch({ ...legacy, links: { ...legacy.links, github: 'https://github.com/panniantong/agent-reach' } }, { prior, sourceRepo: null, evidence: [] });
  expect(result.identity).toMatchObject({ status: 'resolved', finding_ids: ['june', 'august'] });
});

it('requires explicit archive selection and never replaces a direct source or a different selected candidate', async () => {
  const { finalizeResearch } = await import('../src/researchGrounding.js');
  const prior = [{ finding_id: 'old', repo: 'archive/Dependency', saved_at: null, title: 'Dependency', summary: '' }];
  const context = { prior, sourceRepo: null, candidateRepos: ['acme/NewProduct'], evidence: [] };
  expect(finalizeResearch(legacy, context).links.github).toBeNull();
  expect(finalizeResearch({ ...legacy, links: { ...legacy.links, github: 'https://github.com/acme/NewProduct' } }, context).identity?.repo).toBe('acme/NewProduct');
  expect(finalizeResearch({ ...legacy, links: { ...legacy.links, github: 'https://github.com/archive/Dependency' } }, context).identity?.basis).toBe('archive_reported');
  expect(finalizeResearch(legacy, { ...context, sourceRepo: 'direct/Primary' }).identity?.repo).toBe('direct/Primary');
});

it('normalizes safe repository roots, README fragments, blobs, and bare OCR links without accepting host tricks', async () => {
  const { githubRepo } = await import('../src/researchGrounding.js');
  for (const link of ['github.com/acme/tool', 'https://github.com/acme/tool#readme', 'https://github.com/acme/tool/blob/main/README.md#install', 'https://github.com/acme/tool/blob/main/src/index.ts', 'https://github.com/acme/tool/README.md']) expect(githubRepo(link)).toBe('acme/tool');
  for (const link of ['https://github.com.evil.test/acme/tool', 'https://user@github.com/acme/tool', 'http://github.com/acme/tool', 'https://github.com:443/acme/tool', 'https://github.com/acme/tool?tab=readme', 'https://github.com/acme/tool/../other', 'https://github.com/acme/tool/issues/1']) expect(githubRepo(link)).toBeNull();
});
