import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { SID_REVIEW_SCRIPT } from "../src/reviewWorkbench.js";
import { LAB_DASHBOARD_HTML } from "../src/labDashboard.js";

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

describe("owner review browser script", () => {
  it("escapes saved owner and source text before building the finding panel", () => {
    const context = vm.createContext({ state: { privateUnlocked: true }, escapeHtml: (value: unknown) => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as Record<string, string>)[character]) });
    vm.runInContext(SID_REVIEW_SCRIPT, context);
    vm.runInContext("reviewState.byId.set('signal.md', { review: { decision: 'Try', rationale: '<img src=x onerror=alert(1)>', projectSlug: 'radar', updatedAt: '2026-10-01T00:00:00.000Z' }, brief: { id: 'abc', experiment: { status: 'running', result: '<script>bad</script>' } } })", context);
    const html = vm.runInContext("reviewPanel({ id: 'signal.md' })", context) as string;
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("&lt;script&gt;bad&lt;/script&gt;");
    expect(html).toContain("/lab?brief=abc");
    expect(html).not.toContain("<script>bad</script>");
  });

  it("keeps a late review response from changing a newly selected finding", async () => {
    const first = deferred<any>(); const second = deferred<any>();
    const fetch = (url: string) => url.endsWith("first.md") ? first.promise : second.promise;
    const state = { privateUnlocked: true, selectedId: "first.md" };
    const context = vm.createContext({ state, fetch, requestHeaders: () => ({}), renderDetail: () => {}, document: { getElementById: () => null }, escapeHtml: String });
    vm.runInContext(SID_REVIEW_SCRIPT, context);
    const initial = vm.runInContext("loadReview('first.md')", context);
    state.selectedId = "second.md";
    const current = vm.runInContext("loadReview('second.md')", context);
    second.resolve({ ok: true, json: async () => ({ review: { decision: "Bookmark", rationale: "Current" }, brief: null }) });
    await current;
    first.resolve({ ok: true, json: async () => ({ review: { decision: "Try", rationale: "Stale" }, brief: null }) });
    await initial;
    expect(vm.runInContext("reviewState.byId.get('second.md').review.rationale", context)).toBe("Current");
    expect(vm.runInContext("reviewState.byId.has('first.md')", context)).toBe(false);
  });

  it("sends the saved revision and leaves edited fields intact on a conflict", async () => {
    const fields = new Map<string, any>();
    for (const selector of ["[data-review-decision]", "[data-review-rationale]", "[data-review-project]", "[data-review-status]", "[data-review-save]"]) {
      fields.set(selector, { value: "", textContent: "", disabled: false, handlers: {} as Record<string, () => Promise<void> | void>, addEventListener(event: string, handler: () => Promise<void> | void) { this.handlers[event] = handler; } });
    }
    fields.get("[data-review-decision]").value = "Try";
    fields.get("[data-review-rationale]").value = "Edited rationale";
    fields.get("[data-review-project]").value = "radar";
    const requests: any[] = [];
    const context = vm.createContext({
      state: { privateUnlocked: true, selectedId: "signal.md" },
      document: { getElementById: () => ({ querySelector: (selector: string) => fields.get(selector) ?? null }) },
      requestHeaders: () => ({}), renderDetail: () => {}, escapeHtml: String,
      fetch: async (url: string, options: any) => { requests.push({ url, options }); return { ok: false, status: 409, json: async () => ({ error: "Conflict" }) }; },
    });
    vm.runInContext(SID_REVIEW_SCRIPT, context);
    vm.runInContext("reviewState.byId.set('signal.md', { review: { decision: 'Bookmark', rationale: 'Old', updatedAt: '2026-10-01T00:00:00.000Z' }, brief: null })", context);
    vm.runInContext("bindReviewPanel({ id: 'signal.md' })", context);
    fields.get("[data-review-rationale]").handlers.input();
    expect(fields.get("[data-review-status]").textContent).toBe("Unsaved changes");
    await fields.get("[data-review-save]").handlers.click();
    expect(requests[0].url).toBe("/api/lab/reviews/signal.md");
    expect(JSON.parse(requests[0].options.body)).toEqual({ decision: "Try", rationale: "Edited rationale", projectSlug: "radar", expectedUpdatedAt: "2026-10-01T00:00:00.000Z" });
    expect(fields.get("[data-review-rationale]").value).toBe("Edited rationale");
    expect(fields.get("[data-review-status]").textContent).toMatch(/Reload the finding/);
  });

  it("keeps newer rationale typing when an earlier save is acknowledged", async () => {
    const pending = deferred<any>();
    const fields = new Map<string, any>();
    for (const selector of ["decision", "rationale", "project", "status", "save", "question", "success", "create"]) {
      fields.set(`[data-review-${selector}]`, { value: "", textContent: "", disabled: false, handlers: {} as Record<string, () => Promise<void> | void>, addEventListener(event: string, handler: () => Promise<void> | void) { this.handlers[event] = handler; } });
    }
    fields.get("[data-review-decision]").value = "Try";
    fields.get("[data-review-rationale]").value = "Sent rationale";
    const context = vm.createContext({ state: { privateUnlocked: true, selectedId: "signal.md" },
      document: { getElementById: () => ({ querySelector: (selector: string) => fields.get(selector) ?? null }) },
      requestHeaders: () => ({}), escapeHtml: String, fetch: async () => pending.promise,
      renderDetail: () => { context.lastHtml = vm.runInContext("reviewPanel({ id: 'signal.md' })", context); } });
    vm.runInContext(SID_REVIEW_SCRIPT, context);
    vm.runInContext("reviewState.byId.set('signal.md', { review: { decision: 'Try', rationale: 'Old', projectSlug: null, updatedAt: '2026-10-01T00:00:00.000Z' }, brief: null }); bindReviewPanel({ id: 'signal.md' })", context);
    const saving = fields.get("[data-review-save]").handlers.click();
    fields.get("[data-review-rationale]").value = "New work typed during save";
    fields.get("[data-review-rationale]").handlers.input();
    pending.resolve({ ok: true, json: async () => ({ review: { decision: "Try", rationale: "Sent rationale", projectSlug: null, updatedAt: "2026-10-01T00:00:01.000Z" } }) });
    await saving;
    expect(context.lastHtml).toContain("New work typed during save");
    expect(context.lastHtml).toContain("Unsaved changes");
    expect(vm.runInContext("reviewState.byId.get('signal.md').review.rationale", context)).toBe("Sent rationale");
  });

  it("keeps question and criteria drafts through a late detail render and review refresh", async () => {
    const pending = deferred<any>();
    const fields = new Map<string, any>();
    for (const selector of ["decision", "rationale", "project", "status", "save", "question", "success", "create"]) {
      fields.set(`[data-review-${selector}]`, { value: "", textContent: "", disabled: false, handlers: {} as Record<string, () => Promise<void> | void>, addEventListener(event: string, handler: () => Promise<void> | void) { this.handlers[event] = handler; } });
    }
    const context = vm.createContext({ state: { privateUnlocked: true, selectedId: "signal.md" },
      document: { getElementById: () => ({ querySelector: (selector: string) => fields.get(selector) ?? null }) },
      requestHeaders: () => ({}), escapeHtml: String, fetch: async () => pending.promise,
      renderDetail: () => { context.lastHtml = vm.runInContext("reviewPanel({ id: 'signal.md' })", context); } });
    vm.runInContext(SID_REVIEW_SCRIPT, context);
    vm.runInContext("reviewState.byId.set('signal.md', { review: { decision: 'Try', rationale: 'Test', projectSlug: null, updatedAt: '2026-10-01T00:00:00.000Z' }, brief: null }); bindReviewPanel({ id: 'signal.md' })", context);
    fields.get("[data-review-question]").value = "Does the late frame survive?";
    fields.get("[data-review-question]").handlers.input();
    fields.get("[data-review-success]").value = "Find 90 percent";
    fields.get("[data-review-success]").handlers.input();
    vm.runInContext("renderDetail()", context); // the finding detail request completes after the owner starts typing
    expect(context.lastHtml).toContain("Does the late frame survive?");
    const refreshing = vm.runInContext("loadReview('signal.md')", context);
    pending.resolve({ ok: true, json: async () => ({ review: { decision: "Try", rationale: "Test", projectSlug: null, updatedAt: "2026-10-01T00:00:00.000Z" }, brief: null }) });
    await refreshing;
    expect(context.lastHtml).toContain("Does the late frame survive?");
    expect(context.lastHtml).toContain("Find 90 percent");
  });

  it("keeps newer question text visible when a pending experiment creation completes", async () => {
    const created = deferred<any>();
    const refreshed = deferred<any>();
    const fields = new Map<string, any>();
    for (const selector of ["decision", "rationale", "project", "status", "save", "question", "success", "create"]) {
      fields.set(`[data-review-${selector}]`, { value: "", textContent: "", disabled: false, handlers: {} as Record<string, () => Promise<void> | void>, addEventListener(event: string, handler: () => Promise<void> | void) { this.handlers[event] = handler; } });
    }
    fields.get("[data-review-question]").value = "Original question";
    fields.get("[data-review-success]").value = "Original criterion";
    const context = vm.createContext({ state: { privateUnlocked: true, selectedId: "signal.md" },
      document: { getElementById: () => ({ querySelector: (selector: string) => fields.get(selector) ?? null }) },
      requestHeaders: () => ({}), escapeHtml: String,
      fetch: async (url: string) => url.endsWith("/experiment") ? created.promise : refreshed.promise,
      renderDetail: () => { context.lastHtml = vm.runInContext("reviewPanel({ id: 'signal.md' })", context); } });
    vm.runInContext(SID_REVIEW_SCRIPT, context);
    vm.runInContext("reviewState.byId.set('signal.md', { review: { decision: 'Try', rationale: 'Test', projectSlug: null, updatedAt: '2026-10-01T00:00:00.000Z' }, brief: null }); bindReviewPanel({ id: 'signal.md' })", context);
    const creating = fields.get("[data-review-create]").handlers.click();
    fields.get("[data-review-question]").value = "Newer question";
    fields.get("[data-review-question]").handlers.input();
    const brief = { id: "brief-1", experiment: { status: "planned", result: null } };
    created.resolve({ ok: true, json: async () => ({ brief }) });
    for (let i = 0; i < 5; i++) await Promise.resolve();
    refreshed.resolve({ ok: true, json: async () => ({ review: { decision: "Try", rationale: "Test", projectSlug: null, updatedAt: "2026-10-01T00:00:01.000Z" }, brief }) });
    await creating;
    expect(context.lastHtml).toContain("Newer question");
    expect(context.lastHtml).toContain("not in the saved experiment");
  });

  it("opens and focuses the linked Lab brief after loading the owner workspace", async () => {
    const script = LAB_DASHBOARD_HTML.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    expect(script).toBeTruthy();
    new vm.Script(script!);
    const elements = new Map<string, any>();
    for (const match of LAB_DASHBOARD_HTML.matchAll(/\sid="([^"]+)"/g)) {
      elements.set(match[1], { value: "", checked: false, hidden: false, textContent: "", classList: { toggle() {} },
        replaceChildren() {}, append() {}, reset() {}, scrollIntoView() { this.scrolled = true; }, focus() { this.focused = true; } });
    }
    const brief = { id: "brief-123", title: "Selected experiment", problem: "Known problem", workarounds: [], disagreements: [], existingSolutions: [], projectSlug: null, findingIds: ["signal.md"], evidenceIds: [], visibility: "private", experiment: { question: "Will it work?", successCriteria: "Real result", status: "planned", result: null, evidenceUrls: [] } };
    const document = { getElementById: (id: string) => elements.get(id), querySelectorAll: () => [], createElement: () => ({ append() {}, set textContent(_value: string) {}, className: "", onclick: null }), createTextNode: () => ({}) };
    const context = vm.createContext({ document, location: { search: "?brief=brief-123" }, URLSearchParams,
      fetch: async () => ({ ok: true, json: async () => ({ evidence: [], briefs: [brief] }) }) });
    vm.runInContext(script!, context);
    for (let i = 0; i < 12; i++) await Promise.resolve();
    expect(elements.get("title").value).toBe("Selected experiment");
    expect(elements.get("editor").scrolled).toBe(true);
    expect(elements.get("title").focused).toBe(true);
  });
});
