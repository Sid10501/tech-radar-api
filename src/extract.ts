import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

export interface ExtractResult {
  url: string;
  platform: "tiktok" | "instagram" | "youtube" | "google_drive" | "other";
  status: "ok" | "partial" | "failed";
  error: string | null;
  title: string | null;
  creator: string | null;
  caption: string | null;
  hashtags: string[];
  duration_sec: number | null;
  transcript: string | null;
  transcript_source: "whisper" | "subs" | "document" | null;
  visual_text: string | null;
  visual_text_source: "ocr" | null;
  upload_date: string | null;
  raw_metadata_keys: string[];
  source_links?: string[];
  extraction_methods?: string[];
  chapters?: Array<{
    title: string;
    start_time: number;
    end_time?: number | null;
  }>;
  top_comments?: Array<{
    author: string | null;
    text: string;
    like_count: number | null;
    timestamp?: number | string | null;
  }>;
  /** Pre-wrapped by extract_post.py when pipeline uses ai-memory llm-defense */
  caption_for_llm?: string | null;
  transcript_for_llm?: string | null;
  title_for_llm?: string | null;
  visual_text_for_llm?: string | null;
}

export class ExtractError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "ExtractError";
  }
}

function resolveScriptPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env["EXTRACT_SCRIPT_PATH"],
    // Dist runtime: /app/dist/src -> /app/scripts
    path.resolve(here, "../../scripts/run_pipeline.sh"),
    // TS runtime from source: /app/src -> /app/scripts
    path.resolve(here, "../scripts/run_pipeline.sh"),
    // Bundled path from process root.
    path.resolve(process.cwd(), "scripts/run_pipeline.sh"),
    // Fallback to ai-memory checkout paths.
    process.env["AI_MEMORY_LOCAL_DIR"]
      ? path.join(process.env["AI_MEMORY_LOCAL_DIR"], "tech-radar", "scripts", "run_pipeline.sh")
      : undefined,
    // Back-compat for older layout assumptions.
    path.resolve(here, "../../..", "ai-memory/tech-radar/scripts/run_pipeline.sh"),
    path.resolve(process.cwd(), "ai-memory/tech-radar/scripts/run_pipeline.sh"),
  ];

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }

  throw new ExtractError(
    `extract failed: run_pipeline.sh not found. Checked: ${candidates.filter(Boolean).join(", ")}`
  );
}

export function extract(url: string): Promise<ExtractResult> {
  const scriptPath = resolveScriptPath();

  return new Promise((resolve, reject) => {
    execFile("bash", [scriptPath, url], { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        return reject(new ExtractError(`extract failed: ${stderr || err.message}`, err));
      }
      try {
        const result = parseExtractJson(stdout) as ExtractResult;
        resolve(result);
      } catch (parseErr) {
        reject(
          new ExtractError(
            `extract failed: could not parse JSON output (${compactPreview(stdout)})`,
            parseErr
          )
        );
      }
    });
  });
}

function parseExtractJson(stdout: string): ExtractResult {
  try {
    return JSON.parse(stdout) as ExtractResult;
  } catch {
    const start = stdout.indexOf("{");
    const end = stdout.lastIndexOf("}");
    if (start >= 0 && end > start) {
      const maybeJson = stdout.slice(start, end + 1);
      return JSON.parse(maybeJson) as ExtractResult;
    }
    throw new Error("No JSON object found in extractor output");
  }
}

function compactPreview(value: string, max = 180): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (!clean) return "empty stdout";
  return clean.length > max ? `${clean.slice(0, max)}...` : clean;
}
