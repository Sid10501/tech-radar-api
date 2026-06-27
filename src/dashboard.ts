import type { Run } from "./runner.js";

export const DASHBOARD_HTML = (runs: Run[]) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Tech Radar</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #17231c;
      --muted: #647568;
      --line: #dce3d9;
      --paper: #fbfcf8;
      --panel: #ffffff;
      --wash: #f3f5ef;
      --green: #26382d;
      --green-2: #537d61;
      --gold: #d8ad3d;
      --danger: #a64038;
      --shadow: 0 18px 60px rgba(23, 32, 26, 0.14);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--wash);
      color: var(--ink);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    button, input, select { font: inherit; }
    a { color: inherit; }
    .app { min-height: 100vh; display: grid; grid-template-rows: 56px 1fr; }
    .topbar {
      display: grid;
      grid-template-columns: 230px minmax(0, 1fr) auto;
      gap: 14px;
      align-items: center;
      padding: 0 16px;
      background: var(--ink);
      color: #f7f2e6;
    }
    .logo { display: flex; align-items: center; gap: 10px; font-weight: 780; }
    .mark {
      width: 30px; height: 30px; border-radius: 8px;
      display: grid; place-items: center;
      background: var(--gold); color: var(--ink); font-size: 12px; font-weight: 850;
    }
    .search {
      height: 36px; width: 100%;
      border: 1px solid rgba(247,242,230,.18);
      background: rgba(255,255,255,.06);
      border-radius: 8px;
      color: #f7f2e6;
      padding: 0 12px;
      outline: none;
    }
    .search::placeholder { color: #b9c5ba; }
    .top-actions { display: flex; gap: 8px; align-items: center; }
    .icon-btn, .add-btn {
      height: 36px; border: 1px solid rgba(247,242,230,.18); border-radius: 8px;
      background: rgba(255,255,255,.04); color: #f7f2e6; cursor: pointer;
    }
    .icon-btn { width: 36px; }
    .add-btn { padding: 0 12px; background: var(--gold); color: var(--ink); border-color: var(--gold); font-weight: 800; }
    .workspace { display: grid; grid-template-columns: 370px minmax(0, 1fr); min-height: calc(100vh - 56px); }
    .queue { background: var(--panel); border-right: 1px solid var(--line); min-width: 0; }
    .queue-head { padding: 14px; border-bottom: 1px solid #eef1eb; }
    .queue-title { display: flex; justify-content: space-between; gap: 10px; font-size: 14px; font-weight: 820; margin-bottom: 10px; }
    .tabs { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; }
    .tab {
      border: 0; border-radius: 7px; padding: 8px 5px; color: #56675c; background: #f2f4ef;
      font-size: 11px; font-weight: 760; cursor: pointer;
    }
    .tab.active { background: var(--green); color: #fff8e8; }
    .filters { display: flex; gap: 6px; padding: 10px 14px; border-bottom: 1px solid #eef1eb; overflow-x: auto; }
    .filter {
      flex: 0 0 auto; border: 1px solid #d8dfd6; border-radius: 999px; padding: 6px 9px;
      color: #506257; background: var(--paper); font-size: 11px; cursor: pointer;
    }
    .filter.active { background: #e8eee5; color: var(--ink); border-color: #b9c6b7; font-weight: 760; }
    .list { height: calc(100vh - 173px); overflow: auto; }
    .item {
      width: 100%; display: grid; grid-template-columns: 42px minmax(0, 1fr); gap: 10px;
      padding: 13px 14px; border: 0; border-bottom: 1px solid #eef1eb; background: #fff;
      text-align: left; cursor: pointer;
    }
    .item:hover { background: #fafbf8; }
    .item.selected { background: #f5f8ef; box-shadow: inset 4px 0 0 var(--green-2); }
    .health {
      width: 38px; height: 38px; border-radius: 9px; display: grid; place-items: center;
      font-weight: 850; font-size: 13px;
    }
    .health.strong { background: #dff1e5; color: #1d6c3a; }
    .health.review { background: #fff1c8; color: #765400; }
    .health.weak { background: #f6dedc; color: #932f2b; }
    .item-title { color: var(--ink); font-size: 13px; font-weight: 780; line-height: 1.25; margin-bottom: 4px; }
    .item-meta { color: var(--muted); font-size: 11px; line-height: 1.35; }
    .reason { color: #405146; font-size: 11px; margin-top: 7px; background: #f1f4ef; border-radius: 6px; padding: 6px 7px; }
    .content { min-width: 0; display: grid; grid-template-rows: auto auto 1fr; }
    .hero { padding: 18px 22px 16px; background: var(--paper); border-bottom: 1px solid #e3e8df; }
    .breadcrumb { color: var(--muted); font-size: 12px; margin-bottom: 8px; }
    .headline-row { display: grid; grid-template-columns: minmax(0, 1fr) 230px; gap: 18px; align-items: start; }
    .headline { font-size: clamp(21px, 2.2vw, 28px); line-height: 1.1; font-weight: 880; margin-bottom: 9px; }
    .summary { color: #425146; font-size: 14px; line-height: 1.45; max-width: 850px; }
    .decision {
      border: 1px solid var(--line); background: #fff; border-radius: 9px; padding: 12px; box-shadow: 0 8px 24px rgba(23,32,26,.05);
    }
    .decision-label { color: var(--muted); font-size: 10px; text-transform: uppercase; letter-spacing: .05em; font-weight: 780; }
    .decision-value { font-size: 16px; font-weight: 850; margin: 4px 0 10px; }
    .decision-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
    .action {
      border: 1px solid #d6ded4; border-radius: 7px; padding: 8px 6px; text-align: center;
      background: var(--paper); color: #28382e; font-size: 11px; font-weight: 780; cursor: pointer;
    }
    .action.primary { grid-column: 1 / -1; background: var(--green); color: #fff8e8; border-color: var(--green); }
    .facts { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 1px; background: #e3e8df; border-bottom: 1px solid #e3e8df; }
    .fact { background: #fff; padding: 11px 12px; min-width: 0; }
    .fact-label { color: #738175; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 4px; }
    .fact-value { font-size: 12px; font-weight: 830; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .main-grid { display: grid; grid-template-columns: minmax(0, 1fr) 315px; gap: 16px; padding: 16px 22px 22px; }
    .panel { border: 1px solid var(--line); border-radius: 9px; background: #fff; overflow: hidden; }
    .panel-head { padding: 11px 13px; border-bottom: 1px solid #eef1eb; background: var(--paper); color: var(--green); font-size: 12px; font-weight: 840; display: flex; justify-content: space-between; gap: 10px; }
    .panel-body { padding: 14px; color: #334139; font-size: 13px; line-height: 1.5; }
    .evidence-tabs { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
    .evidence-tab { border: 0; border-radius: 6px; background: #eef2ea; color: #405146; padding: 7px 9px; font-size: 11px; font-weight: 780; cursor: pointer; }
    .evidence-tab.active { background: var(--gold); color: var(--ink); }
    .markdown h1, .markdown h2, .markdown h3 { color: var(--ink); line-height: 1.2; }
    .markdown h1 { font-size: 21px; }
    .markdown h2 { font-size: 16px; margin-top: 20px; }
    .markdown p, .markdown li { color: #334139; }
    .markdown pre {
      white-space: pre-wrap; overflow-wrap: anywhere; background: #f6f7f3; border: 1px solid #e1e6df;
      border-radius: 8px; padding: 12px; font-size: 12px;
    }
    .side { display: grid; gap: 12px; align-content: start; }
    .row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; padding: 8px 0; border-bottom: 1px solid #eef1eb; align-items: center; }
    .row:last-child { border-bottom: 0; }
    .row-label { color: #415247; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .badge { border-radius: 5px; background: #eef2ea; color: #405146; padding: 3px 6px; font-size: 10px; font-weight: 820; }
    .empty { padding: 36px; color: var(--muted); text-align: center; }
    .toast { position: fixed; right: 18px; bottom: 18px; background: var(--ink); color: #fff8e8; border-radius: 8px; padding: 10px 12px; font-size: 13px; display: none; }
    @media (max-width: 980px) {
      .topbar { grid-template-columns: 1fr auto; }
      .search { display: none; }
      .workspace { grid-template-columns: 1fr; }
      .queue { border-right: 0; border-bottom: 1px solid var(--line); }
      .list { max-height: 360px; height: auto; }
      .headline-row, .main-grid { grid-template-columns: 1fr; }
      .facts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 560px) {
      .top-actions .icon-btn { display: none; }
      .topbar { padding: 0 12px; }
      .hero, .main-grid { padding-left: 14px; padding-right: 14px; }
      .decision-actions { grid-template-columns: 1fr; }
      .action.primary { grid-column: auto; }
    }
  </style>
</head>
<body>
  <div id="dashboard-root" class="app">
    <header class="topbar">
      <div class="logo"><div class="mark">TR</div><div>Tech Radar</div></div>
      <input id="search" class="search" placeholder="Search by tool, project, source, repo, or extracted text">
      <div class="top-actions">
        <button id="refresh" class="icon-btn" title="Refresh">↻</button>
        <button class="icon-btn" title="Settings">⚙</button>
        <button id="add-url" class="add-btn">Add URL</button>
      </div>
    </header>
    <div class="workspace">
      <aside class="queue">
        <div class="queue-head">
          <div class="queue-title"><span>Findings queue</span><span id="count">0 total</span></div>
          <div class="tabs">
            <button class="tab active" data-view="review">Review</button>
            <button class="tab" data-view="adopt">Adopt</button>
            <button class="tab" data-view="backlog">Backlog</button>
            <button class="tab" data-view="skip">Skip</button>
          </div>
        </div>
        <div class="filters">
          <button class="filter active" data-filter="all">All</button>
          <button class="filter" data-filter="ocr">OCR</button>
          <button class="filter" data-filter="repo">Repo</button>
          <button class="filter" data-filter="weak">Weak signal</button>
          <button class="filter" data-filter="project">Project fit</button>
        </div>
        <div id="finding-list" class="list"></div>
      </aside>
      <main id="detail" class="content"></main>
    </div>
  </div>
  <div id="toast" class="toast"></div>
  <script>
    window.__RUNS__ = ${JSON.stringify(runs)};
    const state = { findings: [], selectedId: null, view: "review", filter: "all", detail: null, query: "" };
    const token = new URLSearchParams(location.search).get("token") || document.cookie.match(/auth_token=([^;]+)/)?.[1] || "";
    const authHeaders = token ? { Authorization: "Bearer " + token } : {};
    const $ = (id) => document.getElementById(id);
    function escapeHtml(value) {
      return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
    }
    function evidenceText(f) {
      const bits = [];
      if (f.evidence.caption) bits.push("caption");
      if (f.evidence.transcript) bits.push("transcript");
      if (f.evidence.ocr) bits.push("OCR");
      if (f.evidence.repo) bits.push("repo");
      return bits.join(" + ") || "metadata only";
    }
    function matchesView(f) {
      if (state.view === "adopt") return f.recommendedAction === "Create task";
      if (state.view === "backlog") return f.recommendedAction === "Backlog" || f.recommendedAction === "Review";
      if (state.view === "skip") return f.recommendedAction === "Skip" || f.recommendedAction === "Retry";
      return true;
    }
    function matchesFilter(f) {
      if (state.filter === "ocr") return f.evidence.ocr;
      if (state.filter === "repo") return f.evidence.repo;
      if (state.filter === "weak") return f.quality.level === "weak";
      if (state.filter === "project") return f.targetProject && f.targetProject !== "none" && f.targetProject !== "unknown";
      return true;
    }
    function matchesQuery(f) {
      const q = state.query.trim().toLowerCase();
      if (!q) return true;
      return [f.title, f.summary, f.targetProject, f.source.platform, f.verdict, ...(f.tags || [])].join(" ").toLowerCase().includes(q);
    }
    function filteredFindings() {
      return state.findings.filter((f) => matchesView(f) && matchesFilter(f) && matchesQuery(f));
    }
    function showToast(message) {
      const el = $("toast");
      el.textContent = message;
      el.style.display = "block";
      setTimeout(() => { el.style.display = "none"; }, 2200);
    }
    function renderList() {
      const list = $("finding-list");
      const findings = filteredFindings();
      $("count").textContent = state.findings.length + " total";
      if (!findings.length) {
        list.innerHTML = '<div class="empty">No findings match this view.</div>';
        return;
      }
      list.innerHTML = findings.map((f) => \`
        <button class="item \${f.id === state.selectedId ? "selected" : ""}" data-id="\${escapeHtml(f.id)}">
          <div class="health \${f.quality.level}">\${f.quality.score}</div>
          <div>
            <div class="item-title">\${escapeHtml(f.title)}</div>
            <div class="item-meta">\${escapeHtml(f.targetProject)} · \${escapeHtml(f.source.platform)} · \${escapeHtml(f.verdict)}</div>
            <div class="reason">Why surfaced: \${escapeHtml(f.quality.reasons.slice(0, 3).join(", ") || "needs manual review")}.</div>
          </div>
        </button>\`).join("");
      list.querySelectorAll(".item").forEach((button) => button.addEventListener("click", () => selectFinding(button.dataset.id)));
    }
    function markdownToHtml(markdown) {
      const safe = escapeHtml(markdown);
      return safe
        .replace(/^### (.*)$/gm, "<h3>$1</h3>")
        .replace(/^## (.*)$/gm, "<h2>$1</h2>")
        .replace(/^# (.*)$/gm, "<h1>$1</h1>")
        .replace(/\\*\\*([^*]+)\\*\\*/g, "<strong>$1</strong>")
        .replace(/\\[([^\\]]+)\\]\\((https?:\\/\\/[^)]+)\\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
        .replace(/^- (.*)$/gm, "<li>$1</li>")
        .replace(/(<li>.*<\\/li>)/gs, "<ul>$1</ul>")
        .split(/\\n{2,}/)
        .map((chunk) => /<(h1|h2|h3|ul)/.test(chunk) ? chunk : "<p>" + chunk.replace(/\\n/g, "<br>") + "</p>")
        .join("");
    }
    function renderDetail() {
      const detail = $("detail");
      const d = state.detail;
      if (!d) {
        detail.innerHTML = '<div class="empty">Select a finding to inspect its research, source quality, and next action.</div>';
        return;
      }
      const f = d.finding;
      const evidenceHtml = {
        summary: markdownToHtml(d.sections.tldr || f.summary),
        ocr: markdownToHtml((d.sections.shown || "").split("On-screen text / OCR:")[1] || "No OCR text captured for this finding."),
        transcript: markdownToHtml((d.sections.shown || "").split("Key claims from transcript:")[1]?.split("On-screen text / OCR:")[0] || "No transcript captured for this finding."),
        finding: markdownToHtml(d.markdown),
      };
      detail.innerHTML = \`
        <section class="hero">
          <div class="breadcrumb">Review queue / \${escapeHtml(f.targetProject)} / \${escapeHtml(f.source.platform)}</div>
          <div class="headline-row">
            <div>
              <div class="headline">\${escapeHtml(f.title)}</div>
              <div class="summary">\${escapeHtml(f.summary)}</div>
            </div>
            <div class="decision">
              <div class="decision-label">Recommended decision</div>
              <div class="decision-value">\${escapeHtml(f.recommendedAction)}</div>
              <div class="decision-actions">
                <button class="action primary" data-action="task">Create task</button>
                <button class="action" data-action="backlog">Backlog</button>
                <button class="action" data-action="skip">Skip</button>
                <button class="action" data-action="retry">Retry</button>
                <button class="action" data-action="reviewed">Reviewed</button>
              </div>
            </div>
          </div>
        </section>
        <section class="facts">
          <div class="fact"><div class="fact-label">Quality</div><div class="fact-value">\${f.quality.score} / \${f.quality.level}</div></div>
          <div class="fact"><div class="fact-label">Evidence</div><div class="fact-value">\${escapeHtml(evidenceText(f))}</div></div>
          <div class="fact"><div class="fact-label">Target</div><div class="fact-value">\${escapeHtml(f.targetProject)}</div></div>
          <div class="fact"><div class="fact-label">Effort</div><div class="fact-value">\${f.quality.level === "strong" ? "Small scoped task" : "Review first"}</div></div>
          <div class="fact"><div class="fact-label">Risk</div><div class="fact-value">\${f.quality.level === "weak" ? "High" : f.quality.level === "review" ? "Medium" : "Low"}</div></div>
          <div class="fact"><div class="fact-label">Status</div><div class="fact-value">Needs decision</div></div>
        </section>
        <section class="main-grid">
          <div class="panel">
            <div class="panel-head"><span>Research evidence</span><span>raw source preserved</span></div>
            <div class="panel-body">
              <div class="evidence-tabs">
                <button class="evidence-tab active" data-tab="summary">Why it matters</button>
                <button class="evidence-tab" data-tab="ocr">OCR</button>
                <button class="evidence-tab" data-tab="transcript">Transcript</button>
                <button class="evidence-tab" data-tab="finding">Full finding</button>
              </div>
              <div id="evidence-content" class="markdown">\${evidenceHtml.summary}</div>
            </div>
          </div>
          <div class="side">
            <div class="panel"><div class="panel-head">Source quality</div><div class="panel-body">
              <div class="row"><div class="row-label">Caption extracted</div><div class="badge">\${f.evidence.caption ? "yes" : "no"}</div></div>
              <div class="row"><div class="row-label">Transcript extracted</div><div class="badge">\${f.evidence.transcript ? "yes" : "no"}</div></div>
              <div class="row"><div class="row-label">OCR extracted</div><div class="badge">\${f.evidence.ocr ? "yes" : "no"}</div></div>
              <div class="row"><div class="row-label">Repo/docs found</div><div class="badge">\${f.evidence.repo || f.evidence.docs ? "yes" : "no"}</div></div>
            </div></div>
            <div class="panel"><div class="panel-head">Links</div><div class="panel-body">
              <div class="row"><div class="row-label">Source post</div><div class="badge">\${f.source.url ? '<a href="' + escapeHtml(f.source.url) + '" target="_blank" rel="noopener">open</a>' : "none"}</div></div>
              <div class="row"><div class="row-label">Markdown finding</div><div class="badge"><a href="https://github.com/Sid10501/ai-memory/blob/master/\${escapeHtml(f.path)}" target="_blank" rel="noopener">open</a></div></div>
            </div></div>
            <div class="panel"><div class="panel-head">Next task</div><div class="panel-body">\${escapeHtml(nextTaskText(f))}</div></div>
          </div>
        </section>\`;
      detail.querySelectorAll(".evidence-tab").forEach((button) => button.addEventListener("click", () => {
        detail.querySelectorAll(".evidence-tab").forEach((b) => b.classList.remove("active"));
        button.classList.add("active");
        $("evidence-content").innerHTML = evidenceHtml[button.dataset.tab];
      }));
      detail.querySelectorAll(".action").forEach((button) => button.addEventListener("click", () => showToast(button.textContent.trim() + " noted locally. Persistence comes next.")));
    }
    function nextTaskText(f) {
      if (f.recommendedAction === "Retry") return "Retry extraction or mark as low-confidence if the source is blocked.";
      if (f.recommendedAction === "Skip") return "Mark skipped unless a real project pain appears.";
      if (f.recommendedAction === "Create task") return "Create a small scoped task in " + f.targetProject + " using the implementation idea from the finding.";
      return "Review source evidence, then decide whether this belongs in backlog or should be skipped.";
    }
    async function selectFinding(id) {
      state.selectedId = id;
      renderList();
      const res = await fetch("/api/findings/" + encodeURIComponent(id), { headers: authHeaders });
      if (!res.ok) {
        showToast("Could not load finding. Add ?token=... if auth is enabled.");
        return;
      }
      state.detail = await res.json();
      renderDetail();
    }
    async function loadFindings() {
      const res = await fetch("/api/findings", { headers: authHeaders });
      if (!res.ok) {
        $("finding-list").innerHTML = '<div class="empty">Dashboard API is locked. Open this page with <code>?token=...</code>.</div>';
        return;
      }
      const body = await res.json();
      state.findings = body.findings || [];
      state.selectedId = state.findings[0]?.id || null;
      renderList();
      if (state.selectedId) await selectFinding(state.selectedId);
      else renderDetail();
    }
    document.querySelectorAll(".tab").forEach((button) => button.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
      button.classList.add("active");
      state.view = button.dataset.view;
      renderList();
    }));
    document.querySelectorAll(".filter").forEach((button) => button.addEventListener("click", () => {
      document.querySelectorAll(".filter").forEach((b) => b.classList.remove("active"));
      button.classList.add("active");
      state.filter = button.dataset.filter;
      renderList();
    }));
    $("search").addEventListener("input", (event) => { state.query = event.target.value; renderList(); });
    $("refresh").addEventListener("click", () => loadFindings());
    $("add-url").addEventListener("click", async () => {
      const url = prompt("Paste an Instagram, TikTok, YouTube, GitHub, or article URL");
      if (!url) return;
      const res = await fetch("/runs", { method: "POST", headers: { ...authHeaders, "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
      showToast(res.ok ? "Queued for research." : "Could not queue URL.");
    });
    loadFindings();
    if ((window.__RUNS__ || []).some((r) => r.status === "running" || r.status === "pending")) {
      setTimeout(loadFindings, 8000);
    }
  </script>
</body>
</html>`;
