import { simpleGit, SimpleGit } from "simple-git";
import fs from "node:fs";
import path from "node:path";

export interface AiMemoryRepoOptions {
  remoteUrl: string;
  localDir: string;
  gitAuthor: { name: string; email: string };
  sshKeyPath?: string;
}

export interface InboxRow {
  url: string;
  status: "pending" | "processed" | "failed";
  finding: string | null;
  date: string;
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
      await parentGit.clone(remoteUrl, path.basename(localDir));
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
    await this.git.pull("origin", "main", { "--rebase": "false" });
  }

  async writeFinding(filename: string, body: string): Promise<void> {
    const findingsDir = path.join(this.opts.localDir, "tech-radar", "findings");
    fs.mkdirSync(findingsDir, { recursive: true });
    fs.writeFileSync(path.join(findingsDir, filename), body, "utf8");
    await this.git.add(path.join("tech-radar", "findings", filename));
  }

  async updateInbox(row: InboxRow): Promise<void> {
    const inboxPath = path.join(this.opts.localDir, "tech-radar", "INBOX.md");
    const newRow = `| ${row.date} | ${row.url} | ${row.status} | ${row.finding ?? ""} |`;

    let content = fs.existsSync(inboxPath) ? fs.readFileSync(inboxPath, "utf8") : "";

    if (row.status === "pending") {
      content += `\n${newRow}`;
    } else {
      // Update the existing pending row for this URL
      const urlEscaped = row.url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pendingRe = new RegExp(`^(\\|[^|]*\\| *${urlEscaped} *\\| *)pending( *\\|.*)$`, "m");
      if (pendingRe.test(content)) {
        content = content.replace(pendingRe, `$1${row.status}$2`);
        if (row.finding) {
          content = content.replace(
            new RegExp(`(\\|[^|]*\\| *${urlEscaped} *\\|[^|]*\\| *)([^|]*)(\\|)`, "m"),
            `$1${row.finding}$3`
          );
        }
      } else {
        content += `\n${newRow}`;
      }
    }

    fs.writeFileSync(inboxPath, content, "utf8");
    await this.git.add(path.join("tech-radar", "INBOX.md"));
  }

  async updateIndex(row: IndexRow): Promise<void> {
    const indexPath = path.join(this.opts.localDir, "tech-radar", "INDEX.md");
    const newRow = `| ${row.date} | ${row.title} | [${row.finding}](tech-radar/findings/${row.finding}) | ${row.targetProject} |`;

    let content = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, "utf8") : "";
    content += `\n${newRow}`;

    fs.writeFileSync(indexPath, content, "utf8");
    await this.git.add(path.join("tech-radar", "INDEX.md"));
  }

  async commitAndPush(message: string): Promise<void> {
    const status = await this.git.status();
    if (status.staged.length === 0) return;
    await this.git.commit(message);
    await this.git.push("origin", "main");
  }
}

export function setupSshKey(base64Key: string): string {
  const keyPath = "/tmp/tech-radar-deploy-key";
  const keyData = Buffer.from(base64Key, "base64").toString("utf8");
  fs.writeFileSync(keyPath, keyData, { mode: 0o600 });
  return keyPath;
}
