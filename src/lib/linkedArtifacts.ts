import type { ExtractResult, LinkedArtifact } from "../extract.js";

const KNOWN_ARTIFACTS: Record<string, Pick<LinkedArtifact, "type" | "role">> = {
  "github.com/kunchenguid/no-mistakes": {
    type: "validation_gate",
    role: "pre-push validation gate",
  },
  "github.com/kunchenguid/lavish-axi": {
    type: "interactive_planning",
    role: "interactive planning artifact",
  },
  "github.com/kunchenguid/gnhf": {
    type: "long_running_agent",
    role: "long-running agent loop",
  },
  "github.com/kunchenguid/treehouse": {
    type: "worktree_orchestration",
    role: "parallel worktree management",
  },
  "github.com/kunchenguid/firstmate": {
    type: "agent_orchestration",
    role: "agent crew coordination",
  },
  "github.com/vercel-labs/skills": {
    type: "skill",
    role: "agent skill system",
  },
  "github.com/starmel/opensuperwhisper": {
    type: "voice_input",
    role: "voice input tool",
  },
};

export function linkedArtifactsForExtract(extract: ExtractResult): LinkedArtifact[] {
  if ((extract.linked_artifacts ?? []).length > 0) return extract.linked_artifacts!;
  return classifyLinkedArtifacts(extract.source_links ?? []);
}

export function buildWorkflowAuditBlock(artifacts: LinkedArtifact[]): string {
  if (!hasWorkflowArtifacts(artifacts)) return "";
  const lines = [
    "Workflow type: agentic engineering workflow",
    "",
    "Recommended intake:",
    "- Treat this as a workflow/harness input, not just a tool recommendation.",
    "- Map stable rules to memory, reusable instructions to skills, and risky automation to explicit validation gates.",
    "- Do not install the full stack by default; pilot the smallest artifact that improves the current harness.",
  ];

  const validation = artifacts.filter((artifact) => artifact.type === "validation_gate");
  const planning = artifacts.filter((artifact) => artifact.type === "interactive_planning");
  const loops = artifacts.filter((artifact) => artifact.type === "long_running_agent");
  const orchestration = artifacts.filter((artifact) => artifact.type === "worktree_orchestration" || artifact.type === "agent_orchestration");
  const ergonomics = artifacts.filter((artifact) => artifact.type === "terminal_tool" || artifact.type === "voice_input" || artifact.type === "agent_interface" || artifact.type === "skill");

  appendGroup(lines, "Validation gates", validation);
  appendGroup(lines, "Planning artifacts", planning);
  appendGroup(lines, "Long-running loops", loops);
  appendGroup(lines, "Orchestration candidates", orchestration);
  appendGroup(lines, "Ergonomics and interface tools", ergonomics);

  return lines.join("\n");
}

export function classifyLinkedArtifacts(links: string[]): LinkedArtifact[] {
  const out: LinkedArtifact[] = [];
  const seen = new Set<string>();
  for (const raw of links) {
    const url = raw.trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(classifyLinkedArtifact(url));
  }
  return out;
}

function hasWorkflowArtifacts(artifacts: LinkedArtifact[]): boolean {
  return artifacts.some((artifact) => [
    "validation_gate",
    "interactive_planning",
    "long_running_agent",
    "worktree_orchestration",
    "agent_orchestration",
    "voice_input",
    "agent_interface",
    "skill",
  ].includes(artifact.type));
}

function appendGroup(lines: string[], label: string, artifacts: LinkedArtifact[]): void {
  if (artifacts.length === 0) return;
  lines.push("", `${label}:`);
  for (const artifact of artifacts) {
    lines.push(`- ${artifact.role}: ${artifact.url}`);
  }
}

function classifyLinkedArtifact(url: string): LinkedArtifact {
  const normalized = normalizeUrlForMatch(url);
  const known = KNOWN_ARTIFACTS[normalized];
  if (known) return { url, ...known };
  if (normalized.startsWith("github.com/")) {
    return { url, type: "github_repo", role: "linked GitHub repository" };
  }
  if (normalized === "wezterm.org/index.html" || normalized === "wezterm.org") {
    return { url, type: "terminal_tool", role: "terminal cockpit" };
  }
  if (normalized === "axi.md") {
    return { url, type: "agent_interface", role: "agent-facing CLI/interface pattern" };
  }
  if (normalized.startsWith("linktr.ee/")) {
    return { url, type: "profile", role: "creator/profile link" };
  }
  if (normalized.endsWith(".dev") || normalized.includes(".dev/") || normalized.endsWith(".io") || normalized.includes(".io/")) {
    return { url, type: "docs", role: "documentation site" };
  }
  return { url, type: "reference", role: "source reference" };
}

function normalizeUrlForMatch(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`.toLowerCase().replace(/\/$/, "");
  } catch {
    return url.toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
  }
}
