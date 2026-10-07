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
  const create = vi.fn(async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(response) }] })); sdk(create);
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
