import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

export const StockBotCompletionEventSchema = z.object({
  eventId: z.string().min(1).max(200),
  runId: z.string().min(1).max(200),
  analysisId: z.string().min(1).max(200),
  status: z.enum(["completed", "partial", "failed", "canceled", "needs_review"]),
  detailUrl: z.string().url().max(2_048).nullable().optional(),
  results: z.array(z.object({
    symbol: z.string().max(32).nullable().optional(),
    companyName: z.string().max(300).nullable().optional(),
    claimGrade: z.enum(["supported", "mixed", "contradicted", "unverifiable"]),
    opinion: z.enum(["buy", "hold", "sell", "watch", "avoid", "insufficient_data"]),
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
  private readonly seen = new Map<string, { state: "pending" | "applied"; at: number }>();
  constructor(private readonly maxEntries = 1_000, private readonly persistencePath?: string, private readonly pendingTtlMs = 5 * 60_000) {
    if (!persistencePath) return;
    try {
      const values = JSON.parse(fs.readFileSync(persistencePath, "utf8")) as Array<[string, number | { state: "pending" | "applied"; at: number }]>;
      for (const [eventId, raw] of values.slice(-maxEntries)) {
        const value = typeof raw === "number" ? { state: "applied" as const, at: raw } : raw;
        if (value.state === "pending" && this.pendingExpired(value)) {
          this.removeStaleReservation(eventId);
          continue;
        }
        this.seen.set(eventId, value);
      }
    } catch {
      // Missing/corrupt cache falls back to signature validation and StockBot retry safety.
    }
  }

  begin(eventId: string): boolean {
    const existing = this.seen.get(eventId);
    if (existing && !(existing.state === "pending" && this.pendingExpired(existing))) return false;
    if (existing) {
      this.seen.delete(eventId);
      this.removeStaleReservation(eventId);
    }
    if (this.persistencePath) {
      const reservation = this.reservationPath(eventId);
      fs.mkdirSync(path.dirname(reservation), { recursive: true, mode: 0o700 });
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const fd = fs.openSync(reservation, "wx", 0o600);
          fs.writeFileSync(fd, JSON.stringify({ eventId, state: "pending", at: Date.now() }));
          fs.closeSync(fd);
          break;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          if (attempt === 0 && this.removeStaleReservation(eventId)) continue;
          return false;
        }
      }
    }
    this.seen.set(eventId, { state: "pending", at: Date.now() });
    if (this.seen.size > this.maxEntries) this.seen.delete(this.seen.keys().next().value!);
    this.persist();
    return true;
  }

  markApplied(eventId: string): void {
    this.seen.set(eventId, { state: "applied", at: Date.now() });
    if (this.persistencePath) this.atomicWrite(this.reservationPath(eventId), JSON.stringify({ eventId, state: "applied", at: Date.now() }));
    this.persist();
  }

  has(eventId: string): boolean { return this.seen.has(eventId); }
  record(eventId: string): void { if (!this.begin(eventId)) throw new Error("event already recorded"); this.markApplied(eventId); }
  accept(eventId: string): boolean { if (!this.begin(eventId)) return false; this.markApplied(eventId); return true; }

  forget(eventId: string): void {
    this.seen.delete(eventId);
    if (this.persistencePath) fs.rmSync(this.reservationPath(eventId), { force: true });
    this.persist();
  }

  private persist(): void {
    if (!this.persistencePath) return;
    fs.mkdirSync(path.dirname(this.persistencePath), { recursive: true, mode: 0o700 });
    this.atomicWrite(this.persistencePath, JSON.stringify([...this.seen]));
  }

  private reservationPath(eventId: string): string {
    return path.join(`${this.persistencePath}.events`, createHash("sha256").update(eventId).digest("hex"));
  }

  private pendingExpired(value: { state: "pending" | "applied"; at: number }): boolean {
    return value.state === "pending" && Date.now() - value.at >= this.pendingTtlMs;
  }

  private removeStaleReservation(eventId: string): boolean {
    if (!this.persistencePath) return true;
    try {
      const reservation = this.reservationPath(eventId);
      const value = JSON.parse(fs.readFileSync(reservation, "utf8")) as { state?: string; at?: number };
      if (value.state !== "pending" || typeof value.at !== "number" || !this.pendingExpired({ state: "pending", at: value.at })) return false;
      fs.rmSync(reservation, { force: true });
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ENOENT";
    }
  }

  private atomicWrite(target: string, value: string): void {
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporary, value, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporary, target);
  }
}
