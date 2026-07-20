import { createHash, createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { StockBotEventDeduper, verifyStockBotCallback } from "../src/stockbotCallback.js";
import { StockBotCompletionEventSchema } from "../src/stockbotCallback.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const payload = {
  eventId: "event-1",
  runId: "run-1",
  analysisId: "analysis-1",
  status: "completed",
  detailUrl: "https://stockbot.test/analysis/analysis-1",
  results: [{ symbol: "NVDA", claimGrade: "supported", opinion: "watch", confidence: 0.8 }],
};

function signed(rawBody: string, timestamp: string, secret = "callback-secret") {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

describe("StockBot callback verification", () => {
  it("accepts the actual StockBot serializer shape with nullable detail/security identity and structured error", () => {
    const fixture = fs.readFileSync(path.resolve(fileURLToPath(import.meta.url), "../fixtures/stockbot_completion.json"), "utf8");
    const nowMs = Date.now();
    const timestamp = String(Math.floor(nowMs / 1000));
    const parsed = verifyStockBotCallback({ rawBody: fixture, timestamp, signature: signed(fixture, timestamp), secret: "callback-secret", nowMs });
    expect(parsed.detailUrl).toBeNull();
    expect(parsed.results[0]).toMatchObject({ symbol: null, companyName: null });
    expect(parsed.error).toMatchObject({ code: "provider_unavailable", providers: ["market", "news"] });
  });
  it("verifies timestamp dot raw-body HMAC-SHA256 and parses the event", () => {
    const nowMs = Date.parse("2026-07-20T12:00:00.000Z");
    const timestamp = String(Math.floor(nowMs / 1_000));
    const rawBody = JSON.stringify(payload);
    expect(verifyStockBotCallback({ rawBody, timestamp, signature: signed(rawBody, timestamp), secret: "callback-secret", nowMs }))
      .toEqual(payload);
  });

  it("rejects invalid signatures and callbacks outside the five-minute replay window", () => {
    const nowMs = Date.parse("2026-07-20T12:00:00.000Z");
    const timestamp = String(Math.floor(nowMs / 1_000));
    const rawBody = JSON.stringify(payload);
    expect(() => verifyStockBotCallback({ rawBody, timestamp, signature: "00", secret: "callback-secret", nowMs })).toThrow(/signature/i);

    const oldTimestamp = String(Math.floor((nowMs - 300_001) / 1_000));
    expect(() => verifyStockBotCallback({ rawBody, timestamp: oldTimestamp, signature: signed(rawBody, oldTimestamp), secret: "callback-secret", nowMs })).toThrow(/replay/i);
  });

  it("enforces exact terminal status, claim grade, and opinion enums", () => {
    const nowMs = Date.now();
    const timestamp = String(Math.floor(nowMs / 1000));
    for (const mutation of [
      { status: "queued" },
      { results: [{ ...payload.results[0], claimGrade: "excellent" }] },
      { results: [{ ...payload.results[0], opinion: "moon" }] },
    ]) {
      const rawBody = JSON.stringify({ ...payload, ...mutation });
      expect(() => verifyStockBotCallback({ rawBody, timestamp, signature: signed(rawBody, timestamp), secret: "callback-secret", nowMs })).toThrow();
    }
  });

  it("accepts needs_review as an exact terminal callback status", () => {
    expect(() => StockBotCompletionEventSchema.parse({ ...payload, status: "needs_review" })).not.toThrow();
  });

  it("deduplicates event IDs for exactly-once callback side effects", () => {
    const deduper = new StockBotEventDeduper();
    expect(deduper.begin("event-1")).toBe(true);
    expect(deduper.begin("event-1")).toBe(false);
    deduper.forget("event-1");
    expect(deduper.begin("event-1")).toBe(true);
    deduper.markApplied("event-1");
    expect(deduper.begin("event-1")).toBe(false);
  });

  it("preserves callback event dedupe across a RUN_STATE_DIR-style restart", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "callback-state-"));
    const statePath = path.join(dir, "stockbot-callback-events.json");
    try {
      const first = new StockBotEventDeduper(100, statePath);
      expect(first.begin("restart-event")).toBe(true);
      first.markApplied("restart-event");
      expect(new StockBotEventDeduper(100, statePath).begin("restart-event")).toBe(false);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it("atomically excludes a concurrent reservation from another process instance", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "callback-concurrent-"));
    const statePath = path.join(dir, "events.json");
    try {
      const first = new StockBotEventDeduper(100, statePath);
      const second = new StockBotEventDeduper(100, statePath);
      expect(first.begin("same-event")).toBe(true);
      expect(second.begin("same-event")).toBe(false);
      first.forget("same-event");
      expect(second.begin("same-event")).toBe(true);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it("treats a durable per-event applied marker as authoritative if the summary cache write fails", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "callback-summary-fail-"));
    const statePath = path.join(dir, "summary");
    try {
      const deduper = new StockBotEventDeduper(100, statePath);
      expect(deduper.begin("summary-event")).toBe(true);
      fs.unlinkSync(statePath); fs.mkdirSync(statePath);
      expect(() => deduper.markApplied("summary-event")).not.toThrow();
      expect(deduper.state("summary-event")).toBe("applied");
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it("reclaims a stale pending reservation after a crashed process", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "callback-stale-"));
    const statePath = path.join(dir, "events.json");
    try {
      const first = new (StockBotEventDeduper as any)(100, statePath, 50);
      expect(first.begin("crashed-event")).toBe(true);
      const old = Date.now() - 1_000;
      const central = JSON.parse(fs.readFileSync(statePath, "utf8"));
      central[0][1].at = old;
      fs.writeFileSync(statePath, JSON.stringify(central));
      const reservationPath = path.join(`${statePath}.events`, createHash("sha256").update("crashed-event").digest("hex"));
      const reservation = JSON.parse(fs.readFileSync(reservationPath, "utf8"));
      reservation.at = old;
      fs.writeFileSync(reservationPath, JSON.stringify(reservation));
      expect(new (StockBotEventDeduper as any)(100, statePath, 50).begin("crashed-event")).toBe(true);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
