import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyUploadToken } from "../src/uploadAuthorization.js";

function token(payload: Record<string, unknown>, secret = "upload-secret"): string {
  const sorted = Object.fromEntries(Object.entries(payload).sort(([a], [b]) => a.localeCompare(b)));
  const segment = Buffer.from(JSON.stringify(sorted)).toString("base64url");
  return `${segment}.${createHmac("sha256", secret).update(segment).digest("hex")}`;
}

describe("StockBot direct upload authorization", () => {
  const payload = { analysisId: "analysis-1", idempotencyKey: "key-1", origin: "dashboard", intent: "finance", exp: 2_000, size: 123 };

  it("accepts canonical signed claims and rejects signature, expiry, and excessive lifetime", () => {
    expect(verifyUploadToken(token(payload), "upload-secret", 1_900)).toEqual(payload);
    expect(() => verifyUploadToken(token(payload, "wrong"), "upload-secret", 1_900)).toThrow(/signature/);
    expect(() => verifyUploadToken(token(payload), "upload-secret", 2_001)).toThrow(/expired/);
    expect(() => verifyUploadToken(token({ ...payload, exp: 2_501 }), "upload-secret", 1_900)).toThrow(/10 minutes/);
  });
});
