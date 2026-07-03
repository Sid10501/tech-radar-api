import fs from "node:fs";
import path from "node:path";

export interface FindingEvidence {
  caption: boolean;
  transcript: boolean;
  ocr: boolean;
  repo: boolean;
  docs: boolean;
}

export interface FindingQuality {
  score: number;
  level: "strong" | "review" | "weak";
  reasons: string[];
}

export interface FindingSummary {
  id: string;
  filename: string;
  path: string;
  title: string;
  saved: string | null;
  tags: string[];
  source: {
    platform: string;
    label: string | null;
    url: string | null;
  };
  targetProject: string;
  verdict: string;
  summary: string;
  evidence: FindingEvidence;
  quality: FindingQuality;
  recommendedAction: "Create task" | "Backlog" | "Skip" | "Retry" | "Review";
}

export type PublicFindingSummary = Omit<FindingSummary, "targetProject" | "verdict" | "recommendedAction"> & {
  isPrivate: false;
};

export interface FindingDetail {
  finding: FindingSummary;
  markdown: string;
  sections: {
    tldr: string;
    shown: string;
    research: string;
    links: string;
    kickstarter: string;
    fit: string;
    implementation: string;
    followups: string;
  };
}

export interface PublicFindingDetail {
  finding: PublicFindingSummary;
  markdown: string;
  sections: {
    tldr: string;
    shown: string;
    research: string;
    links: string;
    kickstarter: string;
  };
}

const DEFAULT_AI_MEMORY_DIR = "/Users/work/Repositories/ai-memory";
const TEMPLATE_SECTION_HEADING =
  /^## (TL;DR|What the post showed|What it actually is|Links|Kickstarter guide|Fit for .+|Implementation Idea|Follow-ups)\s*$/m;
const PRIVATE_PROJECT_REFERENCE =
  /\b(Cross-Tax|StockBot|Finance Assistant|Kalkine Stocks Tracker|tech-radar-api|ai-video)\b/i;

function textBetween(body: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^## ${escaped}\\s*$`, "m").exec(body);
  if (!match) return "";
  const tail = body.slice(match.index + match[0].length);
  const nextHeading = TEMPLATE_SECTION_HEADING.exec(tail);
  return (nextHeading ? tail.slice(0, nextHeading.index) : tail).trim();
}

function stripMarkdown(value: string): string {
  return decodeEntities(value)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_>#-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|amp|quot|apos|lt|gt);/gi, (_match, entity: string) => {
    const key = entity.toLowerCase();
    if (key === "amp") return "&";
    if (key === "quot") return "\"";
    if (key === "apos") return "'";
    if (key === "lt") return "<";
    if (key === "gt") return ">";
    if (key.startsWith("#x")) return String.fromCodePoint(Number.parseInt(key.slice(2), 16));
    if (key.startsWith("#")) return String.fromCodePoint(Number.parseInt(key.slice(1), 10));
    return _match;
  });
}

function normalizeSavedDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const clean = raw.trim();
  if (/^\d{8}$/.test(clean)) {
    return `${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;
  return clean || null;
}

function parseTags(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((tag) => decodeEntities(tag.trim().replace(/^#/, "")))
    .filter((tag) => tag && !/^x[0-9a-f]{2,}$/i.test(tag) && !/^\d+$/.test(tag));
}

function firstUrl(body: string, label: string): string | null {
  const match = body.match(new RegExp(`- ${label}:\\s*(https?://\\S+)`, "i"));
  return match?.[1]?.replace(/[),.]+$/, "") ?? null;
}

function scoreFinding(body: string, evidence: FindingEvidence, targetProject: string, verdict: string): FindingQuality {
  const reasons: string[] = [];
  let score = 20;

  if (evidence.caption) {
    score += 15;
    reasons.push("caption");
  }
  if (evidence.transcript) {
    score += 20;
    reasons.push("transcript");
  }
  if (evidence.ocr) {
    score += 15;
    reasons.push("OCR");
  }
  if (evidence.repo) {
    score += 15;
    reasons.push("repo");
  }
  if (evidence.docs) {
    score += 5;
    reasons.push("docs");
  }
  if (targetProject && targetProject !== "none" && targetProject !== "unknown") {
    score += 10;
    reasons.push("project fit");
  }

  const lower = body.toLowerCase();
  if (lower.includes("no links found") || lower.includes("no confirmed github url") || lower.includes("unverified")) {
    score -= 18;
    reasons.push("source uncertainty");
  }
  if (lower.includes("0 github stars") || lower.includes("github stars: 0")) {
    score -= 10;
    reasons.push("low repo signal");
  }
  if (verdict.includes("#skip")) {
    score -= 25;
    reasons.push("skip verdict");
  }

  score = Math.max(0, Math.min(100, score));
  const level = score >= 80 ? "strong" : score >= 60 ? "review" : "weak";
  return { score, level, reasons };
}

function recommendedAction(quality: FindingQuality, targetProject: string, verdict: string): FindingSummary["recommendedAction"] {
  if (verdict.includes("#skip") || targetProject === "none") return "Skip";
  if (quality.level === "weak") return "Retry";
  if (quality.level === "strong" && targetProject && targetProject !== "unknown") return "Create task";
  if (quality.level === "review") return "Review";
  return "Backlog";
}

function markerText(source: string, marker: string, untilMarkers: string[] = []): string {
  const lower = source.toLowerCase();
  const markerIndex = lower.indexOf(marker.toLowerCase());
  if (markerIndex < 0) return "";
  const afterStart = markerIndex + marker.length;
  const after = source.slice(afterStart);
  const afterLower = lower.slice(afterStart);
  const nextIndexes = untilMarkers
    .map((until) => afterLower.indexOf(until.toLowerCase()))
    .filter((index) => index >= 0);
  const end = nextIndexes.length ? Math.min(...nextIndexes) : after.length;
  return after.slice(0, end).trim();
}

function hasCapturedText(value: string, unavailable: RegExp): boolean {
  const clean = stripMarkdown(value);
  return Boolean(clean && !unavailable.test(clean));
}

function withoutPrivateSections(markdown: string): string {
  const withoutSections = removeTemplateSection(
    removeTemplateSection(removeTemplateSection(markdown, "Fit for .+"), "Implementation Idea"),
    "Follow-ups",
  );
  return withoutPrivateProjectReferences(withoutEmbeddedPrivateDecisionBlocks(withoutSections)).trim();
}

function removeTemplateSection(markdown: string, headingPattern: string): string {
  const match = new RegExp(`^## ${headingPattern}\\s*$`, "m").exec(markdown);
  if (!match) return markdown;
  const before = markdown.slice(0, match.index);
  const tail = markdown.slice(match.index + match[0].length);
  const nextHeading = TEMPLATE_SECTION_HEADING.exec(tail);
  return before + (nextHeading ? tail.slice(nextHeading.index) : "");
}

function withoutEmbeddedPrivateDecisionBlocks(markdown: string): string {
  const lines = markdown.split("\n");
  const kept: string[] = [];
  let dropping = false;

  for (const line of lines) {
    if (!dropping && isPrivateDecisionLine(line)) {
      dropping = true;
      continue;
    }
    if (dropping && TEMPLATE_SECTION_HEADING.test(line)) {
      dropping = false;
    }
    if (!dropping) kept.push(line);
  }

  return kept.join("\n");
}

function isPrivateDecisionLine(line: string): boolean {
  return /^\s*[-*]?\s*(Target project|Verdict):/i.test(line) || /^\s*[-*]\s+.*\bSid\b/i.test(line);
}

function withoutPrivateProjectReferences(markdown: string): string {
  return markdown
    .split(/\n{2,}/)
    .filter((block) => !PRIVATE_PROJECT_REFERENCE.test(block))
    .join("\n\n");
}

function publicQuality(finding: FindingSummary): FindingQuality {
  const hasProjectFit = finding.quality.reasons.includes("project fit");
  const hasSkipVerdict = finding.quality.reasons.includes("skip verdict");
  const score = Math.max(0, Math.min(100, finding.quality.score - (hasProjectFit ? 10 : 0) + (hasSkipVerdict ? 25 : 0)));
  const level = score >= 80 ? "strong" : score >= 60 ? "review" : "weak";
  return {
    score,
    level,
    reasons: finding.quality.reasons.filter((reason) => reason !== "project fit" && reason !== "skip verdict"),
  };
}

export function toPublicFinding(finding: FindingSummary): PublicFindingSummary {
  const { targetProject: _targetProject, verdict: _verdict, recommendedAction: _recommendedAction, ...rest } = finding;
  return {
    ...rest,
    quality: publicQuality(finding),
    isPrivate: false,
  };
}

export function parseFindingMarkdown(filename: string, markdown: string): FindingSummary {
  const title = decodeEntities(markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || filename.replace(/\.md$/, ""));
  const sourceLine = markdown.match(/^\*\*Source:\*\*\s*(.+)$/m)?.[1]?.trim() ?? "";
  const sourceMatch = sourceLine.match(/^([^·\n]+?)(?:\s*·\s*\[([^\]]+)\]\(([^)]+)\))?$/);
  const platform = sourceMatch?.[1]?.trim().toLowerCase() || "unknown";
  const sourceLabel = sourceMatch?.[2] ? decodeEntities(sourceMatch[2].trim()) : null;
  const sourceUrl = sourceMatch?.[3]?.trim() ?? null;
  const saved = normalizeSavedDate(markdown.match(/^\*\*Saved:\*\*\s*(.+)$/m)?.[1]);
  const tags = parseTags(markdown.match(/^\*\*Tags:\*\*\s*(.+)$/m)?.[1]);
  const tldr = textBetween(markdown, "TL;DR");
  const shown = textBetween(markdown, "What the post showed");
  const targetProject = decodeEntities(markdown.match(/^- Target project:\s*(.+)$/m)?.[1]?.trim() || "unknown");
  const verdict = markdown.match(/^- Verdict:\s*`?([^`\n]+)`?/m)?.[1]?.trim() || "unknown";
  const repoUrl = firstUrl(markdown, "Repo");
  const docsUrl = firstUrl(markdown, "Docs");
  const captionText = markerText(shown, "> Caption:", ["Key claims from transcript:", "On-screen text / OCR:"]);
  const transcriptText = markerText(shown, "Key claims from transcript:", ["On-screen text / OCR:"]);
  const ocrText = markerText(shown, "On-screen text / OCR:");
  const evidence: FindingEvidence = {
    caption: hasCapturedText(captionText, /^(none|no caption available)$/i),
    transcript: hasCapturedText(transcriptText, /^[-\s]*(\(no transcript available\)|no transcript available)$/i),
    ocr: hasCapturedText(ocrText, /^[-\s]*(\(no on-screen text available\)|no on-screen text available|not captured)$/i),
    repo: Boolean(repoUrl) || /https?:\/\/github\.com\//i.test(markdown),
    docs: Boolean(docsUrl),
  };
  const quality = scoreFinding(markdown, evidence, targetProject, verdict);
  const summary = stripMarkdown(tldr).slice(0, 420) || "No summary available.";

  return {
    id: filename,
    filename,
    path: `tech-radar/findings/${filename}`,
    title,
    saved,
    tags,
    source: { platform, label: sourceLabel, url: sourceUrl },
    targetProject,
    verdict,
    summary,
    evidence,
    quality,
    recommendedAction: recommendedAction(quality, targetProject, verdict),
  };
}

export function getAiMemoryDir(): string {
  return process.env["AI_MEMORY_LOCAL_DIR"] || DEFAULT_AI_MEMORY_DIR;
}

export function getFindingsDir(aiMemoryDir = getAiMemoryDir()): string {
  return path.join(aiMemoryDir, "tech-radar", "findings");
}

export function listFindings(aiMemoryDir = getAiMemoryDir()): FindingSummary[] {
  const dir = getFindingsDir(aiMemoryDir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(".md") && file !== "_template.md")
    .map((file) => parseFindingMarkdown(file, fs.readFileSync(path.join(dir, file), "utf8")))
    .sort((a, b) => {
      const aDate = a.saved ?? "";
      const bDate = b.saved ?? "";
      if (aDate !== bDate) return bDate.localeCompare(aDate);
      return a.title.localeCompare(b.title);
    });
}

export function listPublicFindings(aiMemoryDir = getAiMemoryDir()): PublicFindingSummary[] {
  return listFindings(aiMemoryDir).map(toPublicFinding);
}

export function getFindingDetail(filename: string, aiMemoryDir = getAiMemoryDir()): FindingDetail | null {
  const safeName = path.basename(filename);
  if (safeName !== filename || !safeName.endsWith(".md")) return null;
  const fullPath = path.join(getFindingsDir(aiMemoryDir), safeName);
  if (!fs.existsSync(fullPath)) return null;
  const markdown = fs.readFileSync(fullPath, "utf8");
  return {
    finding: parseFindingMarkdown(safeName, markdown),
    markdown,
    sections: {
      tldr: textBetween(markdown, "TL;DR"),
      shown: textBetween(markdown, "What the post showed"),
      research: textBetween(markdown, "What it actually is"),
      links: textBetween(markdown, "Links"),
      kickstarter: textBetween(markdown, "Kickstarter guide"),
      fit: textBetween(markdown, "Fit for Sid"),
      implementation: textBetween(markdown, "Implementation Idea"),
      followups: textBetween(markdown, "Follow-ups"),
    },
  };
}

export function getPublicFindingDetail(filename: string, aiMemoryDir = getAiMemoryDir()): PublicFindingDetail | null {
  const detail = getFindingDetail(filename, aiMemoryDir);
  if (!detail) return null;
  const publicMarkdown = withoutPrivateSections(detail.markdown);
  return {
    finding: toPublicFinding(detail.finding),
    markdown: publicMarkdown,
    sections: {
      tldr: textBetween(publicMarkdown, "TL;DR"),
      shown: textBetween(publicMarkdown, "What the post showed"),
      research: textBetween(publicMarkdown, "What it actually is"),
      links: textBetween(publicMarkdown, "Links"),
      kickstarter: textBetween(publicMarkdown, "Kickstarter guide"),
    },
  };
}
