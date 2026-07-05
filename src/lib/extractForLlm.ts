import type { ExtractResult } from "../extract.js";
import { wrapAsUntrusted } from "./untrustedContent.js";

/** Prefer pipeline `*_for_llm` fields; otherwise wrap raw extractor text. */
export function llmCaptionBlock(extract: ExtractResult): string {
  if (extract.caption_for_llm) return extract.caption_for_llm;
  if (extract.caption?.trim()) {
    return wrapAsUntrusted(extract.caption, { label: "post caption" });
  }
  return "";
}

export function llmTranscriptBlock(extract: ExtractResult): string {
  if (extract.transcript_for_llm) return extract.transcript_for_llm;
  const raw = extract.transcript?.trim() ?? "";
  if (!raw) return "";
  return wrapAsUntrusted(raw, { label: "post transcript" });
}

export function llmVisualTextBlock(extract: ExtractResult): string {
  if (extract.visual_text_for_llm) return extract.visual_text_for_llm;
  const raw = extract.visual_text?.trim() ?? "";
  if (!raw) return "";
  return wrapAsUntrusted(raw, { label: "post on-screen text / OCR" });
}

export function llmTitleBlock(extract: ExtractResult): string {
  if (extract.title_for_llm) return extract.title_for_llm;
  if (extract.title?.trim()) {
    return wrapAsUntrusted(extract.title, { label: "post title" });
  }
  return "unknown";
}

export function llmEnrichedLinksBlock(extract: ExtractResult): string {
  if (!extract.enriched_links) return "";
  return wrapAsUntrusted(JSON.stringify(extract.enriched_links, null, 2), {
    label: "deterministic link enrichment evidence",
    maxChars: 4_000,
  });
}

export function buildResearchUserMessage(extract: ExtractResult): string {
  const caption = llmCaptionBlock(extract);
  const transcript = llmTranscriptBlock(extract);
  const visualText = llmVisualTextBlock(extract);
  const title = llmTitleBlock(extract);
  const enrichedLinks = llmEnrichedLinksBlock(extract);
  const hashtags = (extract.hashtags ?? []).join(", ") || "(none)";

  const parts = [
    "Research the following technology extracted from a social media post.",
    "",
    `URL (reference only): ${extract.url}`,
    `Platform: ${extract.platform}`,
    `Creator (metadata): ${extract.creator ?? "unknown"}`,
    `Hashtags (metadata): ${hashtags}`,
    "",
    "Post title:",
    title,
  ];

  if (caption) {
    parts.push("", "Post caption:", caption);
  }
  if (transcript) {
    parts.push("", "Transcript excerpt:", transcript);
  }
  if (visualText) {
    parts.push("", "On-screen text / OCR:", visualText);
  }
  if (enrichedLinks) {
    parts.push(
      "",
      "Enriched links:",
      enrichedLinks,
      "",
      "Use confirmed GitHub/docs/npm links when present. Treat candidate links as leads that must be verified before reporting them as confirmed.",
    );
  }

  parts.push(
    "",
    "Produce the JSON report as instructed. Call github_lookup if the technology has a GitHub repo.",
  );

  return parts.join("\n");
}
