import { z } from "zod";
import { SocialVideoEvidenceV1Schema, type SocialVideoEvidenceV1 } from "./schemas/socialVideoEvidence.js";

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export interface StockBotClientConfig {
  baseUrl: string;
  serviceToken: string;
  timeoutMs?: number;
}

export interface StockBotSubmission {
  analysisId: string;
  status: string;
  deduplicated: boolean;
}

export class StockBotClientError extends Error {
  constructor(
    public readonly code: "configuration" | "timeout" | "network" | "downstream" | "invalid_response",
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = "StockBotClientError";
  }
}

const ResponseSchema = z.object({
  analysis_id: z.string().min(1).optional(),
  analysisId: z.string().min(1).optional(),
  status: z.string().min(1),
  deduplicated: z.boolean(),
}).refine((value) => Boolean(value.analysis_id ?? value.analysisId), { message: "analysis id is required" });

export class StockBotClient {
  constructor(private readonly config: StockBotClientConfig, private readonly fetcher: Fetcher = fetch) {}

  async submitVideoEvidence(input: SocialVideoEvidenceV1): Promise<StockBotSubmission> {
    if (!this.config.baseUrl || !this.config.serviceToken) {
      throw new StockBotClientError("configuration", "StockBot client is not configured");
    }
    const evidence = SocialVideoEvidenceV1Schema.parse(input);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(1, Math.min(this.config.timeoutMs ?? 10_000, 30_000)));
    let response: Response;
    try {
      response = await this.fetcher(`${this.config.baseUrl.replace(/\/$/, "")}/api/internal/video-evidence`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.serviceToken}`,
          "Content-Type": "application/json",
          "Idempotency-Key": evidence.idempotencyKey,
        },
        body: JSON.stringify(evidence),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
        throw new StockBotClientError("timeout", "StockBot request timed out");
      }
      throw new StockBotClientError("network", "StockBot request failed");
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      throw new StockBotClientError("downstream", `StockBot returned HTTP ${response.status}`, response.status);
    }
    let parsed: z.infer<typeof ResponseSchema>;
    try {
      parsed = ResponseSchema.parse(await response.json());
    } catch {
      throw new StockBotClientError("invalid_response", "StockBot returned an invalid response", response.status);
    }
    return { analysisId: parsed.analysis_id ?? parsed.analysisId!, status: parsed.status, deduplicated: parsed.deduplicated };
  }
}
