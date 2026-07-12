import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { listReleaseNotes, parseReleaseNotesMarkdown } from "../src/releaseNotes.js";

describe("parseReleaseNotesMarkdown()", () => {
  it("parses release notes newest first with stable ids and highlights", () => {
    const releases = parseReleaseNotesMarkdown([
      "# Release Notes",
      "",
      "## 2026-07-04 - Older Pipeline Pass",
      "",
      "Stabilized the previous pass.",
      "",
      "- Added focused verification.",
      "",
      "## 2026-07-05 - Product Loop",
      "",
      "Made improvements visible in the product.",
      "",
      "- Added public release notes endpoint.",
      "- Added dashboard visibility.",
    ].join("\n"));

    expect(releases).toEqual([
      {
        id: "2026-07-05-product-loop",
        date: "2026-07-05",
        title: "Product Loop",
        summary: "Made improvements visible in the product.",
        bodyMarkdown: "Made improvements visible in the product.\n\n- Added public release notes endpoint.\n- Added dashboard visibility.",
        highlights: ["Added public release notes endpoint.", "Added dashboard visibility."],
      },
      {
        id: "2026-07-04-older-pipeline-pass",
        date: "2026-07-04",
        title: "Older Pipeline Pass",
        summary: "Stabilized the previous pass.",
        bodyMarkdown: "Stabilized the previous pass.\n\n- Added focused verification.",
        highlights: ["Added focused verification."],
      },
    ]);
  });
});

describe("listReleaseNotes()", () => {
  it("keeps workflow map notes latest with relationship highlights", () => {
    const releases = listReleaseNotes();

    expect(releases[0]).toMatchObject({
      date: "2026-07-11",
      title: "Workflow Maps",
    });
    expect(releases[0]?.highlights).toEqual(expect.arrayContaining([
      expect.stringContaining("parent-child workflow metadata"),
      expect.stringContaining("workflow map cards"),
      expect.stringContaining("Kun workflow"),
    ]));
  });

  it("returns an empty list when release notes have not been created", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "missing-release-notes-"));

    expect(listReleaseNotes(path.join(dir, "release-notes.md"))).toEqual([]);
  });
});
