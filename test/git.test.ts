import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AiMemoryRepo } from "../src/git.js";

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
        "Old body.",
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
        "New body.",
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
    expect(content).toContain("# Palmier Pro");
    expect(content).toContain("Generated filename: `2026-07-06-palmier-pro.md`");
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
