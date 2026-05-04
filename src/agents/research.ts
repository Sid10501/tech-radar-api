import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { githubLookup } from "../tools/github.js";
import { RESEARCH_SYSTEM_PROMPT } from "./prompts.js";
import { parseJsonObjectFromModelText } from "./json.js";
import type { ExtractResult } from "../extract.js";

export const ResearchOutputSchema = z.object({
  what: z.string(),
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

const TOOLS: Anthropic.Tool[] = [
  {
    name: "github_lookup",
    description: "Get GitHub repository metadata: stars, last push date, open issues, language, license, archived status.",
    input_schema: {
      type: "object" as const,
      properties: {
        repo: {
          type: "string",
          description: "GitHub repo in owner/name format, e.g. colinhacks/zod",
        },
      },
      required: ["repo"],
    },
  },
];

async function executeTool(name: string, input: Record<string, unknown>): Promise<string> {
  if (name === "github_lookup") {
    const repo = input["repo"] as string;
    try {
      const info = await githubLookup(repo);
      return JSON.stringify(info);
    } catch (err) {
      // Return error as tool result so the agent can continue with degraded data
      return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
    }
  }
  return JSON.stringify({ error: `Unknown tool: ${name}` });
}

export async function runResearch(extract: ExtractResult): Promise<ResearchOutput> {
  const client = new Anthropic();

  const userMessage = `Research the following technology extracted from a social media post:

URL: ${extract.url}
Platform: ${extract.platform}
Title: ${extract.title ?? "unknown"}
Creator: ${extract.creator ?? "unknown"}
Caption: ${extract.caption ?? ""}
Hashtags: ${(extract.hashtags ?? []).join(", ")}
Transcript excerpt: ${(extract.transcript ?? "").slice(0, 800)}

Produce the JSON report as instructed. Call github_lookup if the technology has a GitHub repo.`;

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: userMessage },
  ];

  const systemBlock: Anthropic.TextBlockParam & { cache_control: { type: "ephemeral" } } = {
    type: "text",
    text: RESEARCH_SYSTEM_PROMPT,
    cache_control: { type: "ephemeral" },
  };

  let iterations = 0;
  const MAX_ITERATIONS = 10;

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: [systemBlock],
      tools: TOOLS,
      messages,
    });

    if (response.stop_reason === "end_turn") {
      const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
      if (!textBlock) {
        throw new Error("Research agent returned no text content");
      }
      try {
        const parsed = ResearchOutputSchema.parse(
          parseJsonObjectFromModelText<unknown>(textBlock.text),
        );
        return parsed;
      } catch {
        // Model output wasn't valid JSON — ask it to reformat
        messages.push({ role: "assistant", content: response.content });
        messages.push({
          role: "user",
          content: "Your response was not valid JSON. Output ONLY the raw JSON object — no markdown, no code blocks, no explanation.",
        });
        continue;
      }
    }

    if (response.stop_reason === "tool_use") {
      messages.push({ role: "assistant", content: response.content });

      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const tool of toolUseBlocks) {
        const result = await executeTool(tool.name, tool.input as Record<string, unknown>);
        toolResults.push({
          type: "tool_result",
          tool_use_id: tool.id,
          content: result,
        });
      }

      messages.push({ role: "user", content: toolResults });
      continue;
    }

    // pause_turn or unexpected stop reason — append and continue
    messages.push({ role: "assistant", content: response.content });
  }

  throw new Error(`Research agent exceeded ${MAX_ITERATIONS} iterations without finishing`);
}
