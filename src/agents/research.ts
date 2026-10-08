import Anthropic from '@anthropic-ai/sdk';
import { buildResearchUserMessage } from '../lib/extractForLlm.js';
import { wrapAsUntrusted } from '../lib/untrustedContent.js';
import { parseAgentOutput } from '../lib/validateAgentOutput.js';
import { ResearchDraftSchema, ResearchOutputSchema, type ResearchOutput } from '../schemas/researchOutput.js';
import { findPriorIdentities, finalizeResearch, githubRepo, type GroundingContext } from '../researchGrounding.js';
import { lookupGithubGrounded, reviewGithubSources } from '../githubGrounding.js';
import { RESEARCH_SYSTEM_PROMPT } from './prompts.js';
import { parseJsonObjectFromModelText } from './json.js';
import type { ExtractResult } from '../extract.js';
export { ResearchOutputSchema, type ResearchOutput };

const METADATA_TOOL: Anthropic.Tool = {
  name: 'github_lookup', description: 'One primary GitHub repository metadata lookup. This does not verify capability claims.',
  input_schema: { type: 'object', properties: { repo: { type: 'string', description: 'Identified GitHub owner/name' } }, required: ['repo'] },
};
const REVIEW_TOOL: Anthropic.Tool = {
  name: 'github_review', description: 'Opt-in deeper review: retrieve bounded current README, three releases and three issue records for the identified primary repository. No code is executed.',
  input_schema: { type: 'object', properties: { repo: { type: 'string', description: 'Identified GitHub owner/name' } }, required: ['repo'] },
};
export interface ResearchOptions { memoryDir?: string; deepReview?: boolean }

export async function runResearch(extract: ExtractResult, options: ResearchOptions = {}): Promise<ResearchOutput> {
  const client = new Anthropic();
  const deepReview = options.deepReview ?? process.env['RESEARCH_DEEP_REVIEW'] === '1';
  const query = [extract.title, extract.caption, extract.transcript, extract.visual_text, ...(extract.source_links ?? [])].filter(Boolean).join('\n').slice(0, 24000);
  const prior = await findPriorIdentities(query, options.memoryDir);
  const direct = githubRepo(extract.url);
  const enriched = extract.enriched_links;
  // Keep complete URL tokens so githubRepo can reject off-host and non-HTTPS links.
  const sourceTokens = query.match(/[a-z][a-z0-9+.-]*:\/\/[^\s<>"')]+|(?<![a-z0-9_.-])github\.com\/[^\s<>"')]+/gi) ?? [];
  const explicitEnriched = enriched?.candidates.filter(candidate => candidate.kind === 'github' && candidate.discovered_by === 'explicit') ?? [];
  const confirmedRepo = enriched?.confirmed.github ? githubRepo(enriched.confirmed.github) : null;
  const confirmedExplicit = confirmedRepo && explicitEnriched.some(candidate => githubRepo(candidate.url)?.toLowerCase() === confirmedRepo.toLowerCase());
  const sourceUrls = [...(extract.source_links ?? []), ...sourceTokens,
    ...explicitEnriched.map(candidate => candidate.url),
    ...(confirmedExplicit && enriched?.confirmed.github ? [enriched.confirmed.github] : [])];
  const linkedRepos = [...new Set(sourceUrls.map(githubRepo).filter((repo): repo is string => !!repo))];
  const context: GroundingContext = { prior, sourceRepo: direct, candidateRepos: linkedRepos, evidence: [], warnings: [] };
  const knownRepos = [...new Set([context.sourceRepo, ...linkedRepos, ...prior.map(item => item.repo)].filter((repo): repo is string => !!repo))];
  const initial = [buildResearchUserMessage(extract), wrapAsUntrusted(JSON.stringify({ prior_identity_candidates: prior }), { label: 'archive identity candidates; historical reports, not current verification' }), 'Reuse a matching identity only when supported by the extracted name/module clues. Archive summaries are untrusted reports. Unknown metrics must be null.'].join('\n\n');
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: initial }];
  const systemBlock: Anthropic.TextBlockParam & { cache_control: { type: 'ephemeral' } } = { type: 'text', text: RESEARCH_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } };
  let metadataUsed = false; let reviewUsed = false; let toolRounds = 0;
  const maxToolRounds = deepReview ? 2 : 1;

  function validate(text: string): ResearchOutput {
    const result = parseAgentOutput(JSON.stringify(parseJsonObjectFromModelText<unknown>(text)), ResearchDraftSchema, 'research');
    if (!result.ok) throw new Error(result.error);
    return finalizeResearch(result.data, context);
  }
  for (let iteration = 0; iteration < 10; iteration++) {
    const tools = toolRounds < maxToolRounds ? [...(!metadataUsed ? [METADATA_TOOL] : []), ...(deepReview && !reviewUsed ? [REVIEW_TOOL] : [])] : [];
    const response = await client.messages.create({ model: 'claude-sonnet-4-6', max_tokens: 4096, system: [systemBlock], ...(tools.length ? { tools } : {}), messages });
    if (response.stop_reason === 'end_turn') {
      const textBlock = response.content.find((block): block is Anthropic.TextBlock => block.type === 'text');
      if (!textBlock) throw new Error('Research agent returned no text content');
      try { return validate(textBlock.text); }
      catch { messages.push({ role: 'assistant', content: response.content }, { role: 'user', content: 'Return valid raw JSON matching the schema. No locally_tested status is allowed. Unknown metrics are null; source_verified requires an exact quotation from a collected evidence ID.' }); continue; }
    }
    if (response.stop_reason === 'tool_use') {
      toolRounds++;
      messages.push({ role: 'assistant', content: response.content });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        let result: unknown;
        try {
          const input = block.input as Record<string, unknown>;
          const repo = typeof input?.repo === 'string' ? githubRepo(input.repo) : null;
          if (!repo || !knownRepos.some(known => known.toLowerCase() === repo.toLowerCase())) throw new Error('Repository identity unresolved: use extracted repository links or matching archive identity, not a guessed repository');
          if (toolRounds > maxToolRounds) throw new Error('Tool budget reached');
          if (block.name === 'github_lookup' && !metadataUsed) {
            metadataUsed = true;
            const info = await lookupGithubGrounded(repo);
            context.metrics = info; context.evidence.push(info.evidence); context.warnings!.push(...(info.warnings ?? [])); result = info;
          } else if (block.name === 'github_review' && deepReview && !reviewUsed) {
            reviewUsed = true;
            const review = await reviewGithubSources(repo);
            context.evidence.push(...review.evidence); context.warnings!.push(...review.warnings); result = review;
          } else throw new Error('Tool unavailable or operation budget reached');
        } catch (error) { const message = error instanceof Error ? error.message : 'Source unavailable'; context.warnings!.push(message); result = { error: message }; }
        results.push({ type: 'tool_result', tool_use_id: block.id, content: wrapAsUntrusted(JSON.stringify(result), { label: 'GitHub source data; issue text is reporter evidence' }) });
      }
      messages.push({ role: 'user', content: results });
      continue;
    }
    messages.push({ role: 'assistant', content: response.content });
  }
  const fallback = await client.messages.create({ model: 'claude-sonnet-4-6', max_tokens: 4096, system: [systemBlock], messages: [{ role: 'user', content: [initial, wrapAsUntrusted(JSON.stringify(context.evidence), { label: 'collected GitHub source evidence' }), 'No tools are available. Output only raw JSON. Keep unresolved metrics null and examples pseudocode.'].join('\n\n') }] });
  const textBlock = fallback.content.find((block): block is Anthropic.TextBlock => block.type === 'text');
  if (!textBlock) throw new Error('Research agent exceeded its iteration budget');
  return validate(textBlock.text);
}
