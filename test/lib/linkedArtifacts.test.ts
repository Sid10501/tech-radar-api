import { describe, expect, it } from "vitest";
import { buildWorkflowAuditBlock, classifyLinkedArtifacts } from "../../src/lib/linkedArtifacts.js";

describe("classifyLinkedArtifacts()", () => {
  it("classifies Kun workflow links into actionable artifact types", () => {
    const artifacts = classifyLinkedArtifacts([
      "https://github.com/kunchenguid/no-mistakes",
      "https://github.com/kunchenguid/lavish-axi",
      "https://github.com/kunchenguid/gnhf",
      "https://github.com/kunchenguid/treehouse",
      "https://github.com/kunchenguid/firstmate",
      "https://github.com/starmel/OpenSuperWhisper",
      "https://wezterm.org/index.html",
      "https://axi.md/",
      "https://linktr.ee/kunchenguid",
    ]);

    expect(artifacts).toEqual([
      {
        url: "https://github.com/kunchenguid/no-mistakes",
        type: "validation_gate",
        role: "pre-push validation gate",
      },
      {
        url: "https://github.com/kunchenguid/lavish-axi",
        type: "interactive_planning",
        role: "interactive planning artifact",
      },
      {
        url: "https://github.com/kunchenguid/gnhf",
        type: "long_running_agent",
        role: "long-running agent loop",
      },
      {
        url: "https://github.com/kunchenguid/treehouse",
        type: "worktree_orchestration",
        role: "parallel worktree management",
      },
      {
        url: "https://github.com/kunchenguid/firstmate",
        type: "agent_orchestration",
        role: "agent crew coordination",
      },
      {
        url: "https://github.com/starmel/OpenSuperWhisper",
        type: "voice_input",
        role: "voice input tool",
      },
      {
        url: "https://wezterm.org/index.html",
        type: "terminal_tool",
        role: "terminal cockpit",
      },
      {
        url: "https://axi.md/",
        type: "agent_interface",
        role: "agent-facing CLI/interface pattern",
      },
      {
        url: "https://linktr.ee/kunchenguid",
        type: "profile",
        role: "creator/profile link",
      },
    ]);
  });

  it("deduplicates links and classifies ordinary GitHub repos", () => {
    expect(classifyLinkedArtifacts([
      "https://github.com/colinhacks/zod",
      "https://github.com/colinhacks/zod",
    ])).toEqual([
      {
        url: "https://github.com/colinhacks/zod",
        type: "github_repo",
        role: "linked GitHub repository",
      },
    ]);
  });

  it("builds a workflow audit block for agent workflow artifacts", () => {
    const audit = buildWorkflowAuditBlock([
      {
        url: "https://github.com/kunchenguid/no-mistakes",
        type: "validation_gate",
        role: "pre-push validation gate",
      },
      {
        url: "https://github.com/kunchenguid/lavish-axi",
        type: "interactive_planning",
        role: "interactive planning artifact",
      },
      {
        url: "https://github.com/kunchenguid/gnhf",
        type: "long_running_agent",
        role: "long-running agent loop",
      },
    ]);

    expect(audit).toContain("Workflow type: agentic engineering workflow");
    expect(audit).toContain("Validation gates:");
    expect(audit).toContain("Planning artifacts:");
    expect(audit).toContain("Long-running loops:");
    expect(audit).toContain("Recommended intake:");
    expect(audit).toContain("Do not install the full stack by default");
  });
});
