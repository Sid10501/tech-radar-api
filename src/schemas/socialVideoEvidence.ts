import { z } from "zod";

const MAX_MEDIA_SECONDS = 1_800;
const MAX_MEDIA_MS = MAX_MEDIA_SECONDS * 1_000;

const boundedText = (max: number) => z.string().max(max).refine((value) => value.trim().length > 0, { message: "must not be blank" });
const boundedIdentifier = (max: number) => boundedText(max);

const TranscriptSegmentSchema = z.object({
  startMs: z.number().int().min(0).max(MAX_MEDIA_MS),
  endMs: z.number().int().min(0).max(MAX_MEDIA_MS),
  text: boundedText(4_000),
}).strict().refine((segment) => segment.endMs >= segment.startMs, { message: "endMs must not precede startMs" });

const FinanceClaimSchema = z.object({
  text: boundedText(4_000),
  stance: boundedText(100).nullable().optional(),
  confidence: z.number().min(0).max(1).nullable().optional(),
  startMs: z.number().int().min(0).max(MAX_MEDIA_MS).nullable().optional(),
  endMs: z.number().int().min(0).max(MAX_MEDIA_MS).nullable().optional(),
}).strict().refine((claim) => claim.startMs == null || claim.endMs == null || claim.endMs >= claim.startMs, {
  message: "claim endMs must not precede startMs",
});

const SecurityClaimsSchema = z.object({
  symbol: boundedIdentifier(32).nullable().optional(),
  exchange: boundedIdentifier(40).nullable().optional(),
  companyName: boundedText(300).nullable().optional(),
  assetType: z.enum(["stock", "etf", "unsupported"]),
  confidence: z.number().min(0).max(1),
  claims: z.array(FinanceClaimSchema).max(100),
}).strict();

export const SocialVideoEvidenceV1Schema = z.object({
  schemaVersion: z.literal(1),
  idempotencyKey: boundedIdentifier(300),
  origin: z.object({
    channel: boundedIdentifier(40),
    runId: boundedIdentifier(200),
    chatId: boundedIdentifier(200).nullable().optional(),
    messageId: boundedIdentifier(200).nullable().optional(),
  }).strict(),
  source: z.object({
    url: z.string().url().min(8).max(2_048).refine((value) => /^https?:\/\//.test(value)),
    canonicalUrl: z.string().url().min(8).max(2_048).refine((value) => /^https?:\/\//.test(value)),
    platform: boundedIdentifier(40),
    externalId: boundedIdentifier(300).nullable().optional(),
    title: boundedText(1_000).nullable().optional(),
    creator: boundedText(300).nullable().optional(),
    publishedAt: z.string().datetime().nullable().optional(),
    durationSeconds: z.number().int().min(0).max(MAX_MEDIA_SECONDS).nullable().optional(),
  }).strict(),
  classification: z.object({
    category: boundedIdentifier(50),
    confidence: z.number().min(0).max(1),
    reasons: z.array(boundedText(500)).max(20),
  }).strict(),
  transcript: z.object({
    language: boundedIdentifier(30).nullable().optional(),
    method: boundedIdentifier(100).nullable().optional(),
    hash: boundedIdentifier(200).nullable().optional(),
    segments: z.array(TranscriptSegmentSchema).max(3_600),
  }).strict(),
  visualTexts: z.array(z.object({
    text: boundedText(4_000),
    timestampMs: z.number().int().min(0).max(MAX_MEDIA_MS).nullable().optional(),
    method: boundedIdentifier(100).nullable().optional(),
  }).strict()).max(500),
  extraction: z.object({
    methods: z.array(boundedIdentifier(300)).max(20),
    warnings: z.array(boundedText(1_000)).max(50),
  }).strict(),
  financeClaims: z.object({ securities: z.array(SecurityClaimsSchema).max(10) }).strict(),
}).strict().superRefine((evidence, context) => {
  const transcriptSize = evidence.transcript.segments.reduce((total, segment) => total + segment.text.length, 0);
  const visualSize = evidence.visualTexts.reduce((total, item) => total + item.text.length, 0);
  const claimSize = evidence.financeClaims.securities.reduce(
    (total, security) => total + security.claims.reduce((sum, claim) => sum + claim.text.length, 0),
    0,
  );
  if (transcriptSize > 120_000) context.addIssue({ code: z.ZodIssueCode.custom, path: ["transcript"], message: "transcript aggregate exceeds 120000 characters" });
  if (visualSize > 50_000) context.addIssue({ code: z.ZodIssueCode.custom, path: ["visualTexts"], message: "visual aggregate exceeds 50000 characters" });
  if (claimSize > 100_000) context.addIssue({ code: z.ZodIssueCode.custom, path: ["financeClaims"], message: "claim aggregate exceeds 100000 characters" });
});

export type SocialVideoEvidenceV1 = z.infer<typeof SocialVideoEvidenceV1Schema>;
export const SOCIAL_VIDEO_MAX_DURATION_SECONDS = MAX_MEDIA_SECONDS;
export const SOCIAL_VIDEO_MAX_SECURITIES = 10;
