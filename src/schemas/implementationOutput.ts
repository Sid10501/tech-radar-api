import { z } from "zod";

export const ImplementationOutputSchema = z.object({
  fit_for_owner: z.string(),
  target_project: z.string(),
  implementation_idea_markdown: z.string(),
  follow_ups: z.array(z.string()),
});

export type ImplementationOutput = z.infer<typeof ImplementationOutputSchema>;
