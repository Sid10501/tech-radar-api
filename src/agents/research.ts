import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { githubLookup } from "../tools/github.js";
import { RESEARCH_SYSTEM_PROMPT } from "./prompts.js";
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
  {
    name: "web_search",
    description: "Search the web for information about a technology.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Search query" },
      },
      required: ["query"],
    },
  },
  {
    name: "web_fetch",
    description: "Fetch the content of a URL.",
    input_schema: {
      type: "object" as const,
      properties: {
        url: { type: "string", description: "URL to fetch" },
      },
      required: ["url"],
    },
  },
];

async function executeTool(name: string, input: Record<string, unknown>): Promise<string> {
  if (name === "github_lookup") {
    const repo = input["repo"] as string;
    const info = await githubLookup(repo);
    return JSON.stringify(info);
  }
  // web_search and web_fetch are stubs — the server-side tool versions handle these
  // In practice Claude uses the server-side web_search/web_fetch tools; these stubs
  // exist so the tool list is valid and our mock tests can exercise the loop.
  return JSON.stringify({ error: `Tool ${name} not implemented in this runtime` });
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
      // Extract the final text block
      const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
      if (!textBlock) {
        throw new Error("Research agent returned no text content");
      }
      const parsed = ResearchOutputSchema.parse(JSON.parse(textBlock.text));
      return parsed;
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
