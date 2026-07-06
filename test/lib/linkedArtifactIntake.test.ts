import { describe, expect, it } from "vitest";
import { childArtifactInboxRows, selectChildArtifactsForIntake } from "../../src/lib/linkedArtifactIntake.js";
import type { ExtractResult } from "../../src/extract.js";

const baseExtract: ExtractResult = {
  url: "https://www.youtube.com/watch?v=iQyg-KypKAA",
  platform: "youtube",
  status: "ok",
  error: null,
  title: "L8 Principal's Agentic Engineering Workflow",
  creator: "Kun Chen",
  caption: null,
  hashtags: [],
  duration_sec: null,
  transcript: "workflow",
  transcript_source: "subs",
  visual_text: null,
  visual_text_source: null,
  upload_date: "2026-06-20",
  raw_metadata_keys: [],
  linked_artifacts: [
    {
      url: "https://linktr.ee/kunchenguid",
      type: "profile",
      role: "creator/profile link",
    },
    {
      url: "https://github.com/kunchenguid/no-mistakes",
      type: "validation_gate",
      role: "pre-push validation gate",
    },
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
  ],
};

describe("linked artifact intake", () => {
  it("selects actionable artifacts and excludes profile/reference links", () => {
    expect(selectChildArtifactsForIntake(baseExtract).map((artifact) => artifact.url)).toEqual([
      "https://github.com/kunchenguid/no-mistakes",
      "https://github.com/kunchenguid/lavish-axi",
    ]);
  });

  it("builds pending inbox rows with parent context in the note", () => {
    expect(childArtifactInboxRows(baseExtract, {
      date: "2026-07-05",
      parentFinding: "2026-07-05-kun-workflow.md",
    })).toEqual([
      {
        url: "https://github.com/kunchenguid/no-mistakes",
        status: "pending",
        finding: null,
        date: "2026-07-05",
        error: "child of 2026-07-05-kun-workflow.md: validation_gate",
      },
      {
        url: "https://github.com/kunchenguid/lavish-axi",
        status: "pending",
        finding: null,
        date: "2026-07-05",
        error: "child of 2026-07-05-kun-workflow.md: interactive_planning",
      },
    ]);
  });
});
