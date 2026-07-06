import fs from "node:fs";
import path from "node:path";

export interface AppliedEntry {
  appliedAt: string;
  link: string;
  note?: string;
}

export type AppliedMap = Record<string, AppliedEntry>;

export function getAppliedMapPath(aiMemoryDir: string): string {
  return path.join(aiMemoryDir, "tech-radar", "applied.json");
}

export function loadAppliedMap(aiMemoryDir: string): AppliedMap {
  const filePath = getAppliedMapPath(aiMemoryDir);
  if (!fs.existsSync(filePath)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    console.warn(`[warn] ignoring invalid applied mapping at ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    console.warn(`[warn] ignoring applied mapping at ${filePath}: expected a JSON object keyed by finding filename`);
    return {};
  }
  const map: AppliedMap = {};
  for (const [filename, value] of Object.entries(parsed)) {
    const entry = toAppliedEntry(value);
    if (entry) map[filename] = entry;
  }
  return map;
}

function toAppliedEntry(value: unknown): AppliedEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { appliedAt, link, note } = value as Record<string, unknown>;
  if (typeof appliedAt !== "string" || !appliedAt || typeof link !== "string" || !link) return null;
  return { appliedAt, link, ...(typeof note === "string" && note ? { note } : {}) };
}
