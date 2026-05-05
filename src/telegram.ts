import https from "node:https";
import { runPipeline, listRuns } from "./runner.js";

const URL_RE = /https?:\/\/[^\s]+/;

function reply(chatId: number, text: string): void {
  const token = process.env["TELEGRAM_BOT_TOKEN"];
  if (!token) return;
  const body = JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown", disable_web_page_preview: true });
  const req = https.request({
    hostname: "api.telegram.org",
    path: `/bot${token}/sendMessage`,
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
  });
  req.on("error", () => {});
  req.write(body);
  req.end();
}

export async function handleTelegramUpdate(update: Record<string, unknown>): Promise<void> {
  const message = update["message"] as Record<string, unknown> | undefined;
  if (!message) return;

  const chatId = (message["chat"] as Record<string, unknown>)?.["id"] as number;
  const text = ((message["text"] as string) ?? "").trim();
  if (!chatId || !text) return;

  // Only respond to the configured owner chat
  const allowedChat = process.env["TELEGRAM_CHAT_ID"];
  if (allowedChat && String(chatId) !== allowedChat) {
    reply(chatId, "⛔ Unauthorized.");
    return;
  }

  // /help
  if (text === "/help" || text === "/start") {
    reply(chatId, [
      "🔭 *Tech Radar Bot*",
      "",
      "Send any Instagram, YouTube, or TikTok URL to research it\\.",
      "",
      "Commands:",
      "`/status` — last 5 runs",
      "`/list` — recent findings with links",
      "`/help` — this message",
    ].join("\n"));
    return;
  }

  // /status
  if (text === "/status") {
    const runs = listRuns().slice(0, 5);
    if (runs.length === 0) {
      reply(chatId, "No runs yet\\.");
      return;
    }
    const lines = runs.map((r) => {
      const icon = r.status === "processed" ? "✅" : r.status === "failed" ? "❌" : "⏳";
      const label = r.url.replace(/[_*[\]()~`>#+=|{}.!-]/g, "\\$&").slice(0, 50);
      return `${icon} ${r.status} — ${label}`;
    });
    reply(chatId, `*Last ${runs.length} runs:*\n\n${lines.join("\n")}`);
    return;
  }

  // /list
  if (text === "/list") {
    const repoUrl = process.env["AI_MEMORY_REPO_URL"] ?? "";
    const processed = listRuns().filter((r) => r.status === "processed" && r.findingPath).slice(0, 8);
    if (processed.length === 0) {
      reply(chatId, "No findings yet\\.");
      return;
    }
    const lines = processed.map((r) => {
      const name = r.findingPath!.split("/").pop()!.replace(".md", "");
      const link = repoUrl ? `${repoUrl}/blob/master/${r.findingPath}` : r.findingPath!;
      return `• [${name}](${link})`;
    });
    reply(chatId, `*Recent findings:*\n\n${lines.join("\n")}`);
    return;
  }

  // URL — queue for research
  const urlMatch = text.match(URL_RE);
  if (urlMatch) {
    const url = urlMatch[0];
    reply(chatId, `⏳ Queued for research:\n${url}`);
    runPipeline(url).catch((err: unknown) => {
      reply(chatId, `❌ Pipeline error: \`${err instanceof Error ? err.message.slice(0, 200) : String(err)}\``);
    });
    return;
  }

  // Unrecognised
  reply(chatId, "Send a URL to research it, or /help for commands\\.");
}
