import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { LabStore, LabConflictError, BriefInputSchema, FindingIdSchema } from "./lab.js";
import { captureDiscussion, parseDiscussionUrl } from "./labSources.js";
import { LAB_DASHBOARD_HTML } from "./labDashboard.js";

export function registerLabRoutes(app: FastifyInstance, store: LabStore, authorized: (request: any) => boolean, capture = captureDiscussion,
  currentFinding: (id: string) => Promise<{ title: string; summary: string } | null> = async () => null) {
  const owner = async (request: any, reply: any) => {
    if (!authorized(request)) return reply.code(401).send({ error: "Owner authentication required. Configure AUTH_TOKEN and unlock this browser." });
  };
  const failure = (reply: any, error: unknown) => {
    if (error instanceof LabConflictError) return reply.code(409).send({ error: error.message });
    if (error instanceof z.ZodError) return reply.code(400).send({ error: error.issues.map(item => `${item.path.join(".")}: ${item.message}`).join("; ") });
    const message = error instanceof Error ? error.message : "Community Lab request failed";
    if (message === "Brief not found") return reply.code(404).send({ error: message });
    if (message.startsWith("Each evidence") || message.startsWith("Save a Try") || message.startsWith("An ordinary brief") || message.startsWith("A brief without")) return reply.code(400).send({ error: message });
    requestError(reply, error); return reply.code(500).send({ error: "Community Lab save could not be confirmed. Reload to check the saved state and inspect server logs before retrying." });
  };
  app.get("/lab", async (_request, reply) => reply.type("text/html; charset=utf-8").send(LAB_DASHBOARD_HTML));
  app.get("/api/public/lab", async () => store.publicFeed());
  app.get("/api/lab", { preHandler: owner }, async () => store.read());
  const validateFinding = async (id: string, reply: any) => {
    const parsed = FindingIdSchema.safeParse(id);
    if (!parsed.success) { reply.code(400).send({ error: "Invalid finding ID" }); return null; }
    const finding = await currentFinding(id);
    if (!finding) { reply.code(404).send({ error: "Finding not found" }); return null; }
    return finding;
  };
  app.get<{ Params: { id: string } }>("/api/lab/reviews/:id", { preHandler: owner }, async (request, reply) => {
    try { if (!await validateFinding(request.params.id, reply)) return; const review = store.review(request.params.id); return { review, brief: review?.briefId ? store.read().briefs.find(value => value.id === review.briefId) ?? null : null }; }
    catch (error) { return failure(reply, error); }
  });
  app.put<{ Params: { id: string } }>("/api/lab/reviews/:id", { preHandler: owner }, async (request, reply) => {
    try { if (!await validateFinding(request.params.id, reply)) return; return { review: store.saveReview(request.params.id, request.body) }; }
    catch (error) { return failure(reply, error); }
  });
  app.post<{ Params: { id: string } }>("/api/lab/reviews/:id/experiment", { preHandler: owner }, async (request, reply) => {
    try {
      const finding = await validateFinding(request.params.id, reply); if (!finding) return;
      const input = z.object({ question: z.string(), successCriteria: z.string(), title: z.string().optional(), problem: z.string().optional() }).strict().parse(request.body);
      const brief = store.createFindingExperiment(request.params.id, { ...input, title: input.title || finding.title.slice(0, 200), problem: input.problem || finding.summary || finding.title });
      return reply.code(201).send({ brief });
    } catch (error) { return failure(reply, error); }
  });
  let capturing = false;
  app.post("/api/lab/capture", { preHandler: owner }, async (request, reply) => {
    let url: string;
    try { url = z.object({ url: z.string().max(2048) }).strict().parse(request.body).url; parseDiscussionUrl(url); }
    catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "Invalid discussion URL" }); }
    if (capturing) return reply.code(429).send({ error: "A capture is already running. Try again shortly." });
    capturing = true;
    try { const captured = await capture(url); const evidence = store.saveEvidence(captured); return reply.code(201).send({ evidence }); }
    catch (error) { requestError(reply, error); return reply.code(502).send({ error: "Capture or save failed. Reload to check the saved state. Check the source is public and, for GitHub Discussions, GITHUB_TOKEN is configured." }); }
    finally { capturing = false; }
  });
  app.post("/api/lab/briefs", { preHandler: owner }, async (request, reply) => {
    try { return reply.code(201).send({ brief: store.createBrief(request.body) }); }
    catch (error) { return failure(reply, error); }
  });
  app.patch<{ Params: { id: string } }>("/api/lab/briefs/:id", { preHandler: owner }, async (request, reply) => {
    try {
      const body = z.object({ expectedUpdatedAt: z.string().datetime() }).passthrough().parse(request.body);
      const { expectedUpdatedAt, ...input } = body;
      return { brief: store.updateBrief(request.params.id, input, expectedUpdatedAt) };
    } catch (error) { return failure(reply, error); }
  });
}
function requestError(reply: any, error: unknown) { reply.log.error({ err: error }, "Community Lab request failed"); }
