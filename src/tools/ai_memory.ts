import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WHITELISTED_PREFIXES = ["GLOBAL_MEMORY.md", "domains/", "sessions/"];

function defaultMemoryDir(): string {
  // In production, AI_MEMORY_LOCAL_DIR env var points to the cloned ai-memory repo
  return (
    process.env["AI_MEMORY_LOCAL_DIR"] ??
    path.resolve(fileURLToPath(import.meta.url), "../../../../ai-memory")
  );
}

export async function readAiMemory(
  filePath: string,
  memoryDir: string = defaultMemoryDir()
): Promise<string> {
  // Prevent path traversal
  const normalized = path.normalize(filePath).replace(/\\/g, "/");
  const allowed = WHITELISTED_PREFIXES.some(
    (p) => normalized === p || normalized.startsWith(p)
  );
  if (!allowed || normalized.includes("..")) {
    throw new Error(`readAiMemory: path not allowed: ${filePath}`);
  }

  const fullPath = path.join(memoryDir, normalized);
  return fs.promises.readFile(fullPath, "utf8");
}

export async function listRecentSessions(
  n: number = 5,
  memoryDir: string = defaultMemoryDir()
): Promise<string[]> {
  const sessionsDir = path.join(memoryDir, "sessions");
  const entries = await fs.promises.readdir(sessionsDir);
  return entries
    .filter((f) => f.endsWith(".md"))
    .sort()
    .reverse()
    .slice(0, n);
}
