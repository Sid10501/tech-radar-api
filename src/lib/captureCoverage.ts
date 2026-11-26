import type { ExtractResult } from "../extract.js";

export interface CaptureCoverage {
  listed: number | null;
  withText: number;
}

export function measuredCoverage(capture: ExtractResult["instagram_capture"]): CaptureCoverage | undefined {
  if (!capture) return undefined;
  if (capture.kind === "unverified") return { listed: null, withText: 0 };
  return { listed: capture.slides.length, withText: capture.slides.filter(slide => slide.text?.trim()).length };
}

export function needsCaptureReview(coverage?: CaptureCoverage): boolean {
  return !!coverage && (coverage.listed === null || coverage.withText === 0 || coverage.withText < coverage.listed);
}

// Accept the generated summary and the historical recovery report. Never infer counts from OCR prose.
export function parseCaptureCoverage(section: string): CaptureCoverage | undefined {
  if (section.startsWith("Slide coverage unknown.")) return { listed: null, withText: 0 };
  const current = /^OCR returned text for (\d+) of (\d+) listed media items\./.exec(section);
  const historical = /^On [A-Za-z]+ \d{1,2} the extractor (?:enumerated|listed) (\d+) media items(?:\. OCR returned text| and returned OCR text) for (\d+)\./.exec(section);
  if (!current && !historical) return undefined;
  const listed = Number(current?.[2] ?? historical?.[1]);
  const withText = Number(current?.[1] ?? historical?.[2]);
  return Number.isSafeInteger(listed) && withText <= listed ? { listed, withText } : undefined;
}
