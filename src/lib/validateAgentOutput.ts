import { z } from "zod";

export type ParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; issues?: z.ZodIssue[] };

export function parseAgentOutput<T extends z.ZodTypeAny>(
  raw: string,
  schema: T,
  agentName: string,
): ParseResult<z.infer<T>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return {
      ok: false,
      error: `${agentName}: response is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      error: `${agentName}: output failed schema validation`,
      issues: result.error.issues,
    };
  }
  return { ok: true, data: result.data };
}
