import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  runPipeline,
  listRuns,
  DuplicateRunError,
  runMediaPipeline,
  type PipelinePromise,
  type Run,
  type SocialVideoOrigin,
} from "./runner.js";
import type { SocialVideoIntent } from "./socialVideoRouting.js";

const URL_RE = /https?:\/\/[^\s]+/;
const MAX_TELEGRAM_FILE_BYTES = 20 * 1024 * 1024;

interface TelegramFile {
  file_id: string;
  file_unique_id?: string;
  file_size?: number;
  file_name?: string;
  mime_type?: string;
}

interface TelegramMessage {
  message_id?: number;
  chat?: { id?: number };
  from?: { id?: number };
  text?: string;
  caption?: string;
  video?: TelegramFile;
  document?: TelegramFile;
  animation?: TelegramFile;
}

export interface ParsedTelegramIntake {
  url?: string;
  intent: SocialVideoIntent;
  text: string;
}

interface MediaInput {
  fileId: string;
  fileUniqueId: string;
  fileSize: number;
  fileName?: string;
  mimeType?: string;
}

type MediaDownloader = (fileId: string, token: string, maxBytes: number) => Promise<Buffer>;

interface TelegramDependencies {
  send?: (chatId: number, text: string) => void;
  runPipeline?: (url: string, options: { intent: SocialVideoIntent; origin: SocialVideoOrigin; force?: boolean }) => PipelinePromise | (Promise<unknown> & { runId?: string });
  persistFile?: (input: MediaInput) => Promise<string>;
  registerAwaitingMedia?: (input: Parameters<typeof runMediaPipeline>[0]) => PipelinePromise | Run;
}

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

export function parseTelegramIntake(message: Pick<TelegramMessage, "text" | "caption">): ParsedTelegramIntake {
  const text = (message.text ?? message.caption ?? "").trim();
  const command = text.match(/^\/(stock|tech)(?:@\w+)?\b/i)?.[1]?.toLowerCase();
  const intent: SocialVideoIntent = command === "stock" ? "finance" : command === "tech" ? "technology" : "auto";
  return { url: text.match(URL_RE)?.[0]?.replace(/[),.;]+$/, ""), intent, text };
}

export async function handleTelegramUpdate(update: Record<string, unknown>, deps: TelegramDependencies = {}): Promise<void> {
  const message = update["message"] as TelegramMessage | undefined;
  if (!message) return;
  const chatId = message.chat?.id;
  if (!chatId) return;
  const send = deps.send ?? reply;
  if (!isAuthorizedOwner(message)) {
    send(chatId, "⛔ Unauthorized.");
    return;
  }

  const intake = parseTelegramIntake(message);
  if (intake.text === "/help" || intake.text === "/start") {
    send(chatId, [
      "🔭 *Tech Radar Bot*",
      "",
      "Send or caption a public URL. Use `/stock <url>` or `/tech <url>` to override routing.",
      "Upload an owner-supplied video up to 20 MB when a public link is inaccessible.",
      "",
      "Commands: `/status`, `/list`, `/retry <url>`, `/help`",
    ].join("\n"));
    return;
  }

  if (intake.text.startsWith("/retry")) {
    const retryUrl = intake.text.replace(/^\/retry(?:@\w+)?/i, "").trim();
    if (!retryUrl) return send(chatId, "Usage: `/retry <url>`");
    send(chatId, `⏳ Force-retrying:\n${retryUrl}`);
    try {
      const start = deps.runPipeline ?? runPipeline;
      start(retryUrl, { force: true, intent: "auto", origin: telegramOrigin(message, chatId) }).catch((error: unknown) => {
        send(chatId, `❌ Retry failed: \`${error instanceof Error ? error.message.slice(0, 200) : String(error)}\``);
      });
    } catch (error) {
      if (error instanceof DuplicateRunError) {
        send(chatId, `⚠️ Already ${error.existingRun.status}:\n${retryUrl}`);
        return;
      }
      send(chatId, `❌ Retry failed: \`${error instanceof Error ? error.message.slice(0, 200) : String(error)}\``);
    }
    return;
  }

  if (intake.text === "/status") {
    const recent = listRuns().slice(0, 5);
    send(chatId, recent.length ? recent.map((run) => `${statusIcon(run)} ${run.status} — ${run.url.slice(0, 50)}`).join("\n") : "No runs yet.");
    return;
  }

  if (intake.text === "/list") {
    const repoUrl = process.env["AI_MEMORY_REPO_URL"] ?? "";
    const lines = listRuns().filter((run) => run.status === "processed" && run.findingPath).slice(0, 8).map((run) => {
      const name = path.basename(run.findingPath!, ".md");
      const link = repoUrl ? `${repoUrl}/blob/master/${run.findingPath}` : run.findingPath!;
      return `• [${name}](${link})`;
    });
    send(chatId, lines.length ? `*Recent findings:*\n\n${lines.join("\n")}` : "No findings yet.");
    return;
  }

  const media = telegramMedia(message);
  if (media) {
    let mediaPath: string | undefined;
    try {
      const persist = deps.persistFile ?? ((input: MediaInput) => persistTelegramMedia(input, {
        token: process.env["TELEGRAM_BOT_TOKEN"] ?? "",
        mediaDir: process.env["MEDIA_UPLOAD_DIR"] ?? "/tmp/tech-radar-media",
      }));
      mediaPath = await persist(media);
      const register = deps.registerAwaitingMedia ?? runMediaPipeline;
      const run = register({
        fileUniqueId: media.fileUniqueId,
        mediaPath,
        intent: intake.intent,
        origin: telegramOrigin(message, chatId),
        mimeType: media.mimeType,
        originalName: media.fileName,
      });
      if ("catch" in run) run.catch((error: unknown) => send(chatId, `❌ Pipeline error: \`${error instanceof Error ? error.message.slice(0, 200) : String(error)}\``));
      send(chatId, `📥 File saved securely and queued as run ${"runId" in run ? run.runId : run.id}; secure local extractor processing started.`);
    } catch (error) {
      if (mediaPath) {
        try { fs.unlinkSync(mediaPath); } catch { /* already absent */ }
      }
      send(chatId, `❌ Upload rejected: ${error instanceof Error ? error.message : String(error)}`);
    }
    return;
  }

  if (intake.url) {
    try {
      const start = deps.runPipeline ?? runPipeline;
      const completion = start(intake.url, { intent: intake.intent, origin: telegramOrigin(message, chatId) });
      const runId = completion.runId ?? "registered";
      completion.catch((error: unknown) => {
        send(chatId, `❌ Pipeline error: \`${error instanceof Error ? error.message.slice(0, 200) : String(error)}\``);
      });
      send(chatId, `⏳ Queued run ${runId} (${intake.intent}):\n${intake.url}`);
    } catch (error) {
      if (error instanceof DuplicateRunError) {
        send(chatId, `⚠️ Already ${error.existingRun.status}:\n${intake.url}`);
        return;
      }
      throw error;
    }
    return;
  }

  send(chatId, "Send a public URL, or upload the owner-supplied video (max 20 MB) if the post is private/inaccessible.");
}

function isAuthorizedOwner(message: TelegramMessage): boolean {
  const allowedChat = process.env["TELEGRAM_CHAT_ID"];
  const allowedUser = process.env["TELEGRAM_USER_ID"];
  if (allowedChat && String(message.chat?.id) !== allowedChat) return false;
  if (allowedUser && String(message.from?.id) !== allowedUser) return false;
  return Boolean(allowedChat || allowedUser);
}

function telegramOrigin(message: TelegramMessage, chatId: number): SocialVideoOrigin {
  return { channel: "telegram", chatId: String(chatId), messageId: message.message_id == null ? undefined : String(message.message_id) };
}

function telegramMedia(message: TelegramMessage): MediaInput | null {
  const media = message.video ?? message.document ?? message.animation;
  if (!media?.file_id || !media.file_unique_id || media.file_size == null) return null;
  return {
    fileId: media.file_id,
    fileUniqueId: media.file_unique_id,
    fileSize: media.file_size,
    fileName: media.file_name,
    mimeType: media.mime_type,
  };
}

function statusIcon(run: Run): string {
  if (run.status === "processed") return "✅";
  if (run.status === "failed") return "❌";
  if (run.status === "skipped") return "⏭️";
  return "⏳";
}

export async function persistTelegramMedia(
  input: MediaInput,
  options: { token: string; mediaDir: string; downloader?: MediaDownloader },
): Promise<string> {
  if (!Number.isInteger(input.fileSize) || input.fileSize < 0 || input.fileSize > MAX_TELEGRAM_FILE_BYTES) {
    throw new Error("Telegram upload exceeds the 20 MB limit");
  }
  if (!options.token) throw new Error("Telegram bot token is not configured");
  const downloader = options.downloader ?? downloadTelegramFile;
  const bytes = await downloader(input.fileId, options.token, MAX_TELEGRAM_FILE_BYTES);
  if (bytes.length > MAX_TELEGRAM_FILE_BYTES) throw new Error("Telegram upload exceeds the 20 MB limit");
  fs.mkdirSync(options.mediaDir, { recursive: true, mode: 0o700 });
  const extension = safeMediaExtension(input.fileName, input.mimeType);
  const digest = createHash("sha256").update(input.fileUniqueId).digest("hex").slice(0, 24);
  const destination = path.join(options.mediaDir, `${digest}${extension}`);
  const resolvedDir = path.resolve(options.mediaDir);
  if (path.dirname(path.resolve(destination)) !== resolvedDir) throw new Error("unsafe media filename");
  fs.writeFileSync(destination, bytes, { mode: 0o600, flag: "wx" });
  return destination;
}

async function downloadTelegramFile(fileId: string, token: string, maxBytes: number): Promise<Buffer> {
  const metadata = await timedFetch(`https://api.telegram.org/bot${encodeURIComponent(token)}/getFile?file_id=${encodeURIComponent(fileId)}`, 10_000);
  if (!metadata.ok) throw new Error(`Telegram getFile failed with HTTP ${metadata.status}`);
  const body = await metadata.json() as { ok?: boolean; result?: { file_path?: string; file_size?: number } };
  const filePath = body.result?.file_path;
  if (!body.ok || !filePath || !/^[A-Za-z0-9_./-]+$/.test(filePath) || filePath.includes("..")) throw new Error("Telegram returned an unsafe file path");
  if ((body.result?.file_size ?? 0) > maxBytes) throw new Error("Telegram upload exceeds the 20 MB limit");
  const response = await timedFetch(`https://api.telegram.org/file/bot${encodeURIComponent(token)}/${filePath}`, 30_000);
  if (!response.ok || !response.body) throw new Error(`Telegram file download failed with HTTP ${response.status}`);
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new Error("Telegram upload exceeds the 20 MB limit");
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("Telegram upload exceeds the 20 MB limit");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

async function timedFetch(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { redirect: "error", signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

function safeMediaExtension(fileName?: string, mimeType?: string): string {
  const allowed = new Set([".mp4", ".mov", ".m4v", ".webm"]);
  const extension = fileName ? path.extname(path.basename(fileName)).toLowerCase() : "";
  if (allowed.has(extension)) return extension;
  if (mimeType === "video/quicktime") return ".mov";
  if (mimeType === "video/webm") return ".webm";
  return ".mp4";
}

export { MAX_TELEGRAM_FILE_BYTES };
