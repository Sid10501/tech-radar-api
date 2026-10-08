import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
const response = { what: 'Agent Reach', who: 'Panniantong', status: 'unknown', why: 'Reported source access', comparisons: [], links: { github: null, docs: null, npm: null }, kickstarter: 'Install a package', viability_signals: { github_stars: 0, open_issues: 0, last_pushed: null, license: null, archived: false } };
const dirs: string[] = [];
afterEach(async () => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); await Promise.all(dirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true }))); });
async function memory() { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-grounding-')); dirs.push(dir); return dir; }
function sdk(create: ReturnType<typeof vi.fn>) { vi.doMock('@anthropic-ai/sdk', () => ({ default: class { messages = { create }; } })); }
const extract = { url: 'https://www.instagram.com/reel/example', title: 'A tool', caption: 'Search', visual_text: '@Panniantong agent_reach', platform: 'instagram', status: 'success' } as any;

it('provides bounded untrusted prior identity before the first model pass and preserves it in the result', async () => {
  const dir = await memory(); await fs.mkdir(path.join(dir, 'tech-radar/findings'), { recursive: true });
  await fs.writeFile(path.join(dir, 'tech-radar/findings/20260615-agent.md'), '# Saved note\n**Display:** Agent Reach — source adapter\n- Repo: https://github.com/Panniantong/Agent-Reach');
  const create = vi.fn(async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ ...response, links: { ...response.links, github: 'https://github.com/Panniantong/Agent-Reach' } }) }] })); sdk(create);
  const { runResearch } = await import('../../src/agents/research.js');
  const result = await runResearch(extract, { memoryDir: dir });
  expect(result.links.github).toBe('https://github.com/Panniantong/Agent-Reach');
  expect(result.identity?.basis).toBe('archive_reported'); expect(result.viability_signals.github_stars).toBeNull();
  const first = JSON.stringify(create.mock.calls[0]);
  expect(first).toContain('20260615-agent'); expect(first.toLowerCase()).toContain('untrusted');
});

it('enforces one metadata operation even when the model batches many requests', async () => {
  const dir = await memory();
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ full_name: 'acme/tool', private: false, stargazers_count: 12, open_issues_count: 2, archived: false }))); vi.stubGlobal('fetch', fetcher);
  const create = vi.fn().mockResolvedValueOnce({ stop_reason: 'tool_use', content: ['a', 'b', 'c'].map(id => ({ type: 'tool_use', id, name: 'github_lookup', input: { repo: 'acme/tool' } })) }).mockResolvedValueOnce({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(response) }] }); sdk(create);
  const { runResearch } = await import('../../src/agents/research.js');
  const result = await runResearch({ ...extract, url: 'https://github.com/acme/tool', visual_text: '' }, { memoryDir: dir });
  expect(fetcher).toHaveBeenCalledTimes(1); expect(result.viability_signals.github_stars).toBe(12);
});

it('injects current dated project manifests without depending on model tool compliance', async () => {
  const dir = await memory(); await fs.mkdir(path.join(dir, 'projects'));
  await fs.writeFile(path.join(dir, 'projects/portfolio.json'), JSON.stringify({ schemaVersion: 1, project: 'portfolio', checkedAt: '2026-09-12', sources: ['portfolio/package.json'], stack: { react: '18.3.1', '@chakra-ui/react': '2.10.6' }, notes: ['Next.js Pages Router'] }));
  const create = vi.fn(async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ fit_for_owner: 'Use current components', target_project: 'portfolio', implementation_idea_markdown: 'Proposed experiment', follow_ups: [] }) }] })); sdk(create);
  const { runImplementation } = await import('../../src/agents/implementation.js');
  await runImplementation(extract, response as any, dir);
  const first = JSON.stringify(create.mock.calls[0]);
  expect(first).toContain('18.3.1'); expect(first).toContain('2026-09-12'); expect(first).toContain('Next.js Pages Router'); expect(first.toLowerCase()).toContain('untrusted');
});

it('keeps deep review opt-in and persists failed review receipts without inventing verification', async () => {
  const dir = await memory();
  const fetcher = vi.fn(async () => new Response('unavailable', { status: 503 })); vi.stubGlobal('fetch', fetcher);
  const create = vi.fn().mockResolvedValueOnce({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'review', name: 'github_review', input: { repo: 'acme/tool' } }] }).mockResolvedValueOnce({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(response) }] }); sdk(create);
  const { runResearch } = await import('../../src/agents/research.js');
  const result = await runResearch({ ...extract, url: 'https://github.com/acme/tool' }, { memoryDir: dir, deepReview: true });
  expect(fetcher).toHaveBeenCalledTimes(3); expect(result.grounding_warnings).toHaveLength(3); expect(result.evidence).toEqual([]);
  create.mockReset().mockResolvedValueOnce({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'review', name: 'github_review', input: { repo: 'acme/tool' } }] }).mockResolvedValueOnce({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(response) }] });
  fetcher.mockClear();
  await runResearch({ ...extract, url: 'https://github.com/acme/tool' }, { memoryDir: dir, deepReview: false });
  expect(fetcher).not.toHaveBeenCalled();
});

it('uses a repository URL visible in OCR as source-reported identity', async () => {
  const dir = await memory();
  const create = vi.fn(async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ ...response, links: { github: 'https://github.com/acme/tool', docs: null, npm: null } }) }] })); sdk(create);
  const { runResearch } = await import('../../src/agents/research.js');
  const result = await runResearch({ ...extract, visual_text: 'Repo https://github.com/acme/tool' }, { memoryDir: dir });
  expect(result.identity).toMatchObject({ repo: 'acme/tool', basis: 'source_reported' });
});

it.each(['https://evilgithub.com/acme/tool', 'http://github.com/acme/tool'])('does not launder an unsafe source URL into a GitHub candidate: %s', async unsafeUrl => {
  const dir = await memory();
  const create = vi.fn(async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ ...response, links: { ...response.links, github: 'https://github.com/acme/tool' } }) }] })); sdk(create);
  const { runResearch } = await import('../../src/agents/research.js');
  const result = await runResearch({ ...extract, visual_text: `Repo ${unsafeUrl}` }, { memoryDir: dir });
  expect(result.identity).toMatchObject({ status: 'unresolved', repo: null });
  expect(result.links.github).toBeNull();
});

it('keeps a standalone bare GitHub OCR link eligible for explicit selection', async () => {
  const dir = await memory();
  const create = vi.fn(async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ ...response, links: { ...response.links, github: 'https://github.com/acme/tool' } }) }] })); sdk(create);
  const { runResearch } = await import('../../src/agents/research.js');
  const result = await runResearch({ ...extract, visual_text: 'Repo github.com/acme/tool' }, { memoryDir: dir });
  expect(result.identity).toMatchObject({ status: 'resolved', repo: 'acme/tool', basis: 'source_reported' });
});

it('keeps a GitHub Search discovery out of the source-reported allowlist even after metadata confirmation', async () => {
  const dir = await memory();
  const create = vi.fn(async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ ...response, links: { ...response.links, github: 'https://github.com/acme/tool' } }) }] })); sdk(create);
  const { runResearch } = await import('../../src/agents/research.js');
  const result = await runResearch({ ...extract, visual_text: '', enriched_links: { confirmed: { github: 'https://github.com/acme/tool', docs: null, npm: null }, candidates: [{ kind: 'github', url: 'https://github.com/acme/tool', source: 'title', confidence: 'confirmed', discovered_by: 'github_search' }], warnings: [] } }, { memoryDir: dir });
  expect(result.identity).toMatchObject({ status: 'unresolved', repo: null });
  expect(result.links.github).toBeNull();
});

it('accepts source-backed enriched GitHub links as candidates without guessing a primary', async () => {
  const dir = await memory();
  const create = vi.fn(async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ ...response, links: { ...response.links, github: 'https://github.com/acme/tool/blob/main/README.md#install' } }) }] })); sdk(create);
  const { runResearch } = await import('../../src/agents/research.js');
  const result = await runResearch({ ...extract, visual_text: '', enriched_links: { confirmed: { github: 'https://github.com/acme/tool', docs: null, npm: null }, candidates: [{ kind: 'github', url: 'https://github.com/acme/tool/blob/main/README.md', source: 'visual_text', confidence: 'confirmed', discovered_by: 'explicit' }], warnings: [] } }, { memoryDir: dir });
  expect(result.identity).toMatchObject({ repo: 'acme/tool', basis: 'source_reported' });
});

it('accepts a production-enriched source link beyond the research query window', async () => {
  const dir = await memory();
  const { enrichLinksFromExtract } = await import('../../src/linkEnrichment.js');
  const source = { ...extract, visual_text: '', caption: `${'x'.repeat(24_100)} Repo https://github.com/acme/tool/blob/main/README.md#install` };
  const enriched = await enrichLinksFromExtract(source, async () => ({ stars: 1, lastPushed: '2026-10-01', openIssues: 0, language: 'TypeScript', license: 'MIT', archived: false }), async () => []);
  expect(enriched.confirmed.github).toBe('https://github.com/acme/tool');
  expect(enriched.candidates.find(candidate => candidate.kind === 'github')?.discovered_by).toBe('explicit');
  const create = vi.fn(async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ ...response, links: { ...response.links, github: 'https://github.com/acme/tool' } }) }] })); sdk(create);
  const { runResearch } = await import('../../src/agents/research.js');
  const result = await runResearch({ ...source, enriched_links: enriched }, { memoryDir: dir });
  expect(result.identity).toMatchObject({ status: 'resolved', repo: 'acme/tool', basis: 'source_reported' });
});

it.each([
  'http://github.com/acme/tool',
  'https://user:pass@github.com/acme/tool',
  'https://github.com:443/acme/tool',
  'https://github.com/acme/tool?tab=readme',
  'https://evilgithub.com/acme/tool',
  'https://github.com/acme/tool/../other',
])('rejects an unsafe raw GitHub token throughout production enrichment: %s', async unsafeUrl => {
  const dir = await memory();
  const { enrichLinksFromExtract } = await import('../../src/linkEnrichment.js');
  const source = { ...extract, visual_text: '', caption: `${'x'.repeat(24_100)} Repo ${unsafeUrl}` };
  const lookup = vi.fn(async () => ({ stars: 1, lastPushed: '2026-10-01', openIssues: 0, language: 'TypeScript', license: 'MIT', archived: false }));
  const enriched = await enrichLinksFromExtract(source, lookup, async () => []);
  expect(enriched.candidates.filter(candidate => candidate.kind === 'github')).toEqual([]);
  expect(enriched.confirmed.github).toBeNull();
  expect(lookup).not.toHaveBeenCalled();
  const create = vi.fn(async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ ...response, links: { ...response.links, github: 'https://github.com/acme/tool' } }) }] })); sdk(create);
  const { runResearch } = await import('../../src/agents/research.js');
  const result = await runResearch({ ...source, enriched_links: enriched }, { memoryDir: dir });
  expect(result.identity).toMatchObject({ status: 'unresolved', repo: null });
});

it('accepts a production-enriched bare GitHub token beyond the research query window', async () => {
  const dir = await memory();
  const { enrichLinksFromExtract } = await import('../../src/linkEnrichment.js');
  const source = { ...extract, visual_text: '', caption: `${'x'.repeat(24_100)} Repo github.com/acme/tool` };
  const enriched = await enrichLinksFromExtract(source, async () => ({ stars: 1, lastPushed: '2026-10-01', openIssues: 0, language: 'TypeScript', license: 'MIT', archived: false }), async () => []);
  expect(enriched.confirmed.github).toBe('https://github.com/acme/tool');
  const create = vi.fn(async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ ...response, links: { ...response.links, github: 'https://github.com/acme/tool' } }) }] })); sdk(create);
  const { runResearch } = await import('../../src/agents/research.js');
  const result = await runResearch({ ...source, enriched_links: enriched }, { memoryDir: dir });
  expect(result.identity).toMatchObject({ status: 'resolved', repo: 'acme/tool', basis: 'source_reported' });
});

it('marks a curated alias separately from a link extracted from source text', async () => {
  const { extractLinkCandidates } = await import('../../src/linkEnrichment.js');
  const candidates = extractLinkCandidates({ ...extract, title: 'Agent Reach', caption: 'An AI agent reads Twitter, Reddit, YouTube and GitHub in real time with Agent Reach, past 20,000 stars.', visual_text: '' });
  expect(candidates.find(candidate => candidate.kind === 'github')).toMatchObject({ discovered_by: 'curated' });
});

it('does not promote a sole dependency URL to the primary technology identity', async () => {
  const dir = await memory();
  const create = vi.fn(async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ ...response, what: 'OpenSuperWhisper', links: { github: null, docs: null, npm: null } }) }] })); sdk(create);
  const { runResearch } = await import('../../src/agents/research.js');
  const result = await runResearch({ ...extract, title: 'OpenSuperWhisper', visual_text: '', caption: 'Built on https://github.com/ggerganov/whisper.cpp', source_links: ['https://github.com/ggerganov/whisper.cpp'] }, { memoryDir: dir });
  expect(result.links.github).toBeNull(); expect(result.identity?.status).toBe('unresolved');
});

it('persists malformed metadata as a limitation without inventing a source receipt', async () => {
  const dir = await memory();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
  const create = vi.fn().mockResolvedValueOnce({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'metadata', name: 'github_lookup', input: { repo: 'acme/tool' } }] }).mockResolvedValueOnce({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(response) }] }); sdk(create);
  const { runResearch } = await import('../../src/agents/research.js');
  const result = await runResearch({ ...extract, url: 'https://github.com/acme/tool' }, { memoryDir: dir });
  expect(result.grounding_warnings).toContain('GitHub metadata missing a matching public repository identity');
  expect(result.evidence).toEqual([]); expect(result.viability_signals.github_stars).toBeNull();
});
