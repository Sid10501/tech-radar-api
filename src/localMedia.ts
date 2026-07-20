import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { ExtractResult } from "./extract.js";

export const MAX_LOCAL_MEDIA_BYTES = 20 * 1024 * 1024;
const EXTENSIONS = new Set([".mp4", ".mov", ".m4v", ".webm", ".mp3", ".m4a", ".wav", ".ogg"]);
const SidecarSchema = z.object({
  schemaVersion: z.literal(1), runId: z.string().min(1).max(200), mediaPath: z.string().min(1),
  mimeType: z.string().max(200).optional(), originalName: z.string().max(500).optional(),
}).passthrough();

export async function extractLocalMedia(input: { runId: string; mediaPath: string; mediaDir?: string }): Promise<ExtractResult> {
  const mediaDir = path.resolve(input.mediaDir ?? process.env["MEDIA_UPLOAD_DIR"] ?? "/tmp/tech-radar-media");
  const mediaPath = path.resolve(input.mediaPath);
  const sidecarPath = `${mediaPath}.run.json`;
  const [mediaStat, sidecarStat] = await Promise.all([fs.promises.lstat(mediaPath), fs.promises.lstat(sidecarPath)]);
  if (!mediaStat.isFile() || mediaStat.isSymbolicLink() || !sidecarStat.isFile() || sidecarStat.isSymbolicLink()) throw new Error("media and sidecar must be regular files");
  const realDir = await fs.promises.realpath(mediaDir);
  const realMedia = await fs.promises.realpath(mediaPath);
  if (path.dirname(realMedia) !== realDir) throw new Error("media path is outside MEDIA_UPLOAD_DIR");
  if (mediaStat.size > MAX_LOCAL_MEDIA_BYTES) throw new Error("media exceeds the 20 MB limit");
  if (!EXTENSIONS.has(path.extname(mediaPath).toLowerCase())) throw new Error("unsupported media extension");
  const sidecar = SidecarSchema.parse(JSON.parse(await fs.promises.readFile(sidecarPath, "utf8")));
  if (sidecar.runId !== input.runId || path.resolve(sidecar.mediaPath) !== mediaPath) throw new Error("media sidecar does not match the registered run");
  if (sidecar.mimeType && !/^(?:video\/|audio\/)/i.test(sidecar.mimeType)) throw new Error("unsupported media MIME type");
  const duration = Number((await exec("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", mediaPath], 10_000)).trim());
  if (!Number.isFinite(duration) || duration < 0 || duration > 1_800) throw new Error("media duration must be at most 1800 seconds");
  const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../scripts/extract_post.py");
  const stdout = await exec(process.env["PYTHON_BIN"] ?? "python3", [script, "--local-file", mediaPath, "--source-id", input.runId], 15 * 60_000);
  const result = JSON.parse(stdout) as ExtractResult;
  result.duration_sec = Math.round(duration);
  return result;
}

export async function cleanupRegisteredMedia(mediaPath: string): Promise<void> {
  await Promise.allSettled([fs.promises.unlink(mediaPath), fs.promises.unlink(`${mediaPath}.run.json`)]);
}

function exec(command: string, args: string[], timeout: number): Promise<string> {
  return new Promise((resolve, reject) => execFile(command, args, { timeout, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
    if (error) reject(new Error(`${command} failed: ${(stderr || error.message).slice(0, 1_000)}`));
    else resolve(stdout);
  }));
}
