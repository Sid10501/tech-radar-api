import { z } from 'zod';

export const SourceEvidenceSchema = z.object({
  id: z.string().min(1).max(120),
  kind: z.enum(['readme', 'release', 'issue', 'metadata']),
  url: z.string().url().refine(value => { const u = new URL(value); return u.protocol === 'https:' && u.hostname === 'github.com' && !u.username && !u.password && !u.port; }, 'Expected a public GitHub source URL'),
  retrieved_at: z.string().datetime(),
  published_at: z.string().datetime().nullable(),
  excerpt: z.string().max(12000),
});
export type SourceEvidence = z.infer<typeof SourceEvidenceSchema>;

export const ResearchDraftSchema = z.object({
  what: z.string(), display_name: z.string().nullish(), display_summary: z.string().nullish(),
  who: z.string(), status: z.enum(['stable', 'alpha', 'beta', 'abandoned', 'unknown']),
  why: z.string(), comparisons: z.array(z.string()),
  links: z.object({ github: z.string().nullable(), docs: z.string().nullable(), npm: z.string().nullable() }),
  kickstarter: z.string(),
  kickstarter_kind: z.enum(['pseudocode', 'source_documented']).optional(),
  identity: z.object({ status: z.enum(['resolved', 'unresolved']), repo: z.string().nullable(), basis: z.enum(['archive_reported', 'source_reported', 'unresolved']), finding_ids: z.array(z.string()).max(5) }).optional(),
  grounding_warnings: z.array(z.string().max(500)).max(12).optional(),
  evidence: z.array(SourceEvidenceSchema).max(12).optional(),
  claims: z.array(z.object({ statement: z.string().min(1).max(2000), status: z.enum(['reported', 'source_verified']), evidence_ids: z.array(z.string()).max(12), quoted_text: z.string().max(2000).optional() })).max(12).optional(),
  viability_signals: z.object({
    github_stars: z.number().int().nonnegative().nullable(), last_pushed: z.string().nullable(),
    open_issues: z.number().int().nonnegative().nullable(), license: z.string().nullable(), archived: z.boolean().nullable(),
  }),
});
export const ResearchOutputSchema = ResearchDraftSchema.superRefine((output, ctx) => {
  const evidence = new Map((output.evidence ?? []).map(item => [item.id, item]));
  for (const [index, claim] of (output.claims ?? []).entries()) {
    if (claim.evidence_ids.some(id => !evidence.has(id))) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['claims', index, 'evidence_ids'], message: 'Unknown evidence ID' });
    if (claim.status === 'source_verified' && (!claim.quoted_text || claim.statement !== claim.quoted_text || !claim.evidence_ids.some(id => {
      const source = evidence.get(id); return source && source.kind !== 'metadata' && source.excerpt.includes(claim.quoted_text!);
    }))) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['claims', index], message: 'source_verified means an exact source quotation, not a verified real-world outcome' });
  }
});
export type ResearchOutput = z.infer<typeof ResearchOutputSchema>;
