import { createHmac, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

export const StockBotCompletionEventSchema = z.object({
  eventId: z.string().min(1).max(200),
  analysisId: z.string().min(1).max(200),
  status: z.string().min(1).max(100),
  detailUrl: z.string().url().max(2_048).nullable().optional(),
  results: z.array(z.object({
    symbol: z.string().max(32).nullable().optional(),
    companyName: z.string().max(300).nullable().optional(),
    claimGrade: z.string().max(100),
    opinion: z.string().max(100),
    confidence: z.number().min(0).max(1),
  }).strict()).max(10),
  error: z.union([
    z.string().max(2_000),
    z.object({
      code: z.string().max(200).nullable().optional(),
      message: z.string().max(2_000).nullable().optional(),
      providers: z.union([z.array(z.string().max(200)).max(50), z.record(z.unknown())]).nullable().optional(),
    }).passthrough(),
  ]).nullable().optional(),
}).strict();

export type StockBotCompletionEvent = z.infer<typeof StockBotCompletionEventSchema>;

export function stockBotErrorText(error: StockBotCompletionEvent["error"]): string | undefined {
  if (!error) return undefined;
  if (typeof error === "string") return error.slice(0, 500);
  const parts = [error.code, error.message].filter((value): value is string => typeof value === "string" && value.length > 0);
  return parts.join(": ").slice(0, 500) || "StockBot analysis failed";
}

export function verifyStockBotCallback(input: {
  rawBody: string;
  timestamp: string;
  signature: string;
  secret: string;
  nowMs?: number;
  replayWindowMs?: number;
}): StockBotCompletionEvent {
  if (!input.secret) throw new Error("callback secret is not configured");
  const timestampSeconds = Number(input.timestamp);
  if (!Number.isFinite(timestampSeconds)) throw new Error("invalid callback timestamp");
  const nowMs = input.nowMs ?? Date.now();
  const replayWindowMs = input.replayWindowMs ?? 300_000;
  if (Math.abs(nowMs - timestampSeconds * 1_000) > replayWindowMs) throw new Error("callback rejected by replay window");
  const expected = createHmac("sha256", input.secret).update(`${input.timestamp}.${input.rawBody}`).digest();
  let supplied: Buffer;
  try {
    supplied = Buffer.from(input.signature, "hex");
  } catch {
    throw new Error("invalid callback signature");
  }
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new Error("invalid callback signature");
  return StockBotCompletionEventSchema.parse(JSON.parse(input.rawBody));
}

export class StockBotEventDeduper {
  private readonly seen = new Map<string, number>();
  constructor(private readonly maxEntries = 1_000, private readonly persistencePath?: string) {
    if (!persistencePath) return;
    try {
      const values = JSON.parse(fs.readFileSync(persistencePath, "utf8")) as Array<[string, number]>;
      for (const [eventId, acceptedAt] of values.slice(-maxEntries)) this.seen.set(eventId, acceptedAt);
    } catch {
      // Missing/corrupt cache falls back to signature validation and StockBot retry safety.
    }
  }

  accept(eventId: string): boolean {
    if (this.seen.has(eventId)) return false;
    this.seen.set(eventId, Date.now());
    if (this.seen.size > this.maxEntries) this.seen.delete(this.seen.keys().next().value!);
    if (this.persistencePath) {
      fs.mkdirSync(path.dirname(this.persistencePath), { recursive: true });
      fs.writeFileSync(this.persistencePath, JSON.stringify([...this.seen]), { encoding: "utf8", mode: 0o600 });
    }
    return true;
  }

  forget(eventId: string): void {
    this.seen.delete(eventId);
    if (this.persistencePath) {
      fs.writeFileSync(this.persistencePath, JSON.stringify([...this.seen]), { encoding: "utf8", mode: 0o600 });
    }
  }
}
