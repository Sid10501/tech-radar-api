import Anthropic from "@anthropic-ai/sdk";
import { readAiMemory, listRecentSessions } from "../tools/ai_memory.js";
import { wrapAsUntrusted } from "../lib/untrustedContent.js";
import { parseAgentOutput } from "../lib/validateAgentOutput.js";
import {
  ImplementationOutputSchema,
  type ImplementationOutput,
} from "../schemas/implementationOutput.js";
import { IMPLEMENTATION_SYSTEM_PROMPT } from "./prompts.js";
import { parseJsonObjectFromModelText } from "./json.js";
import type { ExtractResult } from "../extract.js";
import type { ResearchOutput } from "./research.js";

export { ImplementationOutputSchema, type ImplementationOutput };

// Backward-compat: accept old `fit_for_sid` key from callers/tests that haven't migrated
export function normalizeImplementationOutput(raw: Record<string, unknown>): Record<string, unknown> {
  if (!("fit_for_owner" in raw) && "fit_for_sid" in raw) {
    return { ...raw, fit_for_owner: raw["fit_for_sid"] };
  }
  return raw;
}

const TOOLS: Anthropic.Tool[] = [
  {
    name: "read_ai_memory",
    description: "Read a file from Sid's ai-memory knowledge base. Allowed paths: GLOBAL_MEMORY.md, domains/<file>.md, sessions/<file>.md",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Relative path within ai-memory, e.g. GLOBAL_MEMORY.md or domains/webdev.md",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "list_recent_sessions",
    description: "List the n most recent session log filenames from sessions/ (sorted newest-first).",
    input_schema: {
      type: "object" as const,
      properties: {
        n: {
          type: "number",
          description: "Number of sessions to list (default 5)",
        },
      },
      required: [],
    },
  },
];

async function executeTool(
  name: string,
  input: Record<string, unknown>,
  memoryDir: string,
): Promise<string> {
  if (name === "read_ai_memory") {
    const filePath = input["path"] as string;
    const content = await readAiMemory(filePath, memoryDir);
    return wrapAsUntrusted(content, { label: `ai-memory file ${filePath}` });
  }
  if (name === "list_recent_sessions") {
    const n = (input["n"] as number | undefined) ?? 5;
    const sessions = await listRecentSessions(n, memoryDir);
    return wrapAsUntrusted(JSON.stringify(sessions), { label: "session index listing" });
  }
  return wrapAsUntrusted(JSON.stringify({ error: `Unknown tool: ${name}` }), {
    label: "tool error",
  });
}

function buildImplementationUserMessage(
  extract: ExtractResult,
  research: ResearchOutput,
  ownerName: string,
): string {
  const title =
    extract.title_for_llm ??
    (extract.title?.trim()
      ? wrapAsUntrusted(extract.title, { label: "post title" })
      : "unknown");

  const researchSummary = wrapAsUntrusted(
    [
      `What: ${research.what}`,
      `Who: ${research.who}`,
      `Status: ${research.status}`,
      `Why it matters: ${research.why}`,
      `Kickstarter: ${research.kickstarter}`,
      `GitHub stars: ${research.viability_signals.github_stars}`,
    ].join("\n"),
    { label: "validated research summary" },
  );

  return [
    `Produce an implementation recommendation for ${ownerName} based on the following technology.`,
    "",
    `URL (reference only): ${extract.url}`,
    "",
    "Post title:",
    title,
    "",
    researchSummary,
    "",
    "Read GLOBAL_MEMORY.md first, then domains/webdev.md, then call list_recent_sessions and read the 2 most recent session files. Then produce the JSON output.",
  ].join("\n");
}

export async function runImplementation(
  extract: ExtractResult,
  research: ResearchOutput,
  memoryDir?: string,
): Promise<ImplementationOutput> {
  const client = new Anthropic();
  const ownerName = process.env["OWNER_NAME"] ?? "the developer";

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: buildImplementationUserMessage(extract, research, ownerName),
    },
  ];

  const systemBlock: Anthropic.TextBlockParam & { cache_control: { type: "ephemeral" } } = {
    type: "text",
    text: IMPLEMENTATION_SYSTEM_PROMPT,
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
        throw new Error("Implementation agent returned no text content");
      }
      try {
        const jsonPayload = JSON.stringify(
          normalizeImplementationOutput(
            parseJsonObjectFromModelText<Record<string, unknown>>(textBlock.text),
          ),
        );
        const validated = parseAgentOutput(
          jsonPayload,
          ImplementationOutputSchema,
          "implementation",
        );
        if (!validated.ok) {
          throw new Error(validated.error);
        }
        return validated.data;
      } catch {
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
        const result = await executeTool(
          tool.name,
          tool.input as Record<string, unknown>,
          memoryDir ?? process.env["AI_MEMORY_LOCAL_DIR"] ?? "",
        );
        toolResults.push({
          type: "tool_result",
          tool_use_id: tool.id,
          content: result,
        });
      }

      messages.push({ role: "user", content: toolResults });
      continue;
    }

    messages.push({ role: "assistant", content: response.content });
  }

  throw new Error(`Implementation agent exceeded ${MAX_ITERATIONS} iterations without finishing`);
}
