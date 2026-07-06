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
  status: "pending" | "processed" | "failed" | "skipped";
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
    fs.writeFileSync(path.join(findingsDir, filename), body, "utf8");
    await this.git.add(path.join("tech-radar", "findings", filename));
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
      // Find the pending row for this URL — match regardless of spacing around "pending"
      const lines = content.split("\n");
      const pendingIdx = lines.findIndex(
        (l) => l.includes(row.url) && /\|\s*pending\s*\|/.test(l)
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

export function setupSshKey(base64Key: string): string {
  const keyPath = "/tmp/tech-radar-deploy-key";
  const keyData = Buffer.from(base64Key, "base64").toString("utf8");
  fs.writeFileSync(keyPath, keyData, { mode: 0o600 });
  return keyPath;
}
