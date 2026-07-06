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
      display: inline-grid;
      place-items: center;
      white-space: nowrap;
    }
    .button.primary {
      background: var(--gold);
      border-color: var(--gold);
      color: var(--ink);
    }
    .short-label { display: none; }
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
      grid-template-rows: auto auto auto auto minmax(0, 1fr);
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
    .batch-health {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 6px;
      padding: 10px 16px;
      border-bottom: 1px solid #edf1ec;
      background: #fbfcf8;
    }
    .health-chip {
      min-width: 0;
      color: #314138;
      background: #f7f8f3;
      border: 1px solid #dfe7dd;
      border-radius: 8px;
      padding: 7px 8px;
      font-size: 11px;
      font-weight: 800;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
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
    .filter[disabled] {
      opacity: .45;
      cursor: not-allowed;
    }
    .filter span {
      color: inherit;
      opacity: .72;
      margin-left: 3px;
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
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      margin-top: 7px;
    }
    .evidence-chip {
      color: #405146;
      background: #edf2ec;
      border: 1px solid #dfe7dd;
      border-radius: 999px;
      padding: 3px 6px;
      font-size: 10px;
      font-weight: 820;
    }
    .evidence-chip.muted {
      color: var(--muted);
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
    .mobile-detail-bar {
      display: none;
    }
    .mobile-back {
      border: 1px solid #d4ddd2;
      border-radius: 8px;
      background: var(--paper);
      color: #24352b;
      padding: 8px 10px;
      font-size: 12px;
      font-weight: 840;
    }
    .mobile-detail-context {
      min-width: 0;
      display: flex;
      gap: 8px;
      color: var(--muted);
      font-size: 11px;
      font-weight: 780;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
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
      html,
      body {
        height: 100dvh;
        overflow: hidden;
      }
      .app {
        height: 100dvh;
        grid-template-rows: auto minmax(0, 1fr);
      }
      .topbar {
        grid-template-columns: minmax(0, auto) minmax(0, 1fr);
        gap: 8px;
        padding: 10px 12px;
      }
      .logo {
        min-width: 0;
        gap: 8px;
      }
      .mark {
        width: 28px;
        height: 28px;
        border-radius: 7px;
      }
      .top-actions {
        min-width: 0;
        width: 100%;
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 6px;
      }
      .button {
        min-width: 0;
        width: 100%;
        height: 32px;
        padding: 0 7px;
        font-size: 11px;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .wide-label { display: none; }
      .short-label { display: inline; }
      .search {
        grid-column: 1 / -1;
        grid-row: 2;
        height: 34px;
      }
      .workspace {
        grid-template-columns: 1fr;
        height: 100%;
        min-height: 0;
        overflow: hidden;
      }
      .queue {
        height: 100%;
        max-height: none;
        min-height: 0;
        border-right: 0;
        border-bottom: 0;
        grid-template-rows: auto auto auto auto minmax(0, 1fr);
      }
      .content {
        display: none;
        height: 100%;
        min-height: 0;
        overflow: auto;
      }
      .mobile-detail-open .queue { display: none; }
      .mobile-detail-open .content { display: block; }
      .queue-head {
        padding: 10px 12px;
      }
      .queue-title {
        margin-bottom: 8px;
      }
      .stats {
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 6px;
      }
      .stat {
        padding: 7px 8px;
        border-radius: 7px;
      }
      .stat-value {
        font-size: 15px;
        margin-bottom: 2px;
      }
      .mode-note {
        padding: 8px 12px;
        font-size: 11px;
      }
      .batch-health {
        grid-template-columns: repeat(4, max-content);
        overflow-x: auto;
        padding: 8px 12px;
        gap: 6px;
      }
      .health-chip {
        padding: 6px 7px;
      }
      .filters {
        flex-wrap: nowrap;
        overflow-x: auto;
        min-height: 44px;
        padding: 8px 12px;
        scrollbar-width: none;
      }
      .filters::-webkit-scrollbar {
        display: none;
      }
      .filter {
        min-height: 28px;
        padding: 5px 9px;
      }
      .list {
        min-height: 0;
        overflow: auto;
        -webkit-overflow-scrolling: touch;
      }
      .item {
        padding: 12px;
      }
      .item-title {
        font-size: 12px;
      }
      .item-evidence {
        margin-top: 6px;
      }
      .detail {
        max-width: none;
        min-height: 100%;
        padding: 0;
      }
      .mobile-detail-bar {
        position: sticky;
        top: 0;
        z-index: 5;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 10px 12px;
        border-bottom: 1px solid var(--line);
        background: rgba(255, 255, 255, .96);
        backdrop-filter: blur(10px);
      }
      .hero {
        border-radius: 0;
        border-left: 0;
        border-right: 0;
        box-shadow: none;
      }
      .hero-main {
        padding: 16px 14px;
      }
      .headline {
        font-size: 22px;
        line-height: 1.12;
      }
      .summary {
        font-size: 14px;
      }
      .hero-actions {
        gap: 6px;
      }
      .inline-action {
        padding: 8px 10px;
      }
      .body-grid {
        grid-template-columns: 1fr;
        gap: 10px;
        margin-top: 10px;
        padding: 0 10px 14px;
      }
      .panel {
        border-radius: 7px;
      }
      .panel-head {
        padding: 10px 12px;
      }
      .panel-body {
        padding: 12px;
      }
      .side {
        gap: 10px;
      }
      .private-strip { grid-template-columns: 1fr; }
    }
    @media (max-width: 560px) {
      .logo > div:last-child {
        max-width: 96px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .top-actions .button {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .stats {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
    }
    @media (max-width: 380px) {
      .logo > div:last-child {
        display: none;
      }
      .topbar {
        grid-template-columns: 28px minmax(0, 1fr);
      }
    }
  </style>
</head>
<body>
  <div id="dashboard-root" class="app">
    <header class="topbar">
      <div class="logo"><div class="mark">TR</div><div>Tech Radar</div></div>
      <input id="search" class="search" placeholder="Search findings, tools, sources, or project fit">
      <div class="top-actions">
        <button id="release-notes" class="button"><span class="wide-label">Release notes</span><span class="short-label">Notes</span></button>
        <button id="refresh" class="button" title="Refresh findings"><span class="wide-label">Refresh</span><span class="short-label">Refresh</span></button>
        <button id="unlock" class="button"><span class="wide-label">Unlock</span><span class="short-label">Unlock</span></button>
        <button id="add-url" class="button primary"><span class="wide-label">Add URL</span><span class="short-label">Add</span></button>
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
        <div id="batch-health" class="batch-health" aria-label="Latest batch health"></div>
        <div class="filters" aria-label="Filter findings">
          <button class="filter active" data-filter="all">All <span data-count-for="all">0</span></button>
          <button class="filter" data-filter="strong">Strong <span data-count-for="strong">0</span></button>
          <button class="filter" data-filter="review">Review <span data-count-for="review">0</span></button>
          <button class="filter" data-filter="weak">Weak <span data-count-for="weak">0</span></button>
          <button class="filter" data-filter="repo">Repo/docs <span data-count-for="repo">0</span></button>
          <button class="filter" data-filter="enrich">Needs enrichment <span data-count-for="enrich">0</span></button>
          <button class="filter" data-filter="ocr">OCR <span data-count-for="ocr">0</span></button>
          <button class="filter private-only-filter" data-filter="project">Project fit <span data-count-for="project">0</span></button>
          <button class="filter private-only-filter" data-filter="skip">Skip <span data-count-for="skip">0</span></button>
        </div>
        <div id="finding-list" class="list"></div>
      </aside>
      <main id="detail" class="content"></main>
    </div>
  </div>
  <div id="toast" class="toast"></div>
  <script>
    window.__RUNS__ = ${JSON.stringify(runs)};
    const state = { findings: [], selectedId: null, detail: null, query: "", filter: "all", privateUnlocked: false, requestSeq: 0, loading: true, detailCache: new Map(), audit: null, filterCounts: {}, mobileDetailOpen: false, view: "findings", releaseNotes: [], releaseNotesLoading: false };
    const token = new URLSearchParams(location.search).get("token") || "";
    state.privateUnlocked = Boolean(token);
    const $ = (id) => document.getElementById(id);

    function requestHeaders() {
      const currentToken = new URLSearchParams(location.search).get("token") || "";
      return currentToken ? { Authorization: "Bearer " + currentToken } : {};
    }

    function isMobileViewport() {
      return window.matchMedia("(max-width: 980px)").matches;
    }

    function setMobileDetailOpen(open) {
      state.mobileDetailOpen = Boolean(open);
      $("dashboard-root").classList.toggle("mobile-detail-open", state.mobileDetailOpen);
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

    function evidenceChips(f) {
      const items = [
        ["caption", f.evidence.caption],
        ["transcript", f.evidence.transcript],
        ["OCR", f.evidence.ocr],
        ["repo", f.evidence.repo],
        ["docs", f.evidence.docs],
      ];
      return items
        .filter(([, present]) => present)
        .map(([label]) => '<span class="evidence-chip">' + escapeHtml(label) + '</span>')
        .join("") || '<span class="evidence-chip muted">metadata only</span>';
    }

    function evidenceBadge(value, yes = "yes", no = "not captured") {
      return value ? yes : no;
    }

    function isSourceBackedPublicArtifact(f) {
      return f.source?.classification === "public_artifact";
    }

    function hasArtifactEvidence(f) {
      return f.evidence.repo || f.evidence.docs || isSourceBackedPublicArtifact(f);
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
      if (state.filter === "repo") return hasArtifactEvidence(f);
      if (state.filter === "enrich") return !(state.privateUnlocked && f.recommendedAction === "Skip") && (f.quality.level === "weak" || !hasArtifactEvidence(f));
      if (state.filter === "project") return state.privateUnlocked && f.targetProject && f.targetProject !== "none" && f.targetProject !== "unknown";
      if (state.filter === "ocr") return f.evidence.ocr;
      if (state.filter === "skip") return state.privateUnlocked && f.recommendedAction === "Skip";
      return true;
    }

    function visibleFindings() {
      return state.findings.filter((finding) => matchesFilter(finding) && matchesQuery(finding));
    }

    function resetFilterToAll() {
      state.filter = "all";
      document.querySelectorAll(".filter").forEach((item) => item.classList.remove("active"));
      document.querySelector('[data-filter="all"]')?.classList.add("active");
    }

    function filterLabel() {
      const labels = {
        strong: "Strong",
        review: "Review",
        weak: "Weak",
        repo: "Repo/docs",
        enrich: "Needs enrichment",
        project: "Project fit",
        ocr: "OCR",
        skip: "Skip",
      };
      return labels[state.filter] || "All";
    }

    function emptyListMessage() {
      const q = state.query.trim();
      if (q && state.filter !== "all") {
        return "No " + filterLabel().toLowerCase() + " findings match “" + escapeHtml(q) + "”. Try All or clear the search.";
      }
      if (q) return "No findings match “" + escapeHtml(q) + "”.";
      if (state.filter !== "all") return "No " + filterLabel().toLowerCase() + " findings yet.";
      return "No findings loaded yet.";
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
      document.querySelectorAll("[data-count-for]").forEach((span) => {
        const key = span.dataset.countFor;
        span.textContent = state.filterCounts[key] ?? 0;
      });
      document.querySelectorAll(".filter").forEach((button) => {
        const key = button.dataset.filter || "all";
        const count = state.filterCounts[key] ?? 0;
        button.disabled = key !== "all" && count === 0;
        if (button.disabled && button.classList.contains("active")) {
          button.classList.remove("active");
          state.filter = "all";
          document.querySelector('[data-filter="all"]')?.classList.add("active");
        }
      });
      const audit = state.audit;
      const enrichmentReasons = audit?.enrichmentReasons || {};
      $("batch-health").innerHTML = audit
        ? [
            ["Latest", audit.total ?? 0],
            ["Repo/docs", (audit.evidence?.repo ?? 0) + (audit.evidence?.docs ?? 0)],
            ["Transcript", audit.evidence?.transcript ?? 0],
            ["Enrich", audit.needsEnrichment ?? 0],
            ["Missing links", enrichmentReasons.missing_repo_or_docs ?? 0],
            ["Source uncertainty", enrichmentReasons.source_uncertainty ?? 0],
          ].map(([label, value]) => '<div class="health-chip">' + escapeHtml(label) + ': ' + escapeHtml(value) + '</div>').join("")
        : "";
      $("count").textContent = state.loading ? "Loading" : visibleFindings().length + " of " + state.findings.length;
      $("mode-note").textContent = state.privateUnlocked
        ? "Sid view is unlocked. Project fit and next action are shown inside each finding."
        : "Public research is open. Unlock Sid view only when you want project fit and next actions.";
      $("unlock").querySelector(".wide-label").textContent = state.privateUnlocked ? "Unlocked" : "Unlock";
      $("unlock").querySelector(".short-label").textContent = state.privateUnlocked ? "Sid" : "Unlock";
      $("dashboard-root").classList.toggle("sid-unlocked", state.privateUnlocked);
    }

    async function loadAudit() {
      const path = state.privateUnlocked ? "/api/audit" : "/api/public/audit";
      try {
        const res = await fetch(path, { headers: state.privateUnlocked ? requestHeaders() : {}, credentials: "same-origin" });
        if (!res.ok) {
          state.audit = null;
          state.filterCounts = {};
          return;
        }
        const body = await res.json();
        state.audit = body.audit || null;
        state.filterCounts = body.filters || {};
      } catch {
        state.audit = null;
        state.filterCounts = {};
      }
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
        list.innerHTML = '<div class="empty">' + emptyListMessage() + '</div>';
        renderDetail();
        return;
      }
      list.innerHTML = findings.map((f) => \`
        <button class="item \${f.id === state.selectedId ? "selected" : ""}" data-id="\${escapeHtml(f.id)}" data-mobile-primary="finding">
          <div class="item-top">
            <div class="item-title">\${escapeHtml(f.title)}</div>
            <div class="pill \${f.quality.level}">\${f.quality.level}</div>
          </div>
          <div class="item-meta">\${escapeHtml(f.saved || "unsaved")} · \${escapeHtml(f.source.platform)} · \${escapeHtml(f.quality.score)}/100\${state.privateUnlocked && f.targetProject ? " · " + escapeHtml(f.targetProject) : ""}</div>
          <div class="item-evidence">\${evidenceChips(f)}</div>
        </button>\`).join("");
      list.querySelectorAll(".item").forEach((button) => button.addEventListener("click", () => selectFinding(button.dataset.id, { openDetail: true })));
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
      const transcript = textAfterAny(shown, "Key claims from transcript:", ["Learning chapters:", "On-screen text / OCR:", "Extraction path:", "Source links found:", "Top comments:", "Extraction warnings:"]);
      const chapters = textAfterAny(shown, "Learning chapters:", ["On-screen text / OCR:", "Extraction path:", "Source links found:", "Top comments:", "Extraction warnings:"]);
      const ocr = textAfterAny(shown, "On-screen text / OCR:", ["Extraction path:", "Source links found:", "Top comments:", "Extraction warnings:"]);
      const extractionPath = textAfterAny(shown, "Extraction path:", ["Source links found:", "Top comments:", "Extraction warnings:"]);
      const sourceLinks = textAfterAny(shown, "Source links found:", ["Top comments:", "Extraction warnings:"]);
      const comments = textAfterAny(shown, "Top comments:", ["Extraction warnings:"]);
      const caption = textAfter(shown, "> Caption:", "Key claims from transcript:");
      const extractionWarnings = d.sections.extractionWarnings || textAfter(shown, "Extraction warnings:");
      const blocks = [];
      if (caption) blocks.push(\`<details><summary>Caption</summary><div class="details-content markdown">\${markdownToHtml(caption)}</div></details>\`);
      if (transcript) blocks.push(\`<details><summary>Transcript</summary><div class="details-content markdown">\${markdownToHtml(transcript)}</div></details>\`);
      if (chapters) blocks.push(\`<details open><summary>Learning chapters</summary><div class="details-content markdown">\${markdownToHtml(chapters)}</div></details>\`);
      if (ocr) blocks.push(\`<details><summary>OCR text</summary><div class="details-content markdown">\${markdownToHtml(ocr)}</div></details>\`);
      else blocks.push('<details><summary>OCR text</summary><div class="details-content">No on-screen text was captured for this finding.</div></details>');
      if (extractionPath) blocks.push(\`<details><summary>Extraction path</summary><div class="details-content markdown">\${markdownToHtml(extractionPath)}</div></details>\`);
      if (sourceLinks) blocks.push(\`<details><summary>Source links</summary><div class="details-content markdown">\${markdownToHtml(sourceLinks)}</div></details>\`);
      if (comments) blocks.push(\`<details><summary>Top comments</summary><div class="details-content markdown">\${markdownToHtml(comments)}</div></details>\`);
      if (extractionWarnings) blocks.push(\`<details open><summary>Extraction warnings</summary><div class="details-content markdown">\${markdownToHtml(extractionWarnings)}</div></details>\`);
      blocks.push(\`<details><summary>Full finding markdown</summary><div class="details-content markdown">\${markdownToHtml(d.markdown)}</div></details>\`);
      return blocks.join("");
    }

    function textAfterAny(source, marker, untilMarkers) {
      const value = source || "";
      const start = value.indexOf(marker);
      if (start < 0) return "";
      const after = value.slice(start + marker.length);
      const indexes = (untilMarkers || []).map((until) => after.indexOf(until)).filter((index) => index >= 0);
      const end = indexes.length ? Math.min(...indexes) : after.length;
      return after.slice(0, end).trim();
    }

    function sectionPanel(title, markdown) {
      if (!markdown || !markdown.trim()) return "";
      return '<div class="panel"><div class="panel-head">' + escapeHtml(title) + '</div><div class="panel-body markdown">' + markdownToHtml(markdown) + '</div></div>';
    }

    function renderReleaseNotes() {
      const detail = $("detail");
      if (state.releaseNotesLoading) {
        detail.innerHTML = '<div class="detail"><section class="hero"><div class="hero-main"><div class="skeleton detail-line" style="width: 180px"></div><div class="skeleton detail-line" style="height: 54px; width: 72%; max-width: 760px"></div><div class="skeleton detail-line" style="width: 86%"></div></div></section></div>';
        return;
      }
      const panels = state.releaseNotes.map((release) => sectionPanel(
        release.date + " - " + release.title,
        release.bodyMarkdown,
      )).join("");
      detail.innerHTML = \`
        <div class="detail">
          <section class="hero">
            <div class="hero-main">
              <div class="breadcrumb">Product loop / Release notes</div>
              <div class="headline">Release notes</div>
              <div class="summary">Improvements shipped into the radar pipeline and dashboard.</div>
              <div class="hero-actions">
                <button class="inline-action primary" data-action="back-findings">Back to findings</button>
              </div>
            </div>
          </section>
          <section class="body-grid">
            <div>\${panels || '<div class="empty">No release notes published yet.</div>'}</div>
          </section>
        </div>\`;
      detail.querySelector("[data-action='back-findings']")?.addEventListener("click", () => {
        state.view = "findings";
        renderDetail();
      });
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
      if (state.view === "release-notes") {
        renderReleaseNotes();
        return;
      }
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
        sectionPanel("Retry history", d.sections.retryHistory),
        !state.privateUnlocked ? '<div class="panel"><div class="panel-head">Sid-specific layer</div><div class="panel-body">Unlock when you want to see project fit, recommended action, and implementation notes. The public research above stays open for everyone.</div></div>' : "",
      ].filter(Boolean).join("");
      detail.innerHTML = \`
        <div class="detail">
          <div class="mobile-detail-bar">
            <button id="mobile-back" class="mobile-back" data-action="mobile-back">Findings</button>
            <div class="mobile-detail-context">
              <span>\${escapeHtml(f.quality.level)} signal</span>
              <span>\${escapeHtml(f.source.platform)}</span>
            </div>
          </div>
          <section class="hero">
            <div class="hero-main">
              <div class="breadcrumb">\${personal ? "Sid view" : "Public radar"} / \${escapeHtml(f.source.platform)} / \${escapeHtml(f.quality.level)} signal</div>
              <div class="headline">\${escapeHtml(f.title)}</div>
              <div class="summary">\${escapeHtml(f.summary)}</div>
              <div class="hero-actions">
                \${f.source.url ? '<a class="inline-action primary" href="' + escapeHtml(f.source.url) + '" target="_blank" rel="noopener">Open source</a>' : ""}
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
        if (button.dataset.action === "mobile-back") setMobileDetailOpen(false);
        if (button.dataset.action === "unlock") unlockPrivateView();
        if (button.dataset.action === "copy-next") {
          const text = nextTaskText(f);
          navigator.clipboard?.writeText(text).then(() => showToast("Next step copied."), () => showToast(text));
        }
      }));
    }

    function detailCacheKey(id) {
      return (state.privateUnlocked ? "private:" : "public:") + id;
    }

    async function fetchFindingDetail(id, requestId) {
      const cacheKey = detailCacheKey(id);
      if (state.detailCache.has(cacheKey)) return state.detailCache.get(cacheKey);
      const path = state.privateUnlocked ? "/api/findings/" : "/api/public/findings/";
      const res = await fetch(path + encodeURIComponent(id), { headers: state.privateUnlocked ? requestHeaders() : {}, credentials: "same-origin" });
      if (requestId !== state.requestSeq || state.selectedId !== id) return null;
      if (!res.ok) {
        showToast("Could not load finding.");
        return null;
      }
      const detail = await res.json();
      state.detailCache.set(cacheKey, detail);
      return detail;
    }

    function prefetchNextFindings() {
      const selectedIndex = visibleFindings().findIndex((finding) => finding.id === state.selectedId);
      const next = visibleFindings().slice(Math.max(0, selectedIndex + 1), selectedIndex + 4);
      for (const finding of next) {
        const cacheKey = detailCacheKey(finding.id);
        if (state.detailCache.has(cacheKey)) continue;
        const path = state.privateUnlocked ? "/api/findings/" : "/api/public/findings/";
        fetch(path + encodeURIComponent(finding.id), { headers: state.privateUnlocked ? requestHeaders() : {}, credentials: "same-origin" })
          .then((res) => res.ok ? res.json() : null)
          .then((detail) => { if (detail) state.detailCache.set(cacheKey, detail); })
          .catch(() => {});
      }
    }

    function nextTaskText(f) {
      if (f.recommendedAction === "Retry") return "Retry extraction or mark as low-confidence if the source is blocked.";
      if (f.recommendedAction === "Skip") return "Skip unless a real project pain appears.";
      if (f.recommendedAction === "Create task") return "Create a small scoped task in " + f.targetProject + " using this finding.";
      return "Review source evidence, then decide whether this belongs in backlog or should be skipped.";
    }

    async function selectFinding(id, options = {}) {
      state.selectedId = id;
      if (options.openDetail && isMobileViewport()) setMobileDetailOpen(true);
      const requestId = ++state.requestSeq;
      renderList();
      const cached = state.detailCache.get(detailCacheKey(id));
      if (cached) {
        state.detail = cached;
        renderDetail();
        prefetchNextFindings();
        return;
      }
      const current = state.findings.find((finding) => finding.id === id);
      if (current) {
        state.detail = { finding: current, sections: { tldr: current.summary, shown: "", research: current.summary, links: "", kickstarter: "", fit: "", implementation: "", followups: "", retryHistory: "", extractionWarnings: "" }, markdown: "" };
        renderDetail();
      }
      const detail = await fetchFindingDetail(id, requestId);
      if (requestId !== state.requestSeq || state.selectedId !== id) return;
      if (detail) {
        state.detail = detail;
        renderDetail();
        prefetchNextFindings();
      }
    }

    async function loadFindings() {
      state.view = "findings";
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
      state.detailCache.clear();
      state.loading = false;
      selectFirstVisibleIfNeeded();
      renderList();
      loadAudit().then(() => renderList());
      if (state.selectedId) await selectFinding(state.selectedId);
      else renderDetail();
    }

    async function loadReleaseNotes() {
      state.view = "release-notes";
      state.releaseNotesLoading = true;
      renderReleaseNotes();
      const res = await fetch("/api/public/release-notes", { credentials: "same-origin" });
      state.releaseNotesLoading = false;
      if (!res.ok) {
        state.releaseNotes = [];
        showToast("Could not load release notes.");
        renderReleaseNotes();
        return;
      }
      const body = await res.json();
      state.releaseNotes = body.releases || [];
      renderReleaseNotes();
    }

    $("search").addEventListener("input", (event) => {
      state.query = event.target.value;
      if (state.query.trim() && state.filter !== "all") resetFilterToAll();
      const previousId = state.selectedId;
      setMobileDetailOpen(false);
      renderList();
      if (state.selectedId && state.selectedId !== previousId) selectFinding(state.selectedId);
    });
    document.querySelectorAll(".filter").forEach((button) => button.addEventListener("click", () => {
      if (button.disabled) return;
      document.querySelectorAll(".filter").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      state.filter = button.dataset.filter || "all";
      const previousId = state.selectedId;
      setMobileDetailOpen(false);
      renderList();
      if (state.selectedId && state.selectedId !== previousId) selectFinding(state.selectedId);
    }));
    $("refresh").addEventListener("click", () => state.view === "release-notes" ? loadReleaseNotes() : loadFindings());
    $("release-notes").addEventListener("click", () => loadReleaseNotes());

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

    window.addEventListener("resize", () => {
      if (!isMobileViewport()) setMobileDetailOpen(false);
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
