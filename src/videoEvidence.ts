import type { ExtractResult } from "./extract.js";
import type { SocialVideoEvidenceV1 } from "./schemas/socialVideoEvidence.js";

/** Retain frame attribution without leaking paths or assigning times to aggregate vision text. */
export function visualEvidence(extract: ExtractResult): SocialVideoEvidenceV1["visualTexts"] {
  const frames = (extract.media_assets ?? []).filter((asset) => asset.type === "screenshot" && asset.source === "video-frame" && asset.ocr_text?.trim()).slice(0, 20);
  const candidates = frames.map((asset) => ({
    text: asset.ocr_text!.trim(), method: "ocr",
    ...(Number.isFinite(asset.timestamp_ms) && asset.timestamp_ms! >= 0 && asset.timestamp_ms! <= 1_800_000
      ? { timestampMs: Math.round(asset.timestamp_ms!) } : {}),
  }));
  // OCR's aggregate includes frames plus thumbnail text. Avoid duplicating frame lines;
  // vision output is a separate observation and has no reliable per-frame attribution.
  const frameLines = new Set(frames.flatMap((asset) => asset.ocr_text!.split(/\r?\n/).map((line) => line.trim().toLowerCase())));
  const aggregate = extract.visual_text_source === "ocr"
    ? extract.visual_text?.split(/\r?\n/).filter((line) => !frameLines.has(line.trim().toLowerCase())).join("\n").trim()
    : extract.visual_text?.trim();
  if (aggregate) candidates.push({ text: aggregate, method: extract.visual_text_source ?? "ocr" });
  const result: SocialVideoEvidenceV1["visualTexts"] = [];
  // Divide the fixed aggregate budget across observations so late frames survive.
  const allowance = Math.min(4_000, Math.floor(50_000 / Math.max(1, candidates.length)));
  for (const item of candidates) {
    const text = item.text.slice(0, allowance).trim();
    if (text) result.push({ ...item, text });
  }
  return result;
}
