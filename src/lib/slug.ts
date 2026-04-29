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
  const d = date ?? new Date().toISOString().slice(0, 10);
  const slug = slugify(title || "untitled");
  return `${d}-${slug}.md`;
}
