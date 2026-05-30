import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("hydrateRunsFromInbox()", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hydrate-test-"));
  });

  it("populates listRuns() from a well-formed INBOX.md", async () => {
    const { hydrateRunsFromInbox, listRuns } = await import("../src/runner.js");

    const inboxContent = `# Tech Radar Inbox

| Date | URL | Status | Finding | Error |
|------|-----|--------|---------|-------|
| 2026-05-04 | https://www.instagram.com/reel/abc | processed | 2026-05-04-some-tool.md |  |
| 2026-05-05 | https://www.tiktok.com/@foo/video/1 | failed |  | extract failed |
| 2026-05-06 | https://www.instagram.com/reel/dm-gated | skipped |  | no caption or transcript |
<!-- new rows inserted above this line -->
`;
    const inboxPath = path.join(tmpDir, "INBOX.md");
    fs.writeFileSync(inboxPath, inboxContent, "utf8");

    hydrateRunsFromInbox(inboxPath);

    const runs = listRuns();
    const urls = runs.map((r) => r.url);
    expect(urls).toContain("https://www.instagram.com/reel/abc");
    expect(urls).toContain("https://www.tiktok.com/@foo/video/1");

    const processed = runs.find((r) => r.url === "https://www.instagram.com/reel/abc");
    expect(processed?.status).toBe("processed");
    expect(processed?.findingPath).toContain("2026-05-04-some-tool.md");

    const failed = runs.find((r) => r.url === "https://www.tiktok.com/@foo/video/1");
    expect(failed?.status).toBe("failed");
    expect(failed?.error).toBe("extract failed");

    const skipped = runs.find((r) => r.url === "https://www.instagram.com/reel/dm-gated");
    expect(skipped?.status).toBe("skipped");
    expect(skipped?.error).toBe("no caption or transcript");
  });

  it("hydrates skipped status from INBOX.md", async () => {
    const { hydrateRunsFromInbox, listRuns } = await import("../src/runner.js");

    const inboxContent = `# Tech Radar Inbox

| Date | URL | Status | Finding | Error |
|------|-----|--------|---------|-------|
| 2026-05-06 | https://www.instagram.com/reel/dm-gated | skipped |  | no caption or transcript |
<!-- new rows inserted above this line -->
`;
    const inboxPath = path.join(tmpDir, "INBOX.md");
    fs.writeFileSync(inboxPath, inboxContent, "utf8");

    hydrateRunsFromInbox(inboxPath);

    const runs = listRuns();
    const skipped = runs.find((r) => r.url === "https://www.instagram.com/reel/dm-gated");
    expect(skipped?.status).toBe("skipped");
    expect(skipped?.error).toBe("no caption or transcript");
  });

  it("does not remap skipped status to processed", async () => {
    const { hydrateRunsFromInbox, listRuns } = await import("../src/runner.js");

    const inboxContent = `# Tech Radar Inbox

| Date | URL | Status | Finding | Error |
|------|-----|--------|---------|-------|
| 2026-05-07 | https://www.instagram.com/reel/junk-post | skipped |  | extract failed |
<!-- new rows inserted above this line -->
`;
    const inboxPath = path.join(tmpDir, "INBOX.md");
    fs.writeFileSync(inboxPath, inboxContent, "utf8");

    hydrateRunsFromInbox(inboxPath);

    const runs = listRuns();
    const skipped = runs.find((r) => r.url === "https://www.instagram.com/reel/junk-post");
    expect(skipped?.status).toBe("skipped");
    expect(skipped?.status).not.toBe("processed");
  });

  it("is a no-op when INBOX.md does not exist", async () => {
    const { hydrateRunsFromInbox } = await import("../src/runner.js");
    expect(() => hydrateRunsFromInbox(path.join(tmpDir, "missing.md"))).not.toThrow();
  });
});
