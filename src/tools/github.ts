import https from "node:https";

export interface GithubRepoInfo {
  stars: number;
  lastPushed: string;
  openIssues: number;
  language: string | null;
  license: string | null;
  archived: boolean;
}

export interface GithubRepoSearchResult {
  fullName: string;
  htmlUrl: string;
  description: string | null;
  stars: number;
  archived: boolean;
}

function githubHeaders(): Record<string, string> {
  const token = process.env["GITHUB_TOKEN"];
  const headers: Record<string, string> = {
    "User-Agent": "tech-radar-api/1.0",
    "Accept": "application/vnd.github+json",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

export function githubLookup(repo: string): Promise<GithubRepoInfo> {
  const headers = githubHeaders();

  // Normalize: strip any leading API URL or https://github.com/ prefix
  let normalized = repo
    .replace(/^https?:\/\/api\.github\.com\/repos\//, "")
    .replace(/^https?:\/\/github\.com\//, "")
    .replace(/\/$/, "");

  // If the model passed a numeric repository ID, reject early with a clear error
  if (/^\d+$/.test(normalized)) {
    return Promise.reject(new Error(`github_lookup requires owner/name format, got numeric ID: ${repo}`));
  }

  const url = `https://api.github.com/repos/${normalized}`;

  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      // Follow redirects (301/302)
      if (res.statusCode === 301 || res.statusCode === 302) {
        const location = res.headers["location"];
        if (location) {
          const redirectedRepo = location.replace("https://api.github.com/repos/", "");
          resolve(githubLookup(redirectedRepo));
          return;
        }
      }

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

export function githubSearchRepositories(query: string, limit = 3): Promise<GithubRepoSearchResult[]> {
  const params = new URLSearchParams({
    q: `${query} in:name,description,readme`,
    sort: "stars",
    order: "desc",
    per_page: String(Math.max(1, Math.min(10, limit))),
  });
  const url = `https://api.github.com/search/repositories?${params.toString()}`;

  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: githubHeaders() }, (res) => {
      let body = "";
      res.on("data", (chunk: Buffer | string) => { body += chunk; });
      res.on("end", () => {
        try {
          if (res.statusCode !== 200) {
            return reject(new Error(`GitHub search returned ${res.statusCode} for ${query}`));
          }
          const data = JSON.parse(body);
          const items = Array.isArray(data.items) ? data.items : [];
          resolve(items.map((item: any) => ({
            fullName: item.full_name,
            htmlUrl: item.html_url,
            description: item.description ?? null,
            stars: item.stargazers_count ?? 0,
            archived: item.archived ?? false,
          })).filter((item: GithubRepoSearchResult) => item.fullName && item.htmlUrl));
        } catch (e) {
          reject(new Error(`Failed to parse GitHub search response: ${e}`));
        }
      });
    });
    req.on("error", reject);
  });
}
