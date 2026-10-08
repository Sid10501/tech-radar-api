import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";

const text = z.string().trim().min(1).max(8_000);
export const LabUrlSchema = z.string().url().max(2_048).refine(value => {
  const url = new URL(value);
  return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
}, "Use an HTTP(S) URL without credentials");
const strings = z.array(text).max(20);
export const FindingIdSchema = z.string().regex(/^[a-zA-Z0-9_-]+\.md$/).max(160);
export const LabEvidenceSchema = z.object({
  id: z.string().min(1).max(160), source: z.enum(["github", "hackernews"]),
  url: LabUrlSchema, title: text, body: z.string().max(16_000),
  comments: z.array(z.object({ id: z.string().max(160), parentId: z.string().max(160).optional(),
    author: z.string().max(200).optional(), body: z.string().max(4_000), url: LabUrlSchema,
    createdAt: z.string().datetime().optional() }).strict()).max(20),
  retrievedAt: z.string().datetime(), status: z.enum(["ok", "partial"]), warnings: strings,
}).strict();
const ExperimentSchema = z.object({
  question: text, successCriteria: text,
  status: z.enum(["planned", "running", "passed", "failed", "inconclusive"]),
  result: text.nullable(), evidenceUrls: z.array(LabUrlSchema).max(20),
}).strict().superRefine((value, ctx) => {
  if (["passed", "failed", "inconclusive"].includes(value.status) && (!value.result || !value.evidenceUrls.length)) {
    ctx.addIssue({ code: "custom", message: "Completed experiments require a result and evidence URL" });
  }
});
const BriefFieldsSchema = z.object({
  title: z.string().trim().min(1).max(200), problem: text, workarounds: strings, disagreements: strings,
  existingSolutions: strings, projectSlug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/).nullable(),
  findingIds: z.array(FindingIdSchema).max(20),
  evidenceIds: z.array(z.string().min(1).max(160)).max(20),
  experiment: ExperimentSchema, visibility: z.enum(["private", "public"]),
}).strict();
function validateBriefSources(value: z.infer<typeof BriefFieldsSchema>, ctx: z.RefinementCtx) {
  if (!value.evidenceIds.length && (value.visibility === "public" || !value.findingIds.length))
    ctx.addIssue({ code: "custom", message: "A public brief requires captured discussion evidence; private drafts require a captured discussion or finding" });
}
export const BriefInputSchema = BriefFieldsSchema.superRefine(validateBriefSources);
export const LabBriefSchema = BriefFieldsSchema.extend({ id: z.string().uuid(), createdAt: z.string().datetime(), updatedAt: z.string().datetime() }).superRefine(validateBriefSources);
export const ReviewInputSchema = z.object({
  decision: z.enum(["Try", "Bookmark", "Dismiss"]), rationale: text,
  projectSlug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/).nullable(),
  expectedUpdatedAt: z.string().datetime().nullable(),
}).strict();
export const LabReviewSchema = ReviewInputSchema.omit({ expectedUpdatedAt: true }).extend({
  findingId: FindingIdSchema, briefId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
}).strict();
export const FindingExperimentInputSchema = z.object({ question: text, successCriteria: text,
  title: z.string().trim().min(1).max(200), problem: text }).strict();
const StateSchema = z.object({ schemaVersion: z.literal(1), evidence: z.array(LabEvidenceSchema).max(500), briefs: z.array(LabBriefSchema).max(500), reviews: z.array(LabReviewSchema).max(500).default([]) }).strict();
export type LabEvidence = z.infer<typeof LabEvidenceSchema>;
export type LabBrief = z.infer<typeof LabBriefSchema>;
export type LabReview = z.infer<typeof LabReviewSchema>;
export type LabState = z.infer<typeof StateSchema>;

export class LabConflictError extends Error {}

export class LabStore {
  private readonly file: string;
  constructor(private readonly directory: string) { this.file = path.join(directory, "community-lab.json"); }

  read(): LabState {
    if (!fs.existsSync(this.file)) return { schemaVersion: 1, evidence: [], briefs: [], reviews: [] };
    try {
      if (fs.statSync(this.file).size > 16 * 1024 * 1024) throw new Error("size limit");
      return StateSchema.parse(JSON.parse(fs.readFileSync(this.file, "utf8")));
    } catch { throw new Error("Community Lab state is corrupt or exceeds its limit; restore it before writing"); }
  }

  private write(state: LabState): void {
    StateSchema.parse(state);
    const json = JSON.stringify(state, null, 2);
    if (Buffer.byteLength(json) > 16 * 1024 * 1024) throw new Error("Community Lab storage limit reached");
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      const fd = fs.openSync(temporary, "wx", 0o600);
      try { fs.writeFileSync(fd, json); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(temporary, this.file);
      // Persist the directory entry as well as file contents before acknowledging a save.
      // Unsupported filesystems/platforms must fail visibly rather than promise durability.
      const directoryFd = fs.openSync(this.directory, "r");
      try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }

  // Synchronous read/modify/rename keeps mutations indivisible within the API process.
  saveEvidence(input: unknown): LabEvidence {
    const evidence = LabEvidenceSchema.parse(input); const state = this.read();
    const existing = state.evidence.find(value => value.id === evidence.id);
    if (existing) return existing;
    state.evidence.push(evidence); this.write(state); return evidence;
  }

  private validateReferences(state: LabState, evidenceIds: string[]): void {
    if (new Set(evidenceIds).size !== evidenceIds.length || evidenceIds.some(id => !state.evidence.some(item => item.id === id))) {
      throw new Error("Each evidence reference must identify a captured source exactly once");
    }
  }

  createBrief(input: unknown): LabBrief {
    const parsed = BriefInputSchema.parse(input); const state = this.read();
    if (!parsed.evidenceIds.length) throw new Error("An ordinary brief requires captured discussion evidence");
    this.validateReferences(state, parsed.evidenceIds);
    const now = new Date().toISOString();
    const brief = { ...parsed, id: randomUUID(), createdAt: now, updatedAt: now };
    state.briefs.unshift(brief); this.write(state); return brief;
  }

  updateBrief(id: string, input: unknown, expectedUpdatedAt: string): LabBrief {
    const parsed = BriefInputSchema.parse(input); const state = this.read();
    const i = state.briefs.findIndex(value => value.id === id);
    if (i < 0) throw new Error("Brief not found");
    if (state.briefs[i].updatedAt !== expectedUpdatedAt) throw new LabConflictError("Brief changed; reload before saving");
    if (!parsed.evidenceIds.length && !state.reviews.some(review => review.briefId === id && parsed.findingIds.includes(review.findingId)))
      throw new Error("A brief without captured discussion evidence must remain linked to its finding");
    this.validateReferences(state, parsed.evidenceIds);
    const updatedAt = new Date(Math.max(Date.now(), Date.parse(state.briefs[i].updatedAt) + 1)).toISOString();
    const brief = { ...state.briefs[i], ...parsed, updatedAt }; state.briefs[i] = brief;
    this.write(state); return brief;
  }

  review(findingId: string): LabReview | null {
    FindingIdSchema.parse(findingId);
    return this.read().reviews.find(value => value.findingId === findingId) ?? null;
  }

  saveReview(findingId: string, input: unknown): LabReview {
    FindingIdSchema.parse(findingId);
    const parsed = ReviewInputSchema.parse(input); const state = this.read();
    const index = state.reviews.findIndex(value => value.findingId === findingId);
    const previous = state.reviews[index];
    if ((previous?.updatedAt ?? null) !== parsed.expectedUpdatedAt) throw new LabConflictError("Review changed; reload before saving");
    const now = new Date(Math.max(Date.now(), previous ? Date.parse(previous.updatedAt) + 1 : 0)).toISOString();
    const review: LabReview = { findingId, decision: parsed.decision, rationale: parsed.rationale,
      projectSlug: parsed.projectSlug, briefId: previous?.briefId ?? null, createdAt: previous?.createdAt ?? now, updatedAt: now };
    if (index < 0) state.reviews.push(review); else state.reviews[index] = review;
    this.write(state); return review;
  }

  createFindingExperiment(findingId: string, input: unknown): LabBrief {
    FindingIdSchema.parse(findingId);
    const parsed = FindingExperimentInputSchema.parse(input); const state = this.read();
    const review = state.reviews.find(value => value.findingId === findingId);
    if (!review || review.decision !== "Try") throw new Error("Save a Try review before creating an experiment");
    if (review.briefId) {
      const linked = state.briefs.find(value => value.id === review.briefId);
      if (!linked) throw new Error("Linked experiment is missing");
      return linked;
    }
    const now = new Date().toISOString();
    const brief: LabBrief = { id: randomUUID(), createdAt: now, updatedAt: now,
      title: parsed.title, problem: parsed.problem, workarounds: [], disagreements: [], existingSolutions: [],
      projectSlug: review.projectSlug, findingIds: [findingId], evidenceIds: [], visibility: "private",
      experiment: { question: parsed.question, successCriteria: parsed.successCriteria, status: "planned", result: null, evidenceUrls: [] } };
    state.briefs.unshift(brief);
    review.briefId = brief.id;
    review.updatedAt = new Date(Math.max(Date.now(), Date.parse(review.updatedAt) + 1)).toISOString();
    this.write(state); return brief;
  }

  publicFeed() {
    const state = this.read(); const briefs = state.briefs.filter(brief => brief.visibility === "public");
    const referenced = new Set(briefs.flatMap(brief => brief.evidenceIds));
    return { schemaVersion: 1 as const, briefs, evidence: state.evidence.filter(item => referenced.has(item.id)).map(({ id, source, url, title, retrievedAt }) => ({ id, source, url, title, retrievedAt })) };
  }
}
