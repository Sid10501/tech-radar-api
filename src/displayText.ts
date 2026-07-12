export interface DisplayHeader {
  title: string;
  summary: string;
}

const DISPLAY_TITLE_MAX = 70;
const DISPLAY_FALLBACK_MAX = 90;
const DISPLAY_SUMMARY_MAX = 200;

export function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|amp|quot|apos|lt|gt);/gi, (_match, entity: string) => {
    const key = entity.toLowerCase();
    if (key === "amp") return "&";
    if (key === "quot") return "\"";
    if (key === "apos") return "'";
    if (key === "lt") return "<";
    if (key === "gt") return ">";
    if (key.startsWith("#")) {
      const codePoint = key.startsWith("#x")
        ? Number.parseInt(key.slice(2), 16)
        : Number.parseInt(key.slice(1), 10);
      if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return _match;
      return String.fromCodePoint(codePoint);
    }
    return _match;
  });
}

export function parseDisplayHeader(markdown: string): DisplayHeader | null {
  const line = markdown.match(/^\*\*Display:\*\*\s*(.+)$/m)?.[1]?.trim();
  if (!line) return null;
  const decoded = decodeEntities(line).trim();
  if (!decoded) return null;
  const separator = decoded.match(/\s+(?:—|–|-)\s+/);
  if (!separator || separator.index === undefined) {
    return { title: decoded, summary: "" };
  }
  const title = decoded.slice(0, separator.index).trim();
  const summary = decoded.slice(separator.index + separator[0].length).trim();
  if (!title) return null;
  return { title, summary };
}

export function deriveDisplayTitle(rawTitle: string): string {
  const decoded = collapseWhitespace(decodeEntities(rawTitle));
  if (!decoded) return "";

  const instagram = decoded.match(/^(.+?)\s+on Instagram:\s*["“](.*)$/);
  if (instagram) {
    const caption = instagram[2].replace(/["”]\s*$/, "").trim();
    const clause = firstClause(caption);
    if (clause) return capAtWordBoundary(clause, DISPLAY_TITLE_MAX);
  }

  const github = decoded.match(/^GitHub - ([\w.-]+)\/([\w.-]+)(?::\s*(.+))?$/);
  if (github) {
    const repo = github[2];
    const description = github[3] ? firstClause(github[3]) : "";
    return description ? `${repo} — ${capAtWordBoundary(description, DISPLAY_TITLE_MAX)}` : repo;
  }

  if (/^(?:Video|Post) by \S+$/i.test(decoded)) return decoded;

  return capAtWordBoundary(decoded, DISPLAY_FALLBACK_MAX);
}

export function deriveDisplaySummary(tldr: string): string {
  const decoded = collapseWhitespace(decodeEntities(tldr));
  if (!decoded) return "";
  const sentence = decoded.match(/^(.*?[.!?])(?:\s|$)/)?.[1] ?? decoded;
  return capAtWordBoundary(sentence.trim(), DISPLAY_SUMMARY_MAX);
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function firstClause(text: string): string {
  const sentence = text.match(/^(.*?[.!?])(?:\s|$)/)?.[1] ?? text;
  const beforeDash = sentence.split(/\s+[—–|]\s+/)[0];
  return beforeDash.replace(/[.!?]+$/, "").trim();
}

function capAtWordBoundary(text: string, max: number): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max + 1);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > 0 ? slice.slice(0, lastSpace) : text.slice(0, max);
  return `${cut.replace(/[\s,;:—–-]+$/, "")}…`;
}
