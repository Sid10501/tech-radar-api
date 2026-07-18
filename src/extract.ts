import { execFile } from "node:child_process";
import { lookup } from "node:dns/promises";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

export type LinkedArtifactType =
  | "github_repo"
  | "docs"
  | "skill"
  | "voice_input"
  | "terminal_tool"
  | "agent_interface"
  | "interactive_planning"
  | "validation_gate"
  | "long_running_agent"
  | "worktree_orchestration"
  | "agent_orchestration"
  | "profile"
  | "reference";

export interface LinkedArtifact {
  url: string;
  type: LinkedArtifactType;
  role: string;
}

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
  visual_text_source: "ocr" | "browser_ocr" | "vision_ocr" | null;
  upload_date: string | null;
  raw_metadata_keys: string[];
  media_assets?: ExtractedMediaAsset[];
  extraction_warnings?: string[];
  enriched_links?: EnrichedLinks | null;
  source_links?: string[];
  linked_artifacts?: LinkedArtifact[];
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

export interface ExtractedMediaAsset {
  type: "image" | "video" | "screenshot" | "thumbnail";
  source: string;
  path?: string | null;
  url?: string | null;
  ocr_text?: string | null;
  confidence?: "high" | "medium" | "low";
}

export interface EnrichedLinkCandidate {
  kind: "github" | "docs" | "npm";
  url: string;
  source: "caption" | "transcript" | "visual_text" | "title" | "source_url";
  confidence: "confirmed" | "candidate";
  requires_github?: string;
  discovered_by?: "explicit" | "curated" | "github_search";
  search_query?: string;
}

export interface EnrichedLinks {
  confirmed: {
    github: string | null;
    docs: string | null;
    npm: string | null;
  };
  candidates: EnrichedLinkCandidate[];
  warnings: string[];
  github?: {
    stars: number;
    lastPushed: string;
    openIssues: number;
    language: string | null;
    license: string | null;
    archived: boolean;
  } | null;
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

export async function extract(url: string): Promise<ExtractResult> {
  if (!(await isAllowedSubmittedUrl(url))) {
    throw new ExtractError(`blocked submitted URL: ${url}`);
  }
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

async function isAllowedSubmittedUrl(rawUrl: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  return isAllowedHostname(parsed.hostname);
}

async function isAllowedHostname(hostname: string): Promise<boolean> {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost")) return false;
  const ipVersion = net.isIP(host);
  if (!ipVersion) {
    try {
      const addresses = await lookup(host, { all: true, verbatim: false });
      return addresses.length > 0 && addresses.every((entry) => {
        if (entry.family === 4) return isAllowedIpv4(entry.address);
        if (entry.family === 6) return isAllowedIpv6(entry.address.toLowerCase());
        return false;
      });
    } catch {
      return false;
    }
  }
  if (ipVersion === 4) return isAllowedIpv4(host);
  return isAllowedIpv6(host);
}

function isAllowedIpv4(host: string): boolean {
  const parts = host.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 0) return false;
  if (a === 192 && b === 168) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && parts[2] === 100) return false;
  if (a === 203 && b === 0 && parts[2] === 113) return false;
  if (a >= 224) return false;
  return true;
}

function isAllowedIpv6(host: string): boolean {
  const dottedMappedIpv4 = host.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (dottedMappedIpv4) return isAllowedIpv4(dottedMappedIpv4[1]);
  const hexMappedIpv4 = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (hexMappedIpv4) {
    const high = Number.parseInt(hexMappedIpv4[1], 16);
    const low = Number.parseInt(hexMappedIpv4[2], 16);
    if (!Number.isFinite(high) || !Number.isFinite(low)) return false;
    return isAllowedIpv4(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
  }
  if (host === "::1" || host === "::") return false;
  if (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80") || host.startsWith("ff")) return false;
  if (host.toLowerCase().startsWith("2001:db8")) return false;
  return true;
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
