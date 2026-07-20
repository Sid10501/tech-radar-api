import { simpleGit, SimpleGit } from "simple-git";
import fs from "node:fs";
import path from "node:path";

export interface AiMemoryRepoOptions {
  remoteUrl: string;
  localDir: string;
  gitAuthor: { name: string; email: string };
  sshKeyPath?: string;
  branch?: string;
}

export interface InboxRow {
  url: string;
  status: "pending" | "running" | "awaiting_media" | "downstream_pending" | "processed" | "partial" | "needs_review" | "failed" | "skipped";
  finding: string | null;
  date: string;
  error?: string;
}

export interface IndexRow {
  date: string;
  title: string;
  finding: string;
  targetProject: string;
}

export interface WriteFindingForSourceInput {
  sourceUrl: string | null;
  filename: string;
  body: string;
  date: string;
}

export interface WriteFindingResult {
  filename: string;
  generatedFilename: string;
  replacedExisting: boolean;
}

export class AiMemoryRepo {
  private git!: SimpleGit;
  private readonly opts: AiMemoryRepoOptions;

  constructor(opts: AiMemoryRepoOptions) {
    this.opts = opts;
  }

  async init(): Promise<void> {
    const { remoteUrl, localDir, gitAuthor, sshKeyPath } = this.opts;

    const env: Record<string, string> = { ...process.env as Record<string, string> };
    if (sshKeyPath) {
      env["GIT_SSH_COMMAND"] = `ssh -i ${sshKeyPath} -o StrictHostKeyChecking=no`;
    }

    if (!fs.existsSync(path.join(localDir, ".git"))) {
      fs.mkdirSync(path.dirname(localDir), { recursive: true });
      const parentGit = simpleGit({
        baseDir: path.dirname(localDir),
        config: [],
        unsafe: { allowUnsafeSshCommand: true },
      });
      if (sshKeyPath) parentGit.env(env);
      const branch = this.opts.branch ?? "master";
      await parentGit.clone(remoteUrl, path.basename(localDir), ["-b", branch]);
    }

    this.git = simpleGit({
      baseDir: localDir,
      config: [
        `user.name=${gitAuthor.name}`,
        `user.email=${gitAuthor.email}`,
      ],
      unsafe: { allowUnsafeSshCommand: true },
    });
    if (sshKeyPath) this.git.env(env);
  }

  async pullLatest(): Promise<void> {
    // Pull without specifying branch — uses the tracking branch set up by clone
    await this.git.pull(["--ff-only"]);
  }

  async writeFinding(filename: string, body: string): Promise<void> {
    const findingsDir = path.join(this.opts.localDir, "tech-radar", "findings");
    fs.mkdirSync(findingsDir, { recursive: true });
    const safeFilename = safeFindingFilename(filename);
    fs.writeFileSync(path.join(findingsDir, safeFilename), body, "utf8");
    await this.git.add(path.join("tech-radar", "findings", safeFilename));
  }

  async writeFindingForSource(input: WriteFindingForSourceInput): Promise<WriteFindingResult> {
    const findingsDir = path.join(this.opts.localDir, "tech-radar", "findings");
    fs.mkdirSync(findingsDir, { recursive: true });
    const existingFilename = input.sourceUrl ? this.findFindingBySourceUrl(input.sourceUrl) : null;
    const generatedFilename = safeFindingFilename(input.filename);
    const targetFilename = safeFindingFilename(existingFilename ?? generatedFilename);
    const body = existingFilename
      ? appendRetryMetadata(input.body, {
          date: input.date,
          generatedFilename,
          previousFilename: existingFilename,
        })
      : input.body;

    fs.writeFileSync(path.join(findingsDir, targetFilename), body, "utf8");
    await this.git.add(path.join("tech-radar", "findings", targetFilename));
    return {
      filename: targetFilename,
      generatedFilename,
      replacedExisting: Boolean(existingFilename),
    };
  }

  private findFindingBySourceUrl(sourceUrl: string): string | null {
    const findingsDir = path.join(this.opts.localDir, "tech-radar", "findings");
    if (!fs.existsSync(findingsDir)) return null;
    const sourceKey = canonicalSourceKey(sourceUrl);
    for (const file of fs.readdirSync(findingsDir).filter((name) => name.endsWith(".md")).sort()) {
      const content = fs.readFileSync(path.join(findingsDir, file), "utf8");
      const existingSourceUrl = sourceUrlFromMarkdown(content);
      if (existingSourceUrl === sourceUrl) return file;
      if (sourceKey && existingSourceUrl && canonicalSourceKey(existingSourceUrl) === sourceKey) return file;
    }
    return null;
  }

  async updateInbox(row: InboxRow): Promise<void> {
    const inboxPath = path.join(this.opts.localDir, "tech-radar", "INBOX.md");
    const errorCell = row.error ? row.error.slice(0, 120).replace(/\|/g, "/") : "";
    const newRow = `| ${row.date} | ${row.url} | ${row.status} | ${row.finding ?? ""} | ${errorCell} |`;

    let content = fs.existsSync(inboxPath) ? fs.readFileSync(inboxPath, "utf8") : "";

    const sentinel = "<!-- new rows inserted above this line -->";
    if (row.status === "pending") {
      if (content.includes(sentinel)) {
        content = content.replace(sentinel, `${newRow}\n${sentinel}`);
      } else {
        content += `\n${newRow}`;
      }
    } else {
      // Replace the active lifecycle row for this URL.
      const lines = content.split("\n");
      const pendingIdx = lines.findIndex(
        (l) => l.includes(row.url) && /\|\s*(?:pending|running|awaiting_media|downstream_pending)\s*\|/.test(l)
      );
      if (pendingIdx >= 0) {
        lines[pendingIdx] = newRow;
        content = lines.join("\n");
      } else {
        if (content.includes(sentinel)) {
          content = content.replace(sentinel, `${newRow}\n${sentinel}`);
        } else {
          content += `\n${newRow}`;
        }
      }
    }

    fs.writeFileSync(inboxPath, content, "utf8");
    await this.git.add(path.join("tech-radar", "INBOX.md"));
  }

  async updateInboxIfMissing(row: InboxRow): Promise<boolean> {
    if (this.inboxHasUrl(row.url)) return false;
    await this.updateInbox(row);
    return true;
  }

  private inboxHasUrl(url: string): boolean {
    const inboxPath = path.join(this.opts.localDir, "tech-radar", "INBOX.md");
    if (!fs.existsSync(inboxPath)) return false;
    return fs.readFileSync(inboxPath, "utf8").split("\n").some((line) => line.includes(url));
  }

  async updateIndex(row: IndexRow): Promise<void> {
    const indexPath = path.join(this.opts.localDir, "tech-radar", "INDEX.md");
    const newRow = `| ${row.date} | ${row.title} | [${row.finding}](tech-radar/findings/${row.finding}) | ${row.targetProject} |`;

    let content = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, "utf8") : "";
    const sentinel = "<!-- new rows inserted above this line -->";
    if (content.includes(sentinel)) {
      content = content.replace(sentinel, `${newRow}\n${sentinel}`);
    } else {
      content += `\n${newRow}`;
    }

    fs.writeFileSync(indexPath, content, "utf8");
    await this.git.add(path.join("tech-radar", "INDEX.md"));
  }

  async commitAndPush(message: string): Promise<void> {
    const status = await this.git.status();
    if (status.staged.length === 0) return;
    await this.git.commit(message);
    try {
      await this.git.push();
    } catch (pushErr) {
      const msg = pushErr instanceof Error ? pushErr.message : String(pushErr);
      if (msg.includes("rejected") || msg.includes("fetch first") || msg.includes("non-fast-forward")) {
        // Remote has new commits — pull with rebase and retry once
        await this.git.pull(["--rebase"]);
        await this.git.push();
      } else {
        throw pushErr;
      }
    }
  }
}

function safeFindingFilename(filename: string): string {
  if (
    !filename ||
    filename !== path.basename(filename) ||
    filename.includes("/") ||
    filename.includes("\\") ||
    filename === "." ||
    filename === ".." ||
    !filename.endsWith(".md")
  ) {
    throw new Error(`invalid finding filename: ${filename}`);
  }
  return filename;
}

function sourceUrlFromMarkdown(content: string): string | null {
  const sourceLine = content.match(/^\*\*Source:\*\*\s*(.+)$/m)?.[1]?.trim();
  return sourceLine?.match(/\]\(([^)]+)\)/)?.[1]?.trim() ?? null;
}

function cleanUrl(rawUrl: string): string {
  return rawUrl.replace(/[),.;]+$/, "");
}

function canonicalSourceKey(rawUrl: string): string | null {
  try {
    const parsed = new URL(cleanUrl(rawUrl));
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    const pathParts = parsed.pathname.split("/").filter(Boolean);

    if (host === "instagram.com") {
      const [kind, shortcode] = pathParts;
      if (kind && shortcode && ["p", "reel", "tv"].includes(kind.toLowerCase())) {
        return `instagram:${kind.toLowerCase()}:${shortcode}`;
      }
    }

    if (host === "vt.tiktok.com" && pathParts[0]) return `tiktok:short:${pathParts[0].toLowerCase()}`;
    if (host.endsWith("tiktok.com")) {
      const videoIndex = pathParts.findIndex((part) => part.toLowerCase() === "video");
      if (videoIndex >= 0 && pathParts[videoIndex + 1]) return `tiktok:video:${pathParts[videoIndex + 1]}`;
    }

    if ((host === "x.com" || host === "twitter.com") && pathParts.length >= 3 && pathParts[1]?.toLowerCase() === "status") {
      return `x:status:${pathParts[2]}`;
    }
  } catch {
    return null;
  }
  return null;
}

function appendRetryMetadata(
  body: string,
  metadata: { date: string; generatedFilename: string; previousFilename: string },
): string {
  const block = [
    "",
    "## Retry history",
    "",
    `- Updated: ${metadata.date}`,
    `- Previous filename: \`${metadata.previousFilename}\``,
    `- Generated filename: \`${metadata.generatedFilename}\``,
    "",
  ].join("\n");
  return `${body.trimEnd()}\n${block}`;
}

export function setupSshKey(base64Key: string): string {
  const keyPath = "/tmp/tech-radar-deploy-key";
  const keyData = Buffer.from(base64Key, "base64").toString("utf8");
  fs.writeFileSync(keyPath, keyData, { mode: 0o600 });
  return keyPath;
}
