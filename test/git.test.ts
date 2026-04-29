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
  execSync("git init", { cwd: seedDir });
  execSync('git config user.email "test@test.com"', { cwd: seedDir });
  execSync('git config user.name "Test"', { cwd: seedDir });
  fs.mkdirSync(path.join(seedDir, "tech-radar", "findings"), { recursive: true });
  fs.writeFileSync(path.join(seedDir, "tech-radar", "INBOX.md"), "| URL | Status |\n|---|---|\n");
  fs.writeFileSync(path.join(seedDir, "tech-radar", "INDEX.md"), "| Date | Title | Finding |\n|---|---|---|\n");
  execSync("git add -A", { cwd: seedDir });
  execSync('git commit -m "init"', { cwd: seedDir });
  execSync(`git remote add origin ${bareRepoDir}`, { cwd: seedDir });
  execSync("git push -u origin HEAD:main", { cwd: seedDir });
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
      execSync(`git clone ${bareRepoDir} .`, { cwd: verifyDir });
      const findingPath = path.join(verifyDir, "tech-radar", "findings", "2026-04-28-test-tool.md");
      expect(fs.existsSync(findingPath)).toBe(true);
      expect(fs.readFileSync(findingPath, "utf8")).toContain("# Test Tool");
    } finally {
      fs.rmSync(verifyDir, { recursive: true, force: true });
    }
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
      execSync(`git clone ${bareRepoDir} .`, { cwd: verifyDir });
      const inbox = fs.readFileSync(path.join(verifyDir, "tech-radar", "INBOX.md"), "utf8");
      expect(inbox).toContain("https://example.com/video");
      expect(inbox).toContain("processed");
    } finally {
      fs.rmSync(verifyDir, { recursive: true, force: true });
    }
  });
});
