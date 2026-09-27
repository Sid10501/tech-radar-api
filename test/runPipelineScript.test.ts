import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("run_pipeline.sh", () => {
  it.each([undefined, "/tmp/extraction with spaces"])("invokes extraction with optional output directory %s", (outDir) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "radar-pipeline-test-"));
    try {
      // Fake only Python execution: dependency probes succeed, extractor echoes argv.
      fs.writeFileSync(path.join(directory, "python3"), `#!${process.execPath}\nif (process.argv[2] !== "-") console.log(JSON.stringify(process.argv.slice(2)));\n`, { mode: 0o755 });
      const output = execFileSync("bash", ["scripts/run_pipeline.sh", "https://example.com/video", ...(outDir ? [outDir] : [])], {
        encoding: "utf8",
        env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, TMPDIR: directory },
      });
      const args = JSON.parse(output);
      expect(args[0]).toMatch(/scripts\/extract_post\.py$/);
      expect(args[1]).toBe("https://example.com/video");
      expect(args.includes("--out-dir")).toBe(Boolean(outDir));
      if (outDir) expect(args[args.indexOf("--out-dir") + 1]).toBe(outDir);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
