import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AiMemoryRepo, withAiMemoryRepoMutation } from "../src/git.js";

import { parseFindingMarkdown } from "../src/findings.js";

let bareRepoDir: string;
let workDir: string;

beforeAll(() => {
  // Create a local bare repo to act as the "remote"
  bareRepoDir = fs.mkdtempSync(path.join(os.tmpdir(), "tech-radar-bare-"));
  execSync("git init --bare", { cwd: bareRepoDir });

  // Seed it with an initial commit so we have a main branch to push to
  const seedDir = fs.mkdtempSync(path.join(os.tmpdir(), "tech-radar-seed-"));
  execSync("git -c init.defaultBranch=master init", { cwd: seedDir });
  execSync('git config user.email "test@test.com"', { cwd: seedDir });
  execSync('git config user.name "Test"', { cwd: seedDir });
  fs.mkdirSync(path.join(seedDir, "tech-radar", "findings"), { recursive: true });
  fs.writeFileSync(path.join(seedDir, "tech-radar", "INBOX.md"), "| URL | Status |\n|---|---|\n");
  fs.writeFileSync(path.join(seedDir, "tech-radar", "INDEX.md"), "| Date | Title | Finding |\n|---|---|---|\n");
  execSync("git add -A", { cwd: seedDir });
  execSync('git commit -m "init"', { cwd: seedDir });
  execSync(`git remote add origin ${bareRepoDir}`, { cwd: seedDir });
  execSync("git push -u origin master", { cwd: seedDir });
  fs.rmSync(seedDir, { recursive: true });

  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "tech-radar-work-"));
});

afterAll(() => {
  fs.rmSync(bareRepoDir, { recursive: true, force: true });
  fs.rmSync(workDir, { recursive: true, force: true });
});

describe("AiMemoryRepo", () => {
  it("clones and reads a local repo with production Git app variables and configured SSH key", async () => {
    const names = ["GIT_DEPLOY_KEY_B64", "GIT_APP_SETTING", "GIT_PAGER", "PAGER", "VISUAL", "EDITOR", "PREFIX", "SSH_ASKPASS"] as const;
    const previous = names.map((name) => process.env[name]);
    process.env.GIT_DEPLOY_KEY_B64 = "dummy-key-not-for-git";
    process.env.GIT_APP_SETTING = "dummy-app-value";
    for (const name of names.slice(2)) delete process.env[name];
    process.env.PAGER = "dummy-pager";
    process.env.VISUAL = "dummy-editor";
    try {
      const localDir = path.join(workDir, "production-env-clone");
      const underTest = new AiMemoryRepo({
        remoteUrl: bareRepoDir,
        localDir,
        gitAuthor: { name: "Test Bot", email: "bot@test.com" },
        sshKeyPath: path.join(workDir, "unused-test-key"),
      });
      await underTest.init();
      await underTest.pullLatest();
      expect(fs.existsSync(path.join(localDir, "tech-radar", "INBOX.md"))).toBe(true);
    } finally {
      names.forEach((name, index) => { if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index]; });
    }
  });
  it("serializes checkout mutations through one shared async queue", async () => {
    const events: string[] = [];
    let release!: () => void;
    const first = withAiMemoryRepoMutation(async () => {
      events.push("first:start");
      await new Promise<void>((resolve) => { release = resolve; });
      events.push("first:end");
    });
    await vi.waitFor(() => expect(events).toEqual(["first:start"]));
    const second = withAiMemoryRepoMutation(async () => { events.push("second"); });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(events).toEqual(["first:start"]);
    release();
    await Promise.all([first, second]);
    expect(events).toEqual(["first:start", "first:end", "second"]);
  });
  let repo: AiMemoryRepo;

  it("clones the bare repo on init()", async () => {
    repo = new AiMemoryRepo({
      remoteUrl: bareRepoDir,
      localDir: path.join(workDir, "clone"),
      gitAuthor: { name: "Test Bot", email: "bot@test.com" },
    });
    await repo.init();
    expect(fs.existsSync(path.join(workDir, "clone", "tech-radar", "INBOX.md"))).toBe(true);
  });

  it("links findings relative to the index and keeps titles in one table cell", async () => {
    const index = path.join(workDir, "clone", "tech-radar", "INDEX.md");
    fs.appendFileSync(index, "<!-- new rows inserted above this line -->\n");
    await repo.updateIndex({ date: "2026-11-26", title: "A | B\n$&", finding: "sample.md", targetProject: "Radar | Lab" });
    const body = fs.readFileSync(index, "utf8");
    expect(body).toContain("| 2026-11-26 | A &#124; B $& | [sample.md](findings/sample.md) | Radar &#124; Lab |");
    expect(body.match(/<!-- new rows inserted/g)).toHaveLength(1);
  });

  it("writes a finding file and commits + pushes", async () => {
    await repo.writeFinding("2026-04-28-test-tool.md", "# Test Tool\n\nContent here.\n");
    await repo.commitAndPush("tech-radar: test-tool — 2026-04-28");

    // Verify the push landed in the bare repo by cloning it fresh
    const verifyDir = fs.mkdtempSync(path.join(os.tmpdir(), "tech-radar-verify-"));
    try {
      execSync(`git clone -b master ${bareRepoDir} .`, { cwd: verifyDir });
      const findingPath = path.join(verifyDir, "tech-radar", "findings", "2026-04-28-test-tool.md");
      expect(fs.existsSync(findingPath)).toBe(true);
      expect(fs.readFileSync(findingPath, "utf8")).toContain("# Test Tool");
    } finally {
      fs.rmSync(verifyDir, { recursive: true, force: true });
    }
  });

  it("rewrites the existing finding when a retry generates a new filename for the same source URL", async () => {
    const sourceUrl = "https://www.instagram.com/p/example/";
    await repo.pullLatest();
    await repo.writeFindingForSource({
      sourceUrl,
      filename: "2026-04-28-old-title.md",
      body: [
        "# Old Title",
        "",
        `**Source:** instagram · [Creator](${sourceUrl})`,
        "**Saved:** 20260428",
        "",
        "Old body.",
        "",
      ].join("\n"),
      date: "2026-04-28",
    });
    await repo.commitAndPush("tech-radar: old-title");

    await repo.pullLatest();
    const write = await repo.writeFindingForSource({
      sourceUrl,
      filename: "2026-07-06-new-title.md",
      body: [
        "# New Title",
        "",
        `**Source:** instagram · [Creator](${sourceUrl})`,
        "**Saved:** 20260706",
        "",
        "New body.",
        "",
      ].join("\n"),
      date: "2026-07-06",
    });
    await repo.commitAndPush("tech-radar: retry source");

    expect(write).toEqual({
      filename: "2026-04-28-old-title.md",
      generatedFilename: "2026-07-06-new-title.md",
      replacedExisting: true,
    });

    const verifyDir = fs.mkdtempSync(path.join(os.tmpdir(), "tech-radar-verify-source-"));
    try {
      execSync(`git clone -b master ${bareRepoDir} .`, { cwd: verifyDir });
      const findingsDir = path.join(verifyDir, "tech-radar", "findings");
      expect(fs.existsSync(path.join(findingsDir, "2026-04-28-old-title.md"))).toBe(true);
      expect(fs.existsSync(path.join(findingsDir, "2026-07-06-new-title.md"))).toBe(false);
      const content = fs.readFileSync(path.join(findingsDir, "2026-04-28-old-title.md"), "utf8");
      expect(content).toContain("# New Title");
      expect(content).toContain("Generated filename: `2026-07-06-new-title.md`");
    } finally {
      fs.rmSync(verifyDir, { recursive: true, force: true });
    }
  });

  it("records retry history when a retry rewrites the same generated filename for the same source URL", async () => {
    const sourceUrl = "https://www.instagram.com/p/same-title/";
    await repo.pullLatest();
    await repo.writeFindingForSource({
      sourceUrl,
      filename: "2026-07-06-same-title.md",
      body: [
        "# Same Title",
        "",
        `**Source:** instagram · [Creator](${sourceUrl})`,
        "**Saved:** 20260706",
        "",
        "Old body.",
        "",
      ].join("\n"),
      date: "2026-07-06",
    });
    await repo.commitAndPush("tech-radar: same-title");

    await repo.pullLatest();
    const write = await repo.writeFindingForSource({
      sourceUrl,
      filename: "2026-07-06-same-title.md",
      body: [
        "# Same Title",
        "",
        `**Source:** instagram · [Creator](${sourceUrl})`,
        "**Saved:** 20260706",
        "",
        "New body.",
        "",
      ].join("\n"),
      date: "2026-07-06",
    });

    expect(write).toEqual({
      filename: "2026-07-06-same-title.md",
      generatedFilename: "2026-07-06-same-title.md",
      replacedExisting: true,
    });
    const content = fs.readFileSync(path.join(workDir, "clone", "tech-radar", "findings", "2026-07-06-same-title.md"), "utf8");
    expect(content).toContain("New body.");
    expect(content).toContain("## Retry history");
    expect(content).toContain("Previous filename: `2026-07-06-same-title.md`");
    expect(parseFindingMarkdown(write.filename, content).retry?.previousCoverage).toBeUndefined();
  });

  it("rewrites Instagram carousel retries that vary only by query params", async () => {
    const originalSourceUrl = "https://www.instagram.com/p/DZxFPZjjnTN/?img_index=2&igsh=MXdxMzYwMTU3aHU5MA==";
    await repo.pullLatest();
    await repo.writeFindingForSource({
      sourceUrl: originalSourceUrl,
      filename: "2026-06-19-palmier-carousel.md",
      body: [
        "# Palmier carousel",
        "",
        `**Source:** instagram · [Palmier](${originalSourceUrl})`,
        "**Saved:** 20260619",
        "",
        "## Source coverage", "", "OCR returned text for 2 of 4 listed media items.",
        "",
      ].join("\n"),
      date: "2026-06-19",
    });
    await repo.commitAndPush("tech-radar: palmier-carousel");

    await repo.pullLatest();
    const write = await repo.writeFindingForSource({
      sourceUrl: "https://instagram.com/p/DZxFPZjjnTN/?utm_source=ig_web_copy_link",
      filename: "2026-07-06-palmier-pro.md",
      body: [
        "# Palmier Pro",
        "",
        "**Source:** instagram · [Palmier](https://instagram.com/p/DZxFPZjjnTN/?utm_source=ig_web_copy_link)",
        "**Saved:** 20260706",
        "",
        "## Source coverage", "", "OCR returned text for 3 of 4 listed media items.",
        "",
      ].join("\n"),
      date: "2026-07-06",
    });

    expect(write).toEqual({
      filename: "2026-06-19-palmier-carousel.md",
      generatedFilename: "2026-07-06-palmier-pro.md",
      replacedExisting: true,
    });
    const content = fs.readFileSync(path.join(workDir, "clone", "tech-radar", "findings", "2026-06-19-palmier-carousel.md"), "utf8");
    expect(parseFindingMarkdown(write.filename, content)).toMatchObject({ captureCoverage: { withText: 3, listed: 4 }, retry: { previousCoverage: { withText: 2, listed: 4 } } });
    expect(content).toContain("# Palmier Pro");
    expect(content).toContain("Generated filename: `2026-07-06-palmier-pro.md`");
  });

  it("reuses one finding across legacy Shorts, watch and share URLs while preserving distinct video IDs", async () => {
    const save = (sourceUrl: string, filename: string) => repo.writeFindingForSource({
      sourceUrl, filename, date: "2026-07-06", body: `# Saved video\n\n**Source:** youtube · [Creator](${sourceUrl})\n`,
    });
    await repo.pullLatest();
    const original = "2026-07-06-first-video.md";
    await save("https://www.youtube.com/shorts/dQw4w9WgXcQ", original);
    for (const url of ["https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=20", "https://youtu.be/dQw4w9WgXcQ?si=shared"]) {
      expect(await save(url, "renamed-video.md")).toMatchObject({ filename: original, replacedExisting: true });
    }
    expect(await save("https://www.youtube.com/watch?v=dQw4w9WgXcq", "different-video.md"))
      .toMatchObject({ filename: "different-video.md", replacedExisting: false });
  });

  it("retains the canonical finding across regressions in manifest, counts or captured ordinals", async () => {
    const sourceUrl = "https://www.instagram.com/p/keep-reviewed/";
    const filename = "2026-07-06-keep-reviewed.md";
    const header = "# Canonical\n\n**Source:** instagram · [Creator](" + sourceUrl + ")\n\n";
    const section = "## Source coverage\n\n";
    const previous = header + section + "OCR returned text for 2 of 3 listed media items.\n" +
      "- [Slide 1](https://example.com/1) · Hand-reviewed cover\n- Slide 2 · ocr: Previous text\n- Slide 3 · no text: No text captured\n";
    await repo.pullLatest();
    await repo.writeFindingForSource({ sourceUrl, filename, body: previous, date: "2026-07-06" });
    for (const regressed of ["", section + "Slide coverage unknown.", section + "OCR returned text for 1 of 3 listed media items.",
      section + "OCR returned text for 2 of 2 listed media items.",
      section + "OCR returned text for 2 of 3 listed media items.\n- Slide 1 · ocr: Cover\n- Slide 2 · ocr unavailable: No text captured\n- Slide 3 · ocr: Newly recovered"]) {
      const write = await repo.writeFindingForSource({ sourceUrl, filename: "retry.md", body: header + regressed, date: "2026-07-07" });
      expect(write).toMatchObject({ filename, replacedExisting: false, preservedCoverage: true });
      expect(fs.readFileSync(path.join(workDir, "clone", "tech-radar", "findings", filename), "utf8")).toBe(previous);
      expect(fs.existsSync(path.join(workDir, "clone", "tech-radar", "findings", "retry.md"))).toBe(false);
    }
  });

  it("does not rewrite a finding that only mentions the same social URL outside Source", async () => {
    const mentionedUrl = "https://www.instagram.com/p/not-the-source/?img_index=2";
    await repo.pullLatest();
    await repo.writeFindingForSource({
      sourceUrl: "https://www.instagram.com/p/actual-source/",
      filename: "2026-06-19-actual-source.md",
      body: [
        "# Actual source",
        "",
        "**Source:** instagram · [Creator](https://www.instagram.com/p/actual-source/)",
        "**Saved:** 20260619",
        "",
        "## Links",
        "",
        `- Related post: ${mentionedUrl}`,
        "",
      ].join("\n"),
      date: "2026-06-19",
    });
    await repo.commitAndPush("tech-radar: actual-source");

    await repo.pullLatest();
    const write = await repo.writeFindingForSource({
      sourceUrl: mentionedUrl,
      filename: "2026-07-06-new-source.md",
      body: [
        "# New source",
        "",
        `**Source:** instagram · [Creator](${mentionedUrl})`,
        "**Saved:** 20260706",
        "",
        "New body.",
        "",
      ].join("\n"),
      date: "2026-07-06",
    });

    expect(write).toEqual({
      filename: "2026-07-06-new-source.md",
      generatedFilename: "2026-07-06-new-source.md",
      replacedExisting: false,
    });
  });

  it("rejects generated finding filenames that would escape the findings directory", async () => {
    await repo.pullLatest();

    await expect(
      repo.writeFindingForSource({
        sourceUrl: "https://example.com/path-traversal",
        filename: "../../INBOX-safe-title.md",
        body: "# Safe Title\n\nContent.\n",
        date: "2026-07-18",
      }),
    ).rejects.toThrow("invalid finding filename");

    expect(fs.existsSync(path.join(workDir, "clone", "INBOX-safe-title.md"))).toBe(false);
  });

  it("updates INBOX.md with a new row", async () => {
    await repo.pullLatest();
    await repo.updateInbox({
      url: "https://example.com/video",
      status: "processed",
      finding: "2026-04-28-test-tool.md",
      date: "2026-04-28",
    });
    await repo.commitAndPush("tech-radar: inbox update");

    const verifyDir = fs.mkdtempSync(path.join(os.tmpdir(), "tech-radar-verify2-"));
    try {
      execSync(`git clone -b master ${bareRepoDir} .`, { cwd: verifyDir });
      const inbox = fs.readFileSync(path.join(verifyDir, "tech-radar", "INBOX.md"), "utf8");
      expect(inbox).toContain("https://example.com/video");
      expect(inbox).toContain("processed");
    } finally {
      fs.rmSync(verifyDir, { recursive: true, force: true });
    }
  });

  it("adds pending inbox rows only when the URL is missing", async () => {
    await repo.pullLatest();
    const first = await repo.updateInboxIfMissing({
      url: "https://github.com/kunchenguid/no-mistakes",
      status: "pending",
      finding: null,
      date: "2026-07-05",
      error: "child of parent.md: validation_gate",
    });
    const second = await repo.updateInboxIfMissing({
      url: "https://github.com/kunchenguid/no-mistakes",
      status: "pending",
      finding: null,
      date: "2026-07-05",
      error: "child of parent.md: validation_gate",
    });

    expect(first).toBe(true);
    expect(second).toBe(false);

    const inbox = fs.readFileSync(path.join(workDir, "clone", "tech-radar", "INBOX.md"), "utf8");
    expect(inbox.match(/https:\/\/github\.com\/kunchenguid\/no-mistakes/g)).toHaveLength(1);
  });
});
