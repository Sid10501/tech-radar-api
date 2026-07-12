import { z } from "zod";

export const ResearchOutputSchema = z.object({
  what: z.string(),
  display_name: z.string().nullish(),
  display_summary: z.string().nullish(),
  who: z.string(),
  status: z.enum(["stable", "alpha", "beta", "abandoned", "unknown"]),
  why: z.string(),
  comparisons: z.array(z.string()),
  links: z.object({
    github: z.string().nullable(),
    docs: z.string().nullable(),
    npm: z.string().nullable(),
  }),
  kickstarter: z.string(),
  viability_signals: z.object({
    github_stars: z.number(),
    last_pushed: z.string().nullable(),
    open_issues: z.number(),
    license: z.string().nullable(),
    archived: z.boolean(),
  }),
});

export type ResearchOutput = z.infer<typeof ResearchOutputSchema>;
