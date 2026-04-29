import Fastify from "fastify";

export function buildServer() {
  const app = Fastify({ logger: false });

  app.get("/healthz", async () => {
    return { ok: true };
  });

  return app;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const app = buildServer();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen({ port, host: "0.0.0.0" });
  console.log(`listening on port ${port}`);
}
