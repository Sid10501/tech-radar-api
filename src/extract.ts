import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

export interface ExtractResult {
  url: string;
  platform: "tiktok" | "instagram" | "youtube" | "other";
  status: "ok" | "partial" | "failed";
  error: string | null;
  title: string | null;
  creator: string | null;
  caption: string | null;
  hashtags: string[];
  duration_sec: number | null;
  transcript: string | null;
  transcript_source: "whisper" | "subs" | null;
  upload_date: string | null;
  raw_metadata_keys: string[];
}

export class ExtractError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "ExtractError";
  }
}

const SCRIPT_DIR = path.resolve(
  fileURLToPath(import.meta.url),
  "../../..",
  "ai-memory/tech-radar/scripts"
);

export function extract(url: string): Promise<ExtractResult> {
  const scriptPath = path.join(SCRIPT_DIR, "run_pipeline.sh");

  return new Promise((resolve, reject) => {
    execFile("bash", [scriptPath, url], { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        return reject(new ExtractError(`extract failed: ${stderr || err.message}`, err));
      }
      try {
        const result = JSON.parse(stdout) as ExtractResult;
        resolve(result);
      } catch (parseErr) {
        reject(new ExtractError(`extract failed: could not parse JSON output`, parseErr));
      }
    });
  });
}
