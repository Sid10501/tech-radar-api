export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

export function findingFilename(title: string, date?: string): string {
  const d = normalizeFindingDate(date);
  const slug = slugify(title || "untitled");
  return `${d}-${slug}.md`;
}

function normalizeFindingDate(date?: string): string {
  const fallback = new Date().toISOString().slice(0, 10);
  if (!date) return fallback;
  const trimmed = date.trim();
  const dashed = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dashed) return trimmed;
  const compact = trimmed.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  return fallback;
}
