import { z } from "zod";
import { wrapAsUntrusted } from "../lib/untrustedContent.js";

const MAX_MEDIA_SECONDS = 1_800;
const MAX_MEDIA_MS = MAX_MEDIA_SECONDS * 1_000;

function externalText(max: number, label: string) {
  return z.string().min(1).max(max).transform((value) =>
    value.startsWith("The following is UNTRUSTED ")
      ? value
      : wrapAsUntrusted(value, { maxChars: max, label }),
  );
}

const TranscriptSegmentSchema = z.object({
  startMs: z.number().int().min(0).max(MAX_MEDIA_MS),
  endMs: z.number().int().min(0).max(MAX_MEDIA_MS),
  text: externalText(8_000, "transcript segment"),
}).strict().refine((segment) => segment.endMs >= segment.startMs, {
  message: "endMs must be greater than or equal to startMs",
});

const FinanceClaimSchema = z.object({
  text: externalText(2_000, "finance claim"),
  stance: z.enum(["bullish", "bearish", "neutral", "unclear"]).optional(),
  confidence: z.number().min(0).max(1),
  startMs: z.number().int().min(0).max(MAX_MEDIA_MS).optional(),
  endMs: z.number().int().min(0).max(MAX_MEDIA_MS).optional(),
}).strict().refine((claim) => claim.startMs === undefined || claim.endMs === undefined || claim.endMs >= claim.startMs, {
  message: "claim endMs must be greater than or equal to startMs",
});

const SecurityClaimsSchema = z.object({
  symbol: z.string().trim().min(1).max(24).regex(/^[A-Za-z0-9.^/-]+$/).optional(),
  exchange: z.string().trim().min(1).max(40).optional(),
  companyName: externalText(300, "security name").optional(),
  assetType: z.enum(["stock", "etf", "unsupported"]),
  confidence: z.number().min(0).max(1),
  claims: z.array(FinanceClaimSchema).max(50),
}).strict();

export const SocialVideoEvidenceV1Schema = z.object({
  schemaVersion: z.literal(1),
  idempotencyKey: z.string().trim().min(1).max(200),
  origin: z.object({
    channel: z.enum(["telegram", "shortcut", "dashboard", "api"]),
    runId: z.string().trim().min(1).max(100),
    chatId: z.string().trim().min(1).max(100).optional(),
    messageId: z.string().trim().min(1).max(100).optional(),
  }).strict(),
  source: z.object({
    url: z.string().url().max(2_048),
    canonicalUrl: z.string().url().max(2_048),
    platform: z.string().trim().min(1).max(40),
    externalId: z.string().trim().min(1).max(300).optional(),
    title: externalText(1_000, "source title").optional(),
    creator: externalText(300, "source creator").optional(),
    publishedAt: z.string().datetime().optional(),
    durationSeconds: z.number().min(0).max(MAX_MEDIA_SECONDS).optional(),
  }).strict(),
  classification: z.object({
    category: z.enum(["technology", "finance", "mixed", "other", "needs_review"]),
    confidence: z.number().min(0).max(1),
    reasons: z.array(z.string().trim().min(1).max(500)).max(20),
  }).strict(),
  transcript: z.object({
    language: z.string().trim().min(1).max(40).optional(),
    method: z.string().trim().min(1).max(100).optional(),
    hash: z.string().trim().min(1).max(200).optional(),
    segments: z.array(TranscriptSegmentSchema).max(1_800),
  }).strict(),
  visualTexts: z.array(z.object({
    text: externalText(4_000, "visual text"),
    timestampMs: z.number().int().min(0).max(MAX_MEDIA_MS).optional(),
    method: z.string().trim().min(1).max(100).optional(),
  }).strict()).max(200),
  extraction: z.object({
    methods: z.array(z.string().trim().min(1).max(100)).max(30),
    warnings: z.array(externalText(1_000, "extraction warning")).max(50),
  }).strict(),
  financeClaims: z.object({
    securities: z.array(SecurityClaimsSchema).max(10),
  }).strict(),
}).strict();

export type SocialVideoEvidenceV1 = z.infer<typeof SocialVideoEvidenceV1Schema>;
export const SOCIAL_VIDEO_MAX_DURATION_SECONDS = MAX_MEDIA_SECONDS;
export const SOCIAL_VIDEO_MAX_SECURITIES = 10;
