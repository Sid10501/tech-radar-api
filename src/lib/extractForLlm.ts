import type { ExtractResult } from "../extract.js";
import { buildWorkflowAuditBlock, linkedArtifactsForExtract } from "./linkedArtifacts.js";
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

export function llmCommentsBlock(extract: ExtractResult): string {
  const comments = extract.top_comments ?? [];
  if (comments.length === 0) return "";
  const raw = comments
    .map((comment, index) => {
      const author = comment.author?.trim() || "unknown";
      const likes = typeof comment.like_count === "number" ? `, ${comment.like_count} likes` : "";
      return `${index + 1}. ${author}${likes}: ${comment.text}`;
    })
    .join("\n");
  return wrapAsUntrusted(raw, { label: "YouTube comments" });
}

export function llmChaptersBlock(extract: ExtractResult): string {
  const chapters = extract.chapters ?? [];
  if (chapters.length === 0) return "";
  const raw = chapters
    .slice(0, 30)
    .map((chapter, index) => {
      const start = formatTimestamp(chapter.start_time);
      const end = typeof chapter.end_time === "number" ? `-${formatTimestamp(chapter.end_time)}` : "";
      return `${index + 1}. ${start}${end}: ${chapter.title}`;
    })
    .join("\n");
  return wrapAsUntrusted(raw, { label: "YouTube chapters" });
}

export function llmLinkedArtifactsBlock(extract: ExtractResult): string {
  const artifacts = linkedArtifactsForExtract(extract);
  if (artifacts.length === 0) return "";
  return artifacts
    .map((artifact) => `- ${artifact.type} · ${artifact.role}: ${artifact.url}`)
    .join("\n");
}

export function llmTitleBlock(extract: ExtractResult): string {
  if (extract.title_for_llm) return extract.title_for_llm;
  if (extract.title?.trim()) {
    return wrapAsUntrusted(extract.title, { label: "post title" });
  }
  return "unknown";
}

export function buildResearchUserMessage(extract: ExtractResult): string {
  const caption = llmCaptionBlock(extract);
  const transcript = llmTranscriptBlock(extract);
  const visualText = llmVisualTextBlock(extract);
  const title = llmTitleBlock(extract);
  const comments = llmCommentsBlock(extract);
  const chapters = llmChaptersBlock(extract);
  const linkedArtifacts = llmLinkedArtifactsBlock(extract);
  const hashtags = (extract.hashtags ?? []).join(", ") || "(none)";
  const sourceLinks = (extract.source_links ?? []).filter(Boolean);

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

  if (sourceLinks.length > 0) {
    parts.push("", "Source links found:", sourceLinks.map((link) => `- ${link}`).join("\n"));
  }
  if (linkedArtifacts) {
    parts.push("", "Linked artifacts:", linkedArtifacts);
  }
  const workflowAudit = buildWorkflowAuditBlock(linkedArtifactsForExtract(extract));
  if (workflowAudit) {
    parts.push(
      "",
      "Workflow intake guidance:",
      "This source appears to describe an AI-agent workflow. Evaluate memory, skills, validation, and harness changes separately from individual tools.",
      workflowAudit,
    );
  }

  if (caption) {
    parts.push("", "Post caption:", caption);
  }
  if (transcript) {
    parts.push("", "Transcript excerpt:", transcript);
  }
  if (chapters) {
    parts.push("", "Learning chapters:", chapters);
  }
  if (visualText) {
    parts.push("", "On-screen text / OCR:", visualText);
  }
  if (comments) {
    parts.push("", "Top comments:", comments);
  }

  parts.push(
    "",
    "Produce the JSON report as instructed. Call github_lookup if the technology has a GitHub repo.",
  );

  return parts.join("\n");
}

function formatTimestamp(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds || 0));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}
