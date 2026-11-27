import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

export const topicCategory = z.enum(['technology', 'finance', 'mixed', 'other', 'needs_review']);
const identifier = z.string().regex(/^[a-z0-9_-]{1,80}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const batchSchema = z.object({
  schemaVersion: z.literal(1), batchId: identifier,
  labelSource: z.enum(['model-reviewed', 'unreviewed', 'human-reviewed']),
  rubricVersion: z.enum(['investing-v1', 'everyday-v2']).default('investing-v1'),
  posts: z.array(z.object({
    id: identifier, inputHash: hash,
    sourceUrl: z.string().url().max(2000).refine(value => {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password;
    }),
    text: z.string().max(15000), suggestedCategory: topicCategory,
    evidence: z.string().min(1).max(300),
  }).strict()).min(1).max(100),
}).strict().superRefine((batch, ctx) => {
  if (new Set(batch.posts.map(p => p.id)).size !== batch.posts.length) {
    ctx.addIssue({ code: 'custom', message: 'Duplicate post IDs' });
  }
});
export const feedbackSchema = z.object({batchId: identifier, inputHash: hash, category: topicCategory}).strict();
const recordSchema = feedbackSchema.extend({id: identifier, savedAt: z.string().datetime()}).strict();
type Record = z.infer<typeof recordSchema>;

// This trial is a bounded batch reader and an append-only feedback log.
// It deliberately has no pipeline or provider dependency.
export class TopicSuggestionStore {
  readonly batch: z.infer<typeof batchSchema>;
  private readonly logPath: string;
  constructor(batchFile: string, stateDir: string) {
    this.batch = batchSchema.parse(JSON.parse(fs.readFileSync(batchFile, 'utf8')));
    this.logPath = path.join(stateDir, 'topic-suggestion-feedback.jsonl');
  }
  list() {
    const records = this.readFeedback().reverse();
    return { ...this.batch, posts: this.batch.posts.map(post => ({...post,
      feedback: records.find(record => record.batchId === this.batch.batchId && record.id === post.id && record.inputHash === post.inputHash) ?? null,
    })) };
  }
  save(id: string, feedback: z.infer<typeof feedbackSchema>) {
    const post = this.batch.posts.find(p => p.id === id);
    if (!post) return { status: 404, error: 'Post not found' };
    if (feedback.batchId !== this.batch.batchId || feedback.inputHash !== post.inputHash) {
      return { status: 409, error: 'This post changed. Reload before saving.' };
    }
    const record = { ...feedback, id, savedAt: new Date().toISOString() };
    // Each update is a single append, preserving other reviewers' updates and history.
    fs.mkdirSync(path.dirname(this.logPath), { recursive: true, mode: 0o700 });
    const fd = fs.openSync(this.logPath, 'a', 0o600);
    const originalSize = fs.fstatSync(fd).size;
    try {
      const data = Buffer.from(JSON.stringify(record) + '\n');
      let offset = 0;
      while (offset < data.length) {
        const written = fs.writeSync(fd, data, offset, data.length - offset);
        if (written <= 0) throw new Error('Feedback write made no progress');
        offset += written;
      }
      fs.fsyncSync(fd);
    } catch (error) {
      // Synchronous writes serialize in the supported single-process trial.
      fs.ftruncateSync(fd, originalSize);
      fs.fsyncSync(fd);
      throw error;
    } finally { fs.closeSync(fd); }
    return { status: 200, feedback: record };
  }
  private readFeedback(): Record[] {
    if (!fs.existsSync(this.logPath)) return [];
    return fs.readFileSync(this.logPath, 'utf8').split('\n').filter(Boolean).map(line => recordSchema.parse(JSON.parse(line)));
  }
}
