import { describe, expect, it, vi } from 'vitest';

describe('bounded GitHub grounding', () => {
  it('uses only fixed GitHub API paths and preserves evidence dates without treating issue reports as tested', async () => {
    const { reviewGithubSources } = await import('../src/githubGrounding.js');
    const requests: string[] = [];
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      requests.push(String(url)); expect(init?.redirect).toBe('error'); expect(init?.signal).toBeDefined();
      const data = String(url).endsWith('/readme') ? { content: Buffer.from('Install using the documented CLI.').toString('base64'), encoding: 'base64', html_url: 'https://github.com/acme/tool/blob/main/README.md' }
        : String(url).includes('/releases?') ? [{ html_url: 'https://github.com/acme/tool/releases/tag/v1', published_at: '2026-09-01T00:00:00Z', body: 'Fixes startup.' }]
        : [{ html_url: 'https://github.com/acme/tool/issues/12', created_at: '2026-09-02T00:00:00Z', title: 'Startup failure', body: 'Still fails on my machine.' }];
      return new Response(JSON.stringify(data));
    });
    const result = await reviewGithubSources('acme/tool', { fetcher });
    expect(requests).toEqual(['https://api.github.com/repos/acme/tool/readme', 'https://api.github.com/repos/acme/tool/releases?per_page=3', 'https://api.github.com/repos/acme/tool/issues?state=all&sort=updated&per_page=3']);
    expect(result.evidence).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'readme', excerpt: 'Install using the documented CLI.', published_at: null }), expect.objectContaining({ kind: 'issue', published_at: '2026-09-02T00:00:00.000Z' })]));
    expect(JSON.stringify(result)).not.toContain('locally_tested');
  });
  it('rejects host/path tricks before fetching and never trusts returned off-host source URLs', async () => {
    const { reviewGithubSources } = await import('../src/githubGrounding.js');
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ content: Buffer.from('claim').toString('base64'), encoding: 'base64', html_url: 'https://evil.test/a' })));
    for (const repo of ['https://evil.test/acme/tool', 'acme/tool/../../secrets', 'acme/tool?x=1', 'https://github.com@evil.test/acme/tool']) await expect(reviewGithubSources(repo, { fetcher })).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    const result = await reviewGithubSources('acme/tool', { fetcher });
    expect(result.evidence).toEqual([]);
  });
  it('bounds streaming responses and total request time and records partial failures', async () => {
    const { reviewGithubSources } = await import('../src/githubGrounding.js');
    const tooBig = await reviewGithubSources('acme/tool', { fetcher: async () => new Response('x'.repeat(300000)) });
    expect(tooBig.evidence).toEqual([]); expect(tooBig.warnings).toHaveLength(3);
    const started = Date.now();
    const hanging = await reviewGithubSources('acme/tool', { timeoutMs: 10, fetcher: async () => new Promise(() => {}) });
    expect(hanging.warnings).toHaveLength(3); expect(Date.now() - started).toBeLessThan(1000);
  });
});

it('preserves absent metadata as unknown instead of fabricated zero/false', async () => {
  const { lookupGithubGrounded } = await import('../src/githubGrounding.js');
  const result = await lookupGithubGrounded('acme/tool', { fetcher: async () => new Response(JSON.stringify({ full_name: 'acme/tool', private: false })) });
  expect(result.warnings).toContain('metadata: unavailable fields: github_stars, open_issues, last_pushed, license, archived');
  expect(result.signals).toEqual({ github_stars: null, open_issues: null, last_pushed: null, license: null, archived: null });
});

it('rejects the dot repository segment before URL normalization can change the endpoint', async () => {
  const { lookupGithubGrounded } = await import('../src/githubGrounding.js');
  const fetcher = vi.fn(async () => new Response('{}'));
  await expect(lookupGithubGrounded('acme/.', { fetcher })).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});

it('does not attach owner credentials when collecting public source excerpts', async () => {
  const { lookupGithubGrounded, reviewGithubSources } = await import('../src/githubGrounding.js');
  vi.stubEnv('GITHUB_TOKEN', 'test-owner-token');
  try {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).has('authorization')).toBe(false);
      return new Response(JSON.stringify({ full_name: 'acme/tool', private: false }));
    });
    await lookupGithubGrounded('acme/tool', { fetcher });
    await reviewGithubSources('acme/tool', { fetcher });
    expect(fetcher).toHaveBeenCalledTimes(4);
  } finally { vi.unstubAllEnvs(); }
});

it('records malformed successful responses instead of silently treating them as reviewed', async () => {
  const { reviewGithubSources } = await import('../src/githubGrounding.js');
  const result = await reviewGithubSources('acme/tool', { fetcher: async () => new Response('{}') });
  expect(result.evidence).toEqual([]);
  expect(result.warnings).toEqual(['readme: malformed README payload', 'release: expected a list of source entries', 'issue: expected a list of source entries']);
});

it('records rejected source URLs and empty README text as missing coverage', async () => {
  const { reviewGithubSources } = await import('../src/githubGrounding.js');
  for (const [html_url, content, expected] of [
    ['https://evil.test/readme', 'Y2xhaW0=', 'readme: entry 1 has an invalid or off-repository source URL'],
    ['https://github.com/acme/tool/blob/main/README.md', '', 'readme: entry 1 has no usable source text'],
  ]) {
    const result = await reviewGithubSources('acme/tool', { fetcher: async url => new Response(JSON.stringify(String(url).endsWith('/readme') ? { html_url, content, encoding: 'base64' } : [])) });
    expect(result.evidence).toEqual([]); expect(result.warnings).toContain(expected);
    expect(result.warnings).toContain('release: no entries returned'); expect(result.warnings).toContain('issue: no entries returned');
  }
});

it('rejects malformed, mismatched, or private metadata before creating a receipt', async () => {
  const { lookupGithubGrounded } = await import('../src/githubGrounding.js');
  for (const data of [{}, { full_name: 'other/tool', private: false }, { full_name: 'acme/tool', private: true }, { full_name: 'acme/tool' }]) {
    await expect(lookupGithubGrounded('acme/tool', { fetcher: async () => new Response(JSON.stringify(data)) })).rejects.toThrow('matching public repository identity');
  }
});

it('warns when a GitHub source excerpt is partial', async () => {
  const { reviewGithubSources } = await import('../src/githubGrounding.js');
  const result = await reviewGithubSources('acme/tool', { fetcher: async url => new Response(JSON.stringify(String(url).endsWith('/readme') ? { html_url: 'https://github.com/acme/tool/blob/main/README.md', content: Buffer.from('x'.repeat(12001)).toString('base64'), encoding: 'base64' } : [])) });
  expect(result.evidence[0].excerpt).toHaveLength(12000);
  expect(result.warnings).toContain('readme: entry 1 excerpt truncated; source coverage is partial');
});
