import type { Run } from "./runner.js";

export const DASHBOARD_HTML = (runs: Run[]) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" href="data:,">
  <title>Tech Radar</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #171f1b;
      --muted: #65746c;
      --faint: #87928c;
      --line: #dde4df;
      --paper: #f7f8f3;
      --panel: #ffffff;
      --wash: #eef2ec;
      --green: #21392c;
      --green-soft: #e5efe7;
      --gold: #d8ad3d;
      --red-soft: #f8e5e1;
      --amber-soft: #fff2cb;
      --shadow: 0 20px 50px rgba(23, 31, 27, 0.11);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--wash);
      color: var(--ink);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    button, input { font: inherit; }
    button { cursor: pointer; }
    a { color: inherit; }
    html,
    body {
      height: 100%;
    }
    .app {
      height: 100vh;
      min-height: 0;
      display: grid;
      grid-template-rows: 58px 1fr;
      overflow: hidden;
    }
    .topbar {
      display: grid;
      grid-template-columns: auto minmax(220px, 560px) auto;
      gap: 14px;
      align-items: center;
      padding: 0 18px;
      background: var(--ink);
      color: #fff9eb;
    }
    .logo {
      display: flex;
      align-items: center;
      gap: 10px;
      font-weight: 850;
      min-width: 162px;
    }
    .mark {
      width: 32px;
      height: 32px;
      border-radius: 8px;
      display: grid;
      place-items: center;
      background: var(--gold);
      color: var(--ink);
      font-size: 12px;
      font-weight: 900;
    }
    .search {
      width: 100%;
      height: 38px;
      border: 1px solid rgba(255,249,235,.18);
      background: rgba(255,255,255,.07);
      border-radius: 8px;
      color: #fff9eb;
      padding: 0 12px;
      outline: none;
    }
    .search::placeholder { color: #bac5be; }
    .top-actions {
      display: flex;
      justify-content: end;
      align-items: center;
      gap: 8px;
    }
    .button {
      height: 38px;
      border: 1px solid rgba(255,249,235,.2);
      border-radius: 8px;
      background: rgba(255,255,255,.06);
      color: #fff9eb;
      padding: 0 12px;
      font-weight: 780;
    }
    .button.primary {
      background: var(--gold);
      border-color: var(--gold);
      color: var(--ink);
    }
    .workspace {
      display: grid;
      grid-template-columns: minmax(300px, 390px) minmax(0, 1fr);
      height: calc(100vh - 58px);
      min-height: 0;
      overflow: hidden;
    }
    .queue {
      background: var(--panel);
      border-right: 1px solid var(--line);
      min-width: 0;
      min-height: 0;
      display: grid;
      grid-template-rows: auto auto auto minmax(0, 1fr);
    }
    .queue-head {
      padding: 16px;
      border-bottom: 1px solid #edf1ec;
    }
    .queue-title {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: baseline;
      margin-bottom: 12px;
      font-weight: 860;
    }
    .count {
      color: var(--muted);
      font-size: 12px;
      font-weight: 760;
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
    }
    .stat {
      min-width: 0;
      border: 1px solid #e4e9e3;
      border-radius: 8px;
      background: var(--paper);
      padding: 9px 10px;
    }
    .stat-value {
      font-size: 18px;
      font-weight: 880;
      line-height: 1;
      margin-bottom: 4px;
    }
    .stat-label {
      color: var(--muted);
      font-size: 11px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .mode-note {
      padding: 10px 16px;
      border-bottom: 1px solid #edf1ec;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.4;
    }
    .filters {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 6px;
      padding: 10px 16px;
      border-bottom: 1px solid #edf1ec;
      min-height: 56px;
    }
    .filter {
      flex: 0 0 auto;
      border: 1px solid #d7dfd5;
      border-radius: 999px;
      background: var(--paper);
      color: #415247;
      padding: 6px 10px;
      font-size: 11px;
      font-weight: 800;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 30px;
    }
    .filter.active {
      background: var(--green);
      border-color: var(--green);
      color: #fff9eb;
    }
    .private-only-filter { display: none; }
    .sid-unlocked .private-only-filter { display: inline-flex; }
    .list {
      overflow: auto;
      min-height: 0;
    }
    .item {
      width: 100%;
      border: 0;
      border-bottom: 1px solid #edf1ec;
      background: #fff;
      text-align: left;
      padding: 14px 16px;
    }
    .item:hover { background: #fbfcf8; }
    .item.selected {
      background: #f4f8f1;
      box-shadow: inset 4px 0 0 var(--green);
    }
    .item-top {
      display: flex;
      gap: 10px;
      justify-content: space-between;
      align-items: start;
      margin-bottom: 6px;
    }
    .item-title {
      color: var(--ink);
      font-size: 13px;
      font-weight: 820;
      line-height: 1.28;
    }
    .pill {
      flex: 0 0 auto;
      border-radius: 999px;
      padding: 4px 8px;
      font-size: 10px;
      font-weight: 860;
      text-transform: uppercase;
      letter-spacing: .02em;
    }
    .pill.strong { background: var(--green-soft); color: #176236; }
    .pill.review { background: var(--amber-soft); color: #755300; }
    .pill.weak { background: var(--red-soft); color: #8c332b; }
    .item-meta {
      color: var(--muted);
      font-size: 11px;
      line-height: 1.4;
    }
    .item-evidence {
      color: #4c5b52;
      font-size: 11px;
      margin-top: 7px;
    }
    .content {
      min-width: 0;
      min-height: 0;
      overflow: auto;
    }
    .detail {
      max-width: 1040px;
      margin: 0 auto;
      padding: 24px;
    }
    .hero {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: var(--shadow);
      overflow: hidden;
    }
    .hero-main {
      padding: 22px;
    }
    .breadcrumb {
      color: var(--muted);
      font-size: 12px;
      margin-bottom: 10px;
    }
    .headline {
      font-size: clamp(24px, 3vw, 36px);
      line-height: 1.05;
      font-weight: 900;
      max-width: 820px;
      margin-bottom: 12px;
    }
    .summary {
      color: #3c4a42;
      font-size: 15px;
      line-height: 1.55;
      max-width: 860px;
    }
    .hero-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 18px;
    }
    .inline-action {
      border: 1px solid #d4ddd2;
      border-radius: 8px;
      background: var(--paper);
      color: #24352b;
      padding: 9px 12px;
      font-size: 12px;
      font-weight: 820;
      text-decoration: none;
    }
    .inline-action.primary {
      background: var(--green);
      border-color: var(--green);
      color: #fff9eb;
    }
    .private-strip {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 1px;
      background: #e5eae4;
      border-top: 1px solid #e5eae4;
    }
    .private-cell {
      min-width: 0;
      background: #fbfcf8;
      padding: 13px 16px;
    }
    .cell-label {
      color: var(--faint);
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: .04em;
      font-weight: 820;
      margin-bottom: 5px;
    }
    .cell-value {
      font-size: 13px;
      font-weight: 830;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .body-grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 300px;
      gap: 16px;
      margin-top: 16px;
      align-items: start;
    }
    .panel {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      overflow: hidden;
    }
    .panel + .panel { margin-top: 12px; }
    .panel-head {
      padding: 12px 14px;
      border-bottom: 1px solid #edf1ec;
      background: var(--paper);
      color: var(--green);
      font-size: 12px;
      font-weight: 860;
    }
    .panel-body {
      padding: 14px;
      color: #34423a;
      font-size: 13px;
      line-height: 1.55;
    }
    .markdown h1, .markdown h2, .markdown h3 {
      color: var(--ink);
      line-height: 1.22;
    }
    .markdown h1 { font-size: 22px; }
    .markdown h2 { font-size: 17px; margin-top: 20px; }
    .markdown h3 { font-size: 14px; margin-top: 16px; }
    .markdown p, .markdown li { color: #34423a; }
    .markdown ul { padding-left: 20px; }
    .markdown pre {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      background: #f6f7f3;
      border: 1px solid #e1e6df;
      border-radius: 8px;
      padding: 12px;
      font-size: 12px;
    }
    .side { display: grid; gap: 12px; }
    .row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 10px;
      align-items: center;
      padding: 9px 0;
      border-bottom: 1px solid #edf1ec;
    }
    .row:last-child { border-bottom: 0; }
    .row-label {
      color: #43534a;
      font-size: 12px;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .badge {
      border-radius: 6px;
      background: #edf2ec;
      color: #405146;
      padding: 4px 7px;
      font-size: 10px;
      font-weight: 850;
    }
    details {
      border-top: 1px solid #edf1ec;
      padding: 12px 14px;
    }
    details:first-of-type { border-top: 0; }
    summary {
      color: var(--green);
      font-size: 12px;
      font-weight: 860;
      cursor: pointer;
    }
    .details-content {
      margin-top: 12px;
      color: #34423a;
      font-size: 13px;
      line-height: 1.55;
    }
    .empty {
      margin: 28px;
      padding: 36px;
      border: 1px dashed #cad5cc;
      border-radius: 8px;
      color: var(--muted);
      text-align: center;
      background: rgba(255,255,255,.55);
    }
    .loading-list {
      padding: 14px 16px;
      display: grid;
      gap: 12px;
    }
    .skeleton {
      border-radius: 8px;
      background: linear-gradient(90deg, #edf2ec 0%, #f7f8f3 48%, #edf2ec 100%);
      background-size: 220% 100%;
      animation: shimmer 1.1s linear infinite;
    }
    .skeleton.item-line { height: 74px; }
    .skeleton.detail-line { height: 18px; margin: 10px 0; }
    @keyframes shimmer {
      from { background-position: 100% 0; }
      to { background-position: -120% 0; }
    }
    .toast {
      position: fixed;
      right: 18px;
      bottom: 18px;
      background: var(--ink);
      color: #fff9eb;
      border-radius: 8px;
      padding: 10px 12px;
      font-size: 13px;
      display: none;
    }
    @media (max-width: 980px) {
      .topbar {
        grid-template-columns: 1fr auto;
      }
      .search {
        grid-column: 1 / -1;
        grid-row: 2;
        margin-bottom: 10px;
      }
      .app { grid-template-rows: auto 1fr; }
      .workspace { grid-template-columns: 1fr; }
      .queue {
        border-right: 0;
        border-bottom: 1px solid var(--line);
        max-height: 430px;
      }
      .body-grid { grid-template-columns: 1fr; }
      .private-strip { grid-template-columns: 1fr; }
    }
    @media (max-width: 560px) {
      .topbar { padding: 12px; }
      .logo { min-width: 0; }
      .top-actions { gap: 6px; }
      .button { padding: 0 9px; }
      .detail { padding: 14px; }
      .hero-main { padding: 18px; }
      .stats { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div id="dashboard-root" class="app">
    <header class="topbar">
      <div class="logo"><div class="mark">TR</div><div>Tech Radar</div></div>
      <input id="search" class="search" placeholder="Search findings, tools, sources, or project fit">
      <div class="top-actions">
        <button id="refresh" class="button" title="Refresh findings">Refresh</button>
        <button id="unlock" class="button">Unlock Sid view</button>
        <button id="add-url" class="button primary">Add URL</button>
      </div>
    </header>
    <div class="workspace">
      <aside class="queue">
        <div class="queue-head">
          <div class="queue-title"><span>Findings</span><span id="count" class="count">0 total</span></div>
          <div class="stats" aria-label="Finding quality summary">
            <div class="stat"><div id="strong-count" class="stat-value">0</div><div class="stat-label">Strong</div></div>
            <div class="stat"><div id="review-count" class="stat-value">0</div><div class="stat-label">Review</div></div>
            <div class="stat"><div id="weak-count" class="stat-value">0</div><div class="stat-label">Weak</div></div>
          </div>
        </div>
        <div id="mode-note" class="mode-note">Public research is open. Unlock Sid view only when you want project fit and next actions.</div>
        <div class="filters" aria-label="Filter findings">
          <button class="filter active" data-filter="all">All</button>
          <button class="filter" data-filter="strong">Strong</button>
          <button class="filter" data-filter="review">Review</button>
          <button class="filter" data-filter="weak">Weak</button>
          <button class="filter" data-filter="repo">Repo/docs</button>
          <button class="filter private-only-filter" data-filter="project">Project fit</button>
          <button class="filter" data-filter="ocr">OCR</button>
        </div>
        <div id="finding-list" class="list"></div>
      </aside>
      <main id="detail" class="content"></main>
    </div>
  </div>
  <div id="toast" class="toast"></div>
  <script>
    window.__RUNS__ = ${JSON.stringify(runs)};
    const state = { findings: [], selectedId: null, detail: null, query: "", filter: "all", privateUnlocked: false, requestSeq: 0, loading: true };
    const token = new URLSearchParams(location.search).get("token") || "";
    state.privateUnlocked = Boolean(token);
    const $ = (id) => document.getElementById(id);

    function requestHeaders() {
      const currentToken = new URLSearchParams(location.search).get("token") || "";
      return currentToken ? { Authorization: "Bearer " + currentToken } : {};
    }

    async function syncSession() {
      const res = await fetch("/api/session", { headers: requestHeaders(), credentials: "same-origin" });
      if (!res.ok) return;
      const session = await res.json();
      state.privateUnlocked = Boolean(session.privateUnlocked);
      updateStats();
    }

    function escapeHtml(value) {
      return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
    }

    function evidenceText(f) {
      const bits = [];
      if (f.evidence.caption) bits.push("caption");
      if (f.evidence.transcript) bits.push("transcript");
      if (f.evidence.ocr) bits.push("OCR");
      if (f.evidence.repo) bits.push("repo");
      if (f.evidence.docs) bits.push("docs");
      return bits.join(" + ") || "metadata only";
    }

    function evidenceBadge(value, yes = "yes", no = "not captured") {
      return value ? yes : no;
    }

    function matchesQuery(f) {
      const q = state.query.trim().toLowerCase();
      if (!q) return true;
      return [
        f.title,
        f.summary,
        f.targetProject,
        f.source.platform,
        f.verdict,
        f.recommendedAction,
        ...(f.tags || []),
      ].filter(Boolean).join(" ").toLowerCase().includes(q);
    }

    function matchesFilter(f) {
      if (state.filter === "strong") return f.quality.level === "strong";
      if (state.filter === "review") return f.quality.level === "review";
      if (state.filter === "weak") return f.quality.level === "weak";
      if (state.filter === "repo") return f.evidence.repo || f.evidence.docs;
      if (state.filter === "project") return state.privateUnlocked && f.targetProject && f.targetProject !== "none" && f.targetProject !== "unknown";
      if (state.filter === "ocr") return f.evidence.ocr;
      return true;
    }

    function visibleFindings() {
      return state.findings.filter((finding) => matchesFilter(finding) && matchesQuery(finding));
    }

    function selectFirstVisibleIfNeeded() {
      const findings = visibleFindings();
      if (!findings.some((finding) => finding.id === state.selectedId)) {
        state.selectedId = findings[0]?.id || null;
        state.detail = null;
      }
      return findings;
    }

    function showToast(message) {
      const el = $("toast");
      el.textContent = message;
      el.style.display = "block";
      setTimeout(() => { el.style.display = "none"; }, 2200);
    }

    function updateStats() {
      const counts = { strong: 0, review: 0, weak: 0 };
      for (const finding of state.findings) counts[finding.quality.level] += 1;
      $("strong-count").textContent = counts.strong;
      $("review-count").textContent = counts.review;
      $("weak-count").textContent = counts.weak;
      $("count").textContent = state.loading ? "Loading" : visibleFindings().length + " of " + state.findings.length;
      $("mode-note").textContent = state.privateUnlocked
        ? "Sid view is unlocked. Project fit and next action are shown inside each finding."
        : "Public research is open. Unlock Sid view only when you want project fit and next actions.";
      $("unlock").textContent = state.privateUnlocked ? "Sid view unlocked" : "Unlock Sid view";
      $("dashboard-root").classList.toggle("sid-unlocked", state.privateUnlocked);
    }

    function renderList() {
      updateStats();
      const list = $("finding-list");
      if (state.loading) {
        list.innerHTML = '<div class="loading-list" aria-label="Loading findings"><div class="skeleton item-line"></div><div class="skeleton item-line"></div><div class="skeleton item-line"></div><div class="skeleton item-line"></div></div>';
        return;
      }
      const findings = selectFirstVisibleIfNeeded();
      if (!findings.length) {
        list.innerHTML = '<div class="empty">No findings match that search.</div>';
        renderDetail();
        return;
      }
      list.innerHTML = findings.map((f) => \`
        <button class="item \${f.id === state.selectedId ? "selected" : ""}" data-id="\${escapeHtml(f.id)}">
          <div class="item-top">
            <div class="item-title">\${escapeHtml(f.title)}</div>
            <div class="pill \${f.quality.level}">\${f.quality.level}</div>
          </div>
          <div class="item-meta">\${escapeHtml(f.saved || "unsaved")} · \${escapeHtml(f.source.platform)}\${state.privateUnlocked && f.targetProject ? " · " + escapeHtml(f.targetProject) : ""}</div>
          <div class="item-evidence">\${escapeHtml(evidenceText(f))}</div>
        </button>\`).join("");
      list.querySelectorAll(".item").forEach((button) => button.addEventListener("click", () => selectFinding(button.dataset.id)));
    }

    function markdownToHtml(markdown) {
      const safe = escapeHtml(markdown || "");
      if (!safe.trim()) return "<p>No detail captured.</p>";
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

    function textAfter(source, marker, untilMarker) {
      const value = source || "";
      const start = value.indexOf(marker);
      if (start < 0) return "";
      const after = value.slice(start + marker.length);
      if (!untilMarker) return after.trim();
      const end = after.indexOf(untilMarker);
      return (end >= 0 ? after.slice(0, end) : after).trim();
    }

    function extractionDetails(d) {
      const shown = d.sections.shown || "";
      const transcript = textAfter(shown, "Key claims from transcript:", "On-screen text / OCR:");
      const ocr = textAfter(shown, "On-screen text / OCR:");
      const caption = textAfter(shown, "> Caption:", "Key claims from transcript:");
      const blocks = [];
      if (caption) blocks.push(\`<details><summary>Caption</summary><div class="details-content markdown">\${markdownToHtml(caption)}</div></details>\`);
      if (transcript) blocks.push(\`<details><summary>Transcript</summary><div class="details-content markdown">\${markdownToHtml(transcript)}</div></details>\`);
      if (ocr) blocks.push(\`<details><summary>OCR text</summary><div class="details-content markdown">\${markdownToHtml(ocr)}</div></details>\`);
      else blocks.push('<details><summary>OCR text</summary><div class="details-content">No on-screen text was captured for this finding.</div></details>');
      blocks.push(\`<details><summary>Full finding markdown</summary><div class="details-content markdown">\${markdownToHtml(d.markdown)}</div></details>\`);
      return blocks.join("");
    }

    function sectionPanel(title, markdown) {
      if (!markdown || !markdown.trim()) return "";
      return '<div class="panel"><div class="panel-head">' + escapeHtml(title) + '</div><div class="panel-body markdown">' + markdownToHtml(markdown) + '</div></div>';
    }

    function privateSummary(f, d) {
      if (!state.privateUnlocked || !f.targetProject) return "";
      return \`
        <div class="private-strip">
          <div class="private-cell"><div class="cell-label">Project</div><div class="cell-value">\${escapeHtml(f.targetProject)}</div></div>
          <div class="private-cell"><div class="cell-label">Decision</div><div class="cell-value">\${escapeHtml(f.recommendedAction)}</div></div>
          <div class="private-cell"><div class="cell-label">Verdict</div><div class="cell-value">\${escapeHtml(f.verdict)}</div></div>
        </div>\`;
    }

    function renderDetail() {
      const detail = $("detail");
      if (state.loading) {
        detail.innerHTML = '<div class="detail"><section class="hero"><div class="hero-main"><div class="skeleton detail-line" style="width: 180px"></div><div class="skeleton detail-line" style="height: 54px; width: 72%; max-width: 760px"></div><div class="skeleton detail-line" style="width: 86%"></div><div class="skeleton detail-line" style="width: 64%"></div></div></section></div>';
        return;
      }
      const d = state.detail;
      if (!d) {
        detail.innerHTML = '<div class="empty">Select a finding to read the research.</div>';
        return;
      }
      const f = d.finding;
      const personal = state.privateUnlocked && f.targetProject;
      const mainSections = [
        sectionPanel("What it is", d.sections.research || d.sections.tldr || f.summary),
        sectionPanel("Links", d.sections.links),
        sectionPanel("How to try it", d.sections.kickstarter),
        personal ? sectionPanel("Fit for Sid", d.sections.fit) : "",
        personal ? sectionPanel("Implementation idea", d.sections.implementation) : "",
        personal ? sectionPanel("Follow-ups", d.sections.followups) : "",
        !state.privateUnlocked ? '<div class="panel"><div class="panel-head">Sid-specific layer</div><div class="panel-body">Unlock when you want to see project fit, recommended action, and implementation notes. The public research above stays open for everyone.</div></div>' : "",
      ].filter(Boolean).join("");
      detail.innerHTML = \`
        <div class="detail">
          <section class="hero">
            <div class="hero-main">
              <div class="breadcrumb">\${personal ? "Sid view" : "Public radar"} / \${escapeHtml(f.source.platform)} / \${escapeHtml(f.quality.level)} signal</div>
              <div class="headline">\${escapeHtml(f.title)}</div>
              <div class="summary">\${escapeHtml(f.summary)}</div>
              <div class="hero-actions">
                \${f.source.url ? '<a class="inline-action primary" href="' + escapeHtml(f.source.url) + '" target="_blank" rel="noopener">Open source</a>' : ""}
                <a class="inline-action" href="https://github.com/Sid10501/ai-memory/blob/master/\${escapeHtml(f.path)}" target="_blank" rel="noopener">Open markdown</a>
                \${state.privateUnlocked ? '<button class="inline-action" data-action="copy-next">Copy next step</button>' : '<button class="inline-action" data-action="unlock">Unlock Sid fit</button>'}
              </div>
            </div>
            \${privateSummary(f, d)}
          </section>
          <section class="body-grid">
            <div>
              \${mainSections}
              <div class="panel"><div class="panel-head">Raw extraction</div>\${extractionDetails(d)}</div>
            </div>
            <aside class="side">
              <div class="panel"><div class="panel-head">Source check</div><div class="panel-body">
                <div class="row"><div class="row-label">Confidence</div><div class="badge">\${f.quality.score}/100</div></div>
                <div class="row"><div class="row-label">Caption</div><div class="badge">\${evidenceBadge(f.evidence.caption)}</div></div>
                <div class="row"><div class="row-label">Transcript</div><div class="badge">\${evidenceBadge(f.evidence.transcript)}</div></div>
                <div class="row"><div class="row-label">OCR</div><div class="badge">\${evidenceBadge(f.evidence.ocr, "captured", "not captured")}</div></div>
                <div class="row"><div class="row-label">Repo or docs</div><div class="badge">\${evidenceBadge(f.evidence.repo || f.evidence.docs)}</div></div>
              </div></div>
              <div class="panel"><div class="panel-head">Why surfaced</div><div class="panel-body">\${escapeHtml(f.quality.reasons.join(", ") || "Needs manual review.")}</div></div>
            </aside>
          </section>
        </div>\`;
      detail.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => {
        if (button.dataset.action === "unlock") unlockPrivateView();
        if (button.dataset.action === "copy-next") {
          const text = nextTaskText(f);
          navigator.clipboard?.writeText(text).then(() => showToast("Next step copied."), () => showToast(text));
        }
      }));
    }

    function nextTaskText(f) {
      if (f.recommendedAction === "Retry") return "Retry extraction or mark as low-confidence if the source is blocked.";
      if (f.recommendedAction === "Skip") return "Skip unless a real project pain appears.";
      if (f.recommendedAction === "Create task") return "Create a small scoped task in " + f.targetProject + " using this finding.";
      return "Review source evidence, then decide whether this belongs in backlog or should be skipped.";
    }

    async function selectFinding(id) {
      state.selectedId = id;
      const requestId = ++state.requestSeq;
      renderList();
      const path = state.privateUnlocked ? "/api/findings/" : "/api/public/findings/";
      const res = await fetch(path + encodeURIComponent(id), { headers: state.privateUnlocked ? requestHeaders() : {}, credentials: "same-origin" });
      if (requestId !== state.requestSeq || state.selectedId !== id) return;
      if (!res.ok) {
        showToast("Could not load finding.");
        return;
      }
      state.detail = await res.json();
      if (requestId !== state.requestSeq || state.selectedId !== id) return;
      renderDetail();
    }

    async function loadFindings() {
      state.loading = true;
      renderList();
      renderDetail();
      const res = await fetch(state.privateUnlocked ? "/api/findings" : "/api/public/findings", { headers: state.privateUnlocked ? requestHeaders() : {}, credentials: "same-origin" });
      if (!res.ok) {
        state.loading = false;
        $("finding-list").innerHTML = '<div class="empty">Could not load findings.</div>';
        return;
      }
      const body = await res.json();
      state.findings = body.findings || [];
      state.loading = false;
      selectFirstVisibleIfNeeded();
      renderList();
      if (state.selectedId) await selectFinding(state.selectedId);
      else renderDetail();
    }

    $("search").addEventListener("input", (event) => {
      state.query = event.target.value;
      const previousId = state.selectedId;
      renderList();
      if (state.selectedId && state.selectedId !== previousId) selectFinding(state.selectedId);
    });
    document.querySelectorAll(".filter").forEach((button) => button.addEventListener("click", () => {
      document.querySelectorAll(".filter").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      state.filter = button.dataset.filter || "all";
      const previousId = state.selectedId;
      renderList();
      if (state.selectedId && state.selectedId !== previousId) selectFinding(state.selectedId);
    }));
    $("refresh").addEventListener("click", () => loadFindings());

    async function unlockPrivateView() {
      if (state.privateUnlocked) return true;
      const password = prompt("Enter password to unlock Sid-specific project fit and actions");
      if (!password) return false;
      const res = await fetch("/api/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        showToast("Password did not unlock Sid view.");
        return false;
      }
      state.privateUnlocked = true;
      updateStats();
      showToast("Sid view unlocked.");
      await loadFindings();
      return true;
    }

    $("unlock").addEventListener("click", () => unlockPrivateView());
    $("add-url").addEventListener("click", async () => {
      if (!state.privateUnlocked) {
        const unlocked = await unlockPrivateView();
        if (!unlocked) return;
      }
      const url = prompt("Paste an Instagram, TikTok, YouTube, GitHub, or article URL");
      if (!url) return;
      const res = await fetch("/runs", { method: "POST", headers: { ...requestHeaders(), "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ url }) });
      showToast(res.ok ? "Queued for research." : "Could not queue URL.");
    });

    renderList();
    renderDetail();
    syncSession().finally(() => loadFindings());
    if ((window.__RUNS__ || []).some((r) => r.status === "running" || r.status === "pending")) {
      setTimeout(loadFindings, 8000);
    }
  </script>
</body>
</html>`;
