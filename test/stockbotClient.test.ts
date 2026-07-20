import { describe, expect, it, vi } from "vitest";
import { StockBotClient, StockBotClientError } from "../src/stockbotClient.js";
import type { SocialVideoEvidenceV1 } from "../src/schemas/socialVideoEvidence.js";

const evidence = {
  schemaVersion: 1,
  idempotencyKey: "run:finance-v1",
  origin: { channel: "api", runId: "run" },
  source: { url: "https://example.com/v", canonicalUrl: "https://example.com/v", platform: "other", durationSeconds: 1 },
  classification: { category: "finance", confidence: 1, reasons: ["explicit"] },
  transcript: { segments: [] },
  visualTexts: [],
  extraction: { methods: [], warnings: [] },
  financeClaims: { securities: [] },
} as SocialVideoEvidenceV1;

describe("StockBotClient", () => {
  it("posts typed evidence with the separate service bearer token and idempotency key", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ analysis_id: "analysis-1", status: "pending", deduplicated: false }), {
      status: 202,
      headers: { "content-type": "application/json" },
    }));
    const client = new StockBotClient({ baseUrl: "https://stockbot.test", serviceToken: "service-secret", timeoutMs: 500 }, fetcher);

    await expect(client.submitVideoEvidence(evidence)).resolves.toEqual({ analysisId: "analysis-1", status: "pending", deduplicated: false });
    expect(fetcher).toHaveBeenCalledWith("https://stockbot.test/api/internal/video-evidence", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ Authorization: "Bearer service-secret", "Idempotency-Key": evidence.idempotencyKey }),
    }));
  });

  it("accepts the camelCase response alias", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ analysisId: "analysis-2", status: "accepted", deduplicated: true }), { status: 202 }));
    const client = new StockBotClient({ baseUrl: "https://stockbot.test", serviceToken: "secret" }, fetcher);
    await expect(client.submitVideoEvidence(evidence)).resolves.toMatchObject({ analysisId: "analysis-2", deduplicated: true });
  });

  it("maps timeout and downstream failures without leaking the service token", async () => {
    const timeoutFetcher = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted service-secret"), { name: "AbortError" })));
    }));
    const timed = new StockBotClient({ baseUrl: "https://stockbot.test", serviceToken: "service-secret", timeoutMs: 5 }, timeoutFetcher);
    await expect(timed.submitVideoEvidence(evidence)).rejects.toMatchObject({ code: "timeout" });

    const failed = new StockBotClient({ baseUrl: "https://stockbot.test", serviceToken: "service-secret" }, async () => new Response("internal secret details", { status: 503 }));
    const error = await failed.submitVideoEvidence(evidence).then(
      () => { throw new Error("expected StockBot submission to fail"); },
      (err: unknown) => err as StockBotClientError,
    );
    expect(error).toMatchObject({ code: "downstream", statusCode: 503 });
    expect(error.message).not.toContain("service-secret");
    expect(error.message).not.toContain("internal secret details");
  });
});
