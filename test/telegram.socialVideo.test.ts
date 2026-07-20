import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  handleTelegramUpdate,
  parseTelegramIntake,
  persistTelegramMedia,
} from "../src/telegram.js";
import { DuplicateRunError } from "../src/runner.js";

describe("Telegram social-video intake", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("accepts caption URLs and parses stock/tech overrides", () => {
    expect(parseTelegramIntake({ caption: "/stock https://youtu.be/abc" })).toMatchObject({ url: "https://youtu.be/abc", intent: "finance" });
    expect(parseTelegramIntake({ text: "/tech https://example.com/tool" })).toMatchObject({ url: "https://example.com/tool", intent: "technology" });
    expect(parseTelegramIntake({ caption: "watch https://example.com/general" })).toMatchObject({ url: "https://example.com/general", intent: "auto" });
  });

  it("requires both configured owner chat and owner user authorization", async () => {
    vi.stubEnv("TELEGRAM_CHAT_ID", "100");
    vi.stubEnv("TELEGRAM_USER_ID", "200");
    const send = vi.fn();
    const run = vi.fn();
    await handleTelegramUpdate({ message: { message_id: 1, chat: { id: 100 }, from: { id: 999 }, text: "https://example.com/video" } }, { send, runPipeline: run });
    expect(run).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(100, expect.stringMatching(/Unauthorized/i));
  });

  it("queues caption URLs with origin metadata and acknowledges immediately", async () => {
    vi.stubEnv("TELEGRAM_CHAT_ID", "100");
    vi.stubEnv("TELEGRAM_USER_ID", "200");
    const pending = new Promise(() => {});
    const run = vi.fn(() => Object.assign(pending, { runId: "run-1" }));
    const send = vi.fn();
    await handleTelegramUpdate({ message: {
      message_id: 77,
      chat: { id: 100 },
      from: { id: 200 },
      caption: "/stock https://youtu.be/abc",
    } }, { send, runPipeline: run });
    expect(run).toHaveBeenCalledWith("https://youtu.be/abc", {
      intent: "finance",
      origin: { channel: "telegram", chatId: "100", messageId: "77" },
    });
    expect(send).toHaveBeenCalledWith(100, expect.stringMatching(/Queued.*run-1/i));
  });

  it("reports a synchronous duplicate outcome for /retry without rejecting the update", async () => {
    vi.stubEnv("TELEGRAM_CHAT_ID", "100");
    const send = vi.fn();
    const existing = { id: "existing", url: "https://youtu.be/abc", status: "processed", startedAt: new Date().toISOString() } as any;
    const run = vi.fn(() => { throw new DuplicateRunError(existing, true); });
    await expect(handleTelegramUpdate({ message: { chat: { id: 100 }, text: "/retry https://youtu.be/abc" } }, { send, runPipeline: run as any })).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledWith(100, expect.stringMatching(/already processed/i));
  });

  it("persists an owner file with a safe name before acknowledging awaiting-media", async () => {
    vi.stubEnv("TELEGRAM_CHAT_ID", "100");
    vi.stubEnv("TELEGRAM_USER_ID", "200");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "telegram-media-"));
    const events: string[] = [];
    const persistFile = vi.fn(async () => {
      const filePath = path.join(dir, "safe.mp4");
      fs.writeFileSync(filePath, "video");
      events.push("persisted");
      return filePath;
    });
    const registerAwaitingMedia = vi.fn(() => ({
      id: "media-run",
      url: "telegram-file:unique-1",
      status: "awaiting_media" as const,
      startedAt: new Date().toISOString(),
    }));
    const send = vi.fn(() => { events.push("ack"); });

    await handleTelegramUpdate({ message: {
      message_id: 9,
      chat: { id: 100 },
      from: { id: 200 },
      video: { file_id: "file-1", file_unique_id: "unique-1", file_size: 1024, file_name: "../../evil.mp4", mime_type: "video/mp4" },
      caption: "/stock",
    } }, { send, persistFile, registerAwaitingMedia });

    expect(events).toEqual(["persisted", "ack"]);
    expect(registerAwaitingMedia).toHaveBeenCalledWith(expect.objectContaining({ mediaPath: path.join(dir, "safe.mp4"), intent: "finance" }));
    expect(send).toHaveBeenCalledWith(100, expect.stringMatching(/saved securely.*processing started/i));
  });

  it("rejects Telegram files over 20 MB before download", async () => {
    const downloader = vi.fn();
    await expect(persistTelegramMedia({
      fileId: "large",
      fileUniqueId: "unique",
      fileSize: 20 * 1024 * 1024 + 1,
      fileName: "large.mp4",
      mimeType: "video/mp4",
    }, { token: "token", mediaDir: os.tmpdir(), downloader })).rejects.toThrow(/20 MB/i);
    expect(downloader).not.toHaveBeenCalled();
  });
});
