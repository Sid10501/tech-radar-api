import { afterEach, describe, expect, it, vi } from "vitest";
import { captureDiscussion, parseDiscussionUrl, readSourceJson } from "../src/labSources.js";
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("discussion capture", () => {
  it("accepts only canonical public discussion URLs and never accepts credentials or arbitrary hosts", () => {
    expect(parseDiscussionUrl("https://github.com/a/b/issues/12?ignored=1#comment").url).toBe("https://github.com/a/b/issues/12");
    for (const url of ["http://127.0.0.1", "https://github.com.evil.test/a/b/issues/1", "https://user:pass@github.com/a/b/issues/1", "https://github.com/a/b/blob/main/x", "https://news.ycombinator.com/item?id=-1"]) expect(() => parseDiscussionUrl(url)).toThrow();
  });
  it("keeps GitHub comments as untrusted text and labels truncated replies", async () => {
    const result = await captureDiscussion("https://github.com/a/b/issues/12", async url => url.includes("/comments?") ? [{ id: 7, body: "<script>bad()</script> workaround", user: { login: "dev" }, created_at: "2026-09-01T00:00:00Z", html_url: "https://github.com/a/b/issues/12#issuecomment-7" }] : { title: "A reproducible problem", body: "Details", comments: 99, created_at: "2026-09-01T00:00:00Z" });
    expect(result.comments[0].body).toContain("<script>");
    expect(result.status).toBe("partial");
    expect(result.warnings.join(" ")).toMatch(/partial|limit|omitted/i);
  });
  it("preserves HN reply relationships and reports missing comments", async () => {
    const records: Record<string, unknown> = { "1": { id: 1, type: "story", title: "Ask HN", text: "Question", kids: [2, 4] }, "2": { id: 2, type: "comment", parent: 1, text: "Workaround", kids: [3] }, "3": { id: 3, type: "comment", parent: 2, text: "That fails on Windows" }, "4": null };
    const result = await captureDiscussion("https://news.ycombinator.com/item?id=1", async url => records[url.match(/item\/(\d+)/)![1]]);
    expect(result.comments.find(c => c.id === "3")?.parentId).toBe("2");
    expect(result.status).toBe("partial");
  });
  it("does not fabricate a successful record when root retrieval fails", async () => {
    await expect(captureDiscussion("https://github.com/a/b/issues/1", async () => { throw new Error("Source HTTP 403"); })).rejects.toThrow("403");
  });
  it("keeps REST source capture public-only while authenticating the required GraphQL endpoint", async () => {
    vi.stubEnv("GITHUB_TOKEN", "owner-test-token");
    const requests: Array<{ url: string; authorization: string | null }> = [];
    vi.stubGlobal("fetch", async (url: string, options: RequestInit) => {
      requests.push({ url, authorization: new Headers(options.headers).get("Authorization") });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    await readSourceJson("https://api.github.com/repos/a/b/issues/1");
    await readSourceJson("https://api.github.com/graphql", { method: "POST", body: "{}" });
    expect(requests).toEqual([
      { url: "https://api.github.com/repos/a/b/issues/1", authorization: null },
      { url: "https://api.github.com/graphql", authorization: "Bearer owner-test-token" },
    ]);
  });
  it("rejects private or unknown-visibility GitHub Discussions before saving any source text", async () => {
    for (const isPrivate of [true, undefined]) {
      await expect(captureDiscussion("https://github.com/a/b/discussions/1", async () => ({
        data: { repository: { isPrivate, discussion: { title: "Internal plan", body: "Private source", comments: { pageInfo: { hasNextPage: false }, nodes: [] } } } },
      }))).rejects.toThrow(/public/i);
    }
    const result = await captureDiscussion("https://github.com/a/b/discussions/1", async (_url, options) => {
      expect(JSON.parse(String(options?.body)).query).toContain("isPrivate");
      return { data: { repository: { isPrivate: false, discussion: { title: "Public discussion", body: "Public source", comments: { pageInfo: { hasNextPage: false }, nodes: [] } } } } };
    });
    expect(result.status).toBe("ok");
    expect(result.title).toBe("Public discussion");
  });
});
