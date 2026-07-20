import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { StockBotEventDeduper, verifyStockBotCallback } from "../src/stockbotCallback.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const payload = {
  eventId: "event-1",
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

  it("deduplicates event IDs for exactly-once callback side effects", () => {
    const deduper = new StockBotEventDeduper();
    expect(deduper.accept("event-1")).toBe(true);
    expect(deduper.accept("event-1")).toBe(false);
    expect(deduper.accept("event-2")).toBe(true);
  });

  it("preserves callback event dedupe across a RUN_STATE_DIR-style restart", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "callback-state-"));
    const statePath = path.join(dir, "stockbot-callback-events.json");
    try {
      expect(new StockBotEventDeduper(100, statePath).accept("restart-event")).toBe(true);
      expect(new StockBotEventDeduper(100, statePath).accept("restart-event")).toBe(false);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
