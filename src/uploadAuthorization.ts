import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const UploadClaimsSchema = z.object({
  analysisId: z.string().min(1).max(200),
  exp: z.number().int().positive(),
  idempotencyKey: z.string().min(1).max(300),
  intent: z.literal("finance"),
  origin: z.literal("dashboard"),
  size: z.number().int().min(0).max(20 * 1024 * 1024),
}).strict();
export type UploadClaims = z.infer<typeof UploadClaimsSchema>;

export function verifyUploadToken(token: string, secret: string, nowSeconds = Math.floor(Date.now() / 1_000)): UploadClaims {
  if (!secret) throw new Error("upload secret is not configured");
  const [segment, signature, extra] = token.split(".");
  if (!segment || !signature || extra || !/^[A-Za-z0-9_-]+$/.test(segment) || !/^[a-f0-9]{64}$/.test(signature)) throw new Error("invalid upload token");
  const expected = createHmac("sha256", secret).update(segment).digest();
  const supplied = Buffer.from(signature, "hex");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new Error("invalid upload token signature");
  let decoded: unknown;
  try { decoded = JSON.parse(Buffer.from(segment, "base64url").toString("utf8")); } catch { throw new Error("invalid upload token payload"); }
  const claims = UploadClaimsSchema.parse(decoded);
  const canonical = JSON.stringify(Object.fromEntries(Object.entries(claims).sort(([a], [b]) => a.localeCompare(b))));
  if (Buffer.from(canonical).toString("base64url") !== segment) throw new Error("upload token payload must be compact sorted JSON");
  if (claims.exp < nowSeconds) throw new Error("upload token expired");
  if (claims.exp > nowSeconds + 600) throw new Error("upload token lifetime exceeds 10 minutes");
  return claims;
}
