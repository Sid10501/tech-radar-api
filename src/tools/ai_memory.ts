import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const WHITELISTED_PREFIXES = ["GLOBAL_MEMORY.md", "domains/", "sessions/"];

export function defaultMemoryDir(): string {
  // In production, AI_MEMORY_LOCAL_DIR env var points to the cloned ai-memory repo
  return (
    process.env["AI_MEMORY_LOCAL_DIR"] ??
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), import.meta.url.includes("/dist/src/tools/") ? "../../../../AI Memory" : "../../../AI Memory")
  );
}

export async function readAiMemory(
  filePath: string,
  memoryDir: string = defaultMemoryDir()
): Promise<string> {
  // Prevent path traversal
  if (filePath.replace(/\\/g, "/").split("/").includes("..")) throw new Error("readAiMemory: traversal is not allowed");
  const normalized = path.normalize(filePath).replace(/\\/g, "/");
  const allowed = WHITELISTED_PREFIXES.some(
    (p) => normalized === p || (p.endsWith("/") && normalized.startsWith(p))
  );
  if (!allowed || normalized.includes("..")) {
    throw new Error(`readAiMemory: path not allowed: ${filePath}`);
  }

  return readBoundedMemoryFile(memoryDir, normalized, 48000);
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
    .slice(0, Number.isFinite(n) ? Math.max(0, Math.min(10, Math.floor(n))) : 5);
}

/** Realpath containment plus O_NOFOLLOW prevents symlink reads outside the memory checkout. */
export async function readBoundedMemoryFile(memoryDir: string, relative: string, maxBytes: number): Promise<string> {
  const root = await fs.promises.realpath(memoryDir);
  const target = path.resolve(root, relative);
  const resolved = await fs.promises.realpath(target);
  if (!resolved.startsWith(root + path.sep) || resolved !== target) throw new Error('Memory path is not a regular contained file');
  const handle = await fs.promises.open(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxBytes) throw new Error('Memory file exceeds size limit');
    const buffer = Buffer.alloc(maxBytes + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > maxBytes) throw new Error('Memory file exceeds size limit');
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally { await handle.close(); }
}

const ProjectManifestSchema = z.object({
  schemaVersion: z.literal(1), project: z.string().min(1).max(80), checkedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(day => {
    const timestamp = Date.parse(`${day}T00:00:00Z`);
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === day && timestamp <= Date.now();
  }, 'Inspection date must be a real calendar date, not in the future'),
  sources: z.array(z.string().max(200)).max(12), stack: z.record(z.string().max(100)), notes: z.array(z.string().max(400)).max(12),
}).strict();
const MANIFEST_FILES = ['portfolio.json', 'tech-radar-api.json', 'stockbot.json'];
type ProjectSnapshot = z.infer<typeof ProjectManifestSchema> & { snapshot_age_days: number };
export async function readProjectManifests(memoryDir = defaultMemoryDir()): Promise<ProjectSnapshot[]> {
  const manifests: ProjectSnapshot[] = [];
  for (const file of MANIFEST_FILES) {
    try {
      const snapshot = ProjectManifestSchema.parse(JSON.parse(await readBoundedMemoryFile(memoryDir, `projects/${file}`, 16000)));
      manifests.push({ ...snapshot, snapshot_age_days: Math.floor((Date.now() - Date.parse(`${snapshot.checkedAt}T00:00:00Z`)) / 86400000) });
    }
    catch { /* Missing, invalid, or unsafe snapshots stay unavailable. */ }
  }
  return manifests;
}
