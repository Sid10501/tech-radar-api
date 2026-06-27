import Anthropic from "@anthropic-ai/sdk";
import { githubLookup } from "../tools/github.js";
import { buildResearchUserMessage } from "../lib/extractForLlm.js";
import { wrapAsUntrusted } from "../lib/untrustedContent.js";
import { parseAgentOutput } from "../lib/validateAgentOutput.js";
import { ResearchOutputSchema, type ResearchOutput } from "../schemas/researchOutput.js";
import { RESEARCH_SYSTEM_PROMPT } from "./prompts.js";
import { parseJsonObjectFromModelText } from "./json.js";
import type { ExtractResult } from "../extract.js";

export { ResearchOutputSchema, type ResearchOutput };

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
      return wrapAsUntrusted(JSON.stringify(info), { label: "GitHub API response" });
    } catch (err) {
      return wrapAsUntrusted(
        JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
        { label: "GitHub API error" },
      );
    }
  }
  return wrapAsUntrusted(JSON.stringify({ error: `Unknown tool: ${name}` }), {
    label: "tool error",
  });
}

export async function runResearch(extract: ExtractResult): Promise<ResearchOutput> {
  const client = new Anthropic();

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: buildResearchUserMessage(extract) },
  ];

  const systemBlock: Anthropic.TextBlockParam & { cache_control: { type: "ephemeral" } } = {
    type: "text",
    text: RESEARCH_SYSTEM_PROMPT,
    cache_control: { type: "ephemeral" },
  };

  let iterations = 0;
  const MAX_ITERATIONS = 10;
  let toolRounds = 0;
  const MAX_TOOL_ROUNDS = 1;
  let lastValidationError = "";

  while (iterations < MAX_ITERATIONS) {
    iterations++;
    const allowTools = toolRounds < MAX_TOOL_ROUNDS;

    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: [systemBlock],
      ...(allowTools ? { tools: TOOLS } : {}),
      messages,
    });

    if (response.stop_reason === "end_turn") {
      const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
      if (!textBlock) {
        throw new Error("Research agent returned no text content");
      }
      try {
        const jsonPayload = JSON.stringify(
          parseJsonObjectFromModelText<unknown>(textBlock.text),
        );
        const validated = parseAgentOutput(jsonPayload, ResearchOutputSchema, "research");
        if (!validated.ok) {
          throw new Error(validated.error);
        }
        return validated.data;
      } catch (err) {
        lastValidationError = err instanceof Error ? err.message : String(err);
        messages.push({ role: "assistant", content: response.content });
        messages.push({
          role: "user",
          content: "Your response was not valid JSON. Output ONLY the raw JSON object — no markdown, no code blocks, no explanation.",
        });
        continue;
      }
    }

    if (response.stop_reason === "tool_use") {
      toolRounds++;
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
      if (toolRounds >= MAX_TOOL_ROUNDS) {
        messages.push({
          role: "user",
          content:
            "Tool budget reached. Use the evidence already available and output ONLY the raw JSON object now. Do not request more tools.",
        });
      }
      continue;
    }

    messages.push({ role: "assistant", content: response.content });
  }

  const fallback = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system: [systemBlock],
    messages: [
      {
        role: "user",
        content: [
          buildResearchUserMessage(extract),
          "",
          "No tools are available for this final pass. Use the extracted evidence only. If a repo or metric is uncertain, set it to null/unknown/0 as appropriate. Output ONLY the raw JSON object.",
        ].join("\n"),
      },
    ],
  });

  const textBlock = fallback.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  if (!textBlock) {
    throw new Error(`Research agent exceeded ${MAX_ITERATIONS} iterations without finishing`);
  }
  const jsonPayload = JSON.stringify(parseJsonObjectFromModelText<unknown>(textBlock.text));
  const validated = parseAgentOutput(jsonPayload, ResearchOutputSchema, "research");
  if (!validated.ok) {
    const detail = lastValidationError ? ` Last validation error: ${lastValidationError}` : "";
    throw new Error(
      `Research agent exceeded ${MAX_ITERATIONS} iterations and fallback output was invalid.${detail}`,
    );
  }
  return validated.data;
}
