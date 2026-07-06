import type { ExtractResult, LinkedArtifact } from "../extract.js";
import type { InboxRow } from "../git.js";
import { linkedArtifactsForExtract } from "./linkedArtifacts.js";

const EXCLUDED_CHILD_TYPES = new Set<LinkedArtifact["type"]>(["profile", "reference"]);

export function selectChildArtifactsForIntake(extract: ExtractResult): LinkedArtifact[] {
  const out: LinkedArtifact[] = [];
  const seen = new Set<string>([extract.url]);
  for (const artifact of linkedArtifactsForExtract(extract)) {
    if (seen.has(artifact.url) || EXCLUDED_CHILD_TYPES.has(artifact.type)) continue;
    seen.add(artifact.url);
    out.push(artifact);
  }
  return out;
}

export function childArtifactInboxRows(
  extract: ExtractResult,
  input: { date: string; parentFinding: string },
): InboxRow[] {
  return selectChildArtifactsForIntake(extract).map((artifact) => ({
    url: artifact.url,
    status: "pending",
    finding: null,
    date: input.date,
    error: `child of ${input.parentFinding}: ${artifact.type}`,
  }));
}
