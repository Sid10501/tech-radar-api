import fs from "node:fs";
import path from "node:path";
import { slugify } from "./lib/slug.js";

export interface ReleaseNote {
  id: string;
  date: string;
  title: string;
  summary: string;
  bodyMarkdown: string;
  highlights: string[];
}

export function getReleaseNotesPath(): string {
  return path.join(process.cwd(), "src", "release-notes.md");
}

export function parseReleaseNotesMarkdown(markdown: string): ReleaseNote[] {
  const normalized = markdown.replace(/\r\n/g, "\n");
  const headingPattern = /^## (\d{4}-\d{2}-\d{2}) - (.+)$/gm;
  const headings = [...normalized.matchAll(headingPattern)];

  return headings
    .map((match, index) => {
      const date = match[1].trim();
      const title = match[2].trim();
      const start = match.index + match[0].length;
      const end = headings[index + 1]?.index ?? normalized.length;
      const bodyMarkdown = normalized.slice(start, end).trim();
      const summary = bodyMarkdown
        .split(/\n{2,}/)
        .map((part) => part.trim())
        .find((part) => part && !part.startsWith("- ") && !part.startsWith("#")) ?? "";
      const highlights = bodyMarkdown
        .split("\n")
        .map((line) => line.trim().match(/^- (.+)$/)?.[1]?.trim())
        .filter((line): line is string => Boolean(line));

      return {
        id: `${date}-${slugify(title)}`,
        date,
        title,
        summary,
        bodyMarkdown,
        highlights,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));
}

export function listReleaseNotes(filePath = getReleaseNotesPath()): ReleaseNote[] {
  if (!fs.existsSync(filePath)) return [];
  return parseReleaseNotesMarkdown(fs.readFileSync(filePath, "utf8"));
}
