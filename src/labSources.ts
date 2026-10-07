import { createHash } from "node:crypto";
import { LabEvidenceSchema, type LabEvidence } from "./lab.js";

type Reader = (url: string, init?: RequestInit) => Promise<any>;
export function parseDiscussionUrl(raw: string) {
  const parsed = new URL(raw);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) throw new Error("Use a public HTTPS discussion URL");
  if (parsed.hostname === "github.com") {
    const match = parsed.pathname.match(/^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/(issues|discussions)\/([1-9]\d{0,9})\/?$/);
    if (match) return { source: "github" as const, url: `https://github.com/${match[1]}/${match[2]}/${match[3]}/${match[4]}`, owner: match[1], repo: match[2], kind: match[3], number: Number(match[4]) };
  }
  if (parsed.hostname === "news.ycombinator.com" && parsed.pathname === "/item" && /^[1-9]\d{0,11}$/.test(parsed.searchParams.get("id") ?? "")) {
    const number = Number(parsed.searchParams.get("id"));
    return { source: "hackernews" as const, url: `https://news.ycombinator.com/item?id=${number}`, owner: "", repo: "", kind: "story", number };
  }
  throw new Error("Use a GitHub issue/discussion or Hacker News item URL");
}

export const readSourceJson: Reader = async (url, init = {}) => {
  const parsed = new URL(url);
  if (!["api.github.com", "hacker-news.firebaseio.com"].includes(parsed.hostname) || parsed.protocol !== "https:" || parsed.port) throw new Error("Unsupported source API");
  const headers: Record<string, string> = { "User-Agent": "tech-radar-community-lab", Accept: "application/json" };
  // REST issue capture must see only what an unauthenticated public reader can see.
  if (parsed.hostname === "api.github.com" && parsed.pathname === "/graphql" && process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  if (init.body) headers["Content-Type"] = "application/json";
  const response = await fetch(url, { ...init, headers, redirect: "error", signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`Source HTTP ${response.status}; capture was not completed`);
  const reader = response.body?.getReader(); if (!reader) throw new Error("Source returned no body");
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) { const next = await reader.read(); if (next.done) break; bytes += next.value.byteLength;
      if (bytes > 512_000) throw new Error("Source response exceeds 512 KB limit"); chunks.push(next.value); }
  } finally { await reader.cancel(); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
};

export async function captureDiscussion(raw: string, read: Reader = readSourceJson): Promise<LabEvidence> {
  const target = parseDiscussionUrl(raw); const warnings: string[] = []; const comments: LabEvidence["comments"] = [];
  const clip = (value: unknown, limit: number) => { const s = typeof value === "string" ? value : ""; if (s.length > limit) warnings.push("Some source text was truncated to the capture limit"); return s.slice(0, limit); };
  let title = ""; let body = "";
  if (target.source === "github" && target.kind === "issues") {
    const base = `https://api.github.com/repos/${target.owner}/${target.repo}/issues/${target.number}`;
    const item = await read(base);
    if (!item || typeof item.title !== "string") throw new Error("GitHub returned an invalid issue");
    title = clip(item.title, 500); body = clip(item.body, 16_000);
    if (Number(item.comments) > 0) {
      try {
        const rows = await read(`${base}/comments?per_page=20`);
        if (!Array.isArray(rows)) throw new Error("Invalid comments");
        for (const row of rows.slice(0, 20)) {
          if (!Number.isSafeInteger(row.id) || typeof row.body !== "string") { warnings.push("A malformed comment was omitted"); continue; }
          comments.push({ id: String(row.id), author: clip(row.user?.login, 200), body: clip(row.body, 4_000), url: `${target.url}#issuecomment-${row.id}` });
        }
        if (Number(item.comments) > comments.length) warnings.push("Comment capture is partial; remaining replies were omitted");
      } catch { warnings.push("Comments could not be retrieved; capture is partial"); }
    }
  } else if (target.source === "github") {
    if (read === readSourceJson && !process.env.GITHUB_TOKEN) throw new Error("GitHub Discussions capture requires GITHUB_TOKEN");
    const query = `query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){isPrivate discussion(number:$number){title body comments(first:10){pageInfo{hasNextPage} nodes{id body author{login} url replies(first:5){pageInfo{hasNextPage} nodes{id body author{login} url}}}}}}}`;
    const data = await read("https://api.github.com/graphql", { method: "POST", body: JSON.stringify({ query, variables: { owner: target.owner, repo: target.repo, number: target.number } }) });
    const item = data?.data?.repository?.discussion;
    if (data?.errors?.length || !item || typeof item.title !== "string") throw new Error("GitHub Discussion unavailable; check repository access");
    if (data.data.repository.isPrivate !== false) throw new Error("Only public GitHub Discussions can be captured");
    title = clip(item.title, 500); body = clip(item.body, 16_000);
    const add = (row: any, parentId?: string) => {
      if (comments.length >= 20) { warnings.push("Comment limit reached; capture is partial"); return; }
      if (typeof row.id !== "string" || typeof row.body !== "string" || typeof row.url !== "string" || !row.url.startsWith(target.url + "#")) { warnings.push("A malformed comment was omitted"); return; }
      comments.push({ id: row.id.slice(0, 160), ...(parentId ? { parentId } : {}), body: clip(row.body, 4_000), author: clip(row.author?.login, 200), url: row.url });
    };
    if (item.comments?.pageInfo?.hasNextPage) warnings.push("More top-level comments exist; capture is partial");
    for (const row of item.comments?.nodes ?? []) { add(row); for (const reply of row.replies?.nodes ?? []) add(reply, row.id); if (row.replies?.pageInfo?.hasNextPage) warnings.push("More nested replies exist; capture is partial"); }
  } else {
    const item = await read(`https://hacker-news.firebaseio.com/v0/item/${target.number}.json`);
    if (!item || item.deleted || item.dead || !["story", "comment"].includes(item.type)) throw new Error("Hacker News item is unavailable");
    title = clip(item.title || `HN discussion ${target.number}`, 500); body = clip(item.text, 16_000);
    const queue: number[] = Array.isArray(item.kids) ? [...item.kids] : []; const seen = new Set<number>([target.number]); let requests = 0;
    while (queue.length && requests < 12) {
      const id = queue.shift()!; if (!Number.isSafeInteger(id) || id <= 0 || seen.has(id)) continue;
      seen.add(id); requests++;
      try {
        const row = await read(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
        if (!row || row.deleted || row.dead || typeof row.text !== "string") { warnings.push("An unavailable reply was omitted"); continue; }
        comments.push({ id: String(id), parentId: String(row.parent ?? target.number), author: clip(row.by, 200), body: clip(row.text, 4_000), url: `https://news.ycombinator.com/item?id=${id}` });
        if (Array.isArray(row.kids)) queue.push(...row.kids.filter((n: unknown) => Number.isSafeInteger(n)));
      } catch { warnings.push("A reply could not be retrieved; capture is partial"); }
    }
    if (queue.length) warnings.push("Reply budget reached; remaining replies were omitted");
  }
  const stable = JSON.stringify({ url: target.url, title, body, comments, warnings: [...new Set(warnings)] });
  return LabEvidenceSchema.parse({ id: `${target.source}:${createHash("sha256").update(stable).digest("hex").slice(0, 24)}`, source: target.source, url: target.url, title, body, comments, retrievedAt: new Date().toISOString(), status: warnings.length ? "partial" : "ok", warnings: [...new Set(warnings)].slice(0, 20) });
}
