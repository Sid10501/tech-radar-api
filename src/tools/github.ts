import https from "node:https";

export interface GithubRepoInfo {
  stars: number;
  lastPushed: string;
  openIssues: number;
  language: string | null;
  license: string | null;
  archived: boolean;
}

export function githubLookup(repo: string): Promise<GithubRepoInfo> {
  const token = process.env["GITHUB_TOKEN"];
  const headers: Record<string, string> = {
    "User-Agent": "tech-radar-api/1.0",
    "Accept": "application/vnd.github+json",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const url = `https://api.github.com/repos/${repo}`;

  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      let body = "";
      res.on("data", (chunk: Buffer | string) => { body += chunk; });
      res.on("end", () => {
        try {
          if (res.statusCode !== 200) {
            return reject(new Error(`GitHub API returned ${res.statusCode} for ${repo}`));
          }
          const data = JSON.parse(body);
          resolve({
            stars: data.stargazers_count ?? 0,
            lastPushed: data.pushed_at ?? "",
            openIssues: data.open_issues_count ?? 0,
            language: data.language ?? null,
            license: data.license?.spdx_id ?? null,
            archived: data.archived ?? false,
          });
        } catch (e) {
          reject(new Error(`Failed to parse GitHub response: ${e}`));
        }
      });
    });
    req.on("error", reject);
  });
}
