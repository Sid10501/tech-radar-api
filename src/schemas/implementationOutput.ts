import { z } from "zod";

export const ImplementationOutputSchema = z.object({
  fit_for_owner: z.string(),
  target_project: z.string(),
  implementation_idea_markdown: z.string(),
  standalone_idea: z.object({
    title: z.string().trim().min(1).max(200),
    problem: z.string().trim().min(1).max(2000),
    prototype: z.string().trim().min(1).max(2000),
    question: z.string().trim().min(1).max(1000),
    successCriteria: z.string().trim().min(1).max(1000),
  }).optional(),
  follow_ups: z.array(z.string()),
});

export type ImplementationOutput = z.infer<typeof ImplementationOutputSchema>;
