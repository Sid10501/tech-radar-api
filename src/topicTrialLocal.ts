import { buildServer } from './server.js';

/** Local, single-process review entrypoint: no run recovery or remote repo sync. */
export function buildTopicTrialServer() {
  if (!process.env['TOPIC_SUGGESTIONS_FILE'] || !process.env['RUN_STATE_DIR']) throw new Error('Configure the trial batch and state directory');
  if (process.env['AI_MEMORY_REPO']) throw new Error('Unset AI_MEMORY_REPO for the local trial; use a local read-only findings checkout');
  const app = buildServer();
  app.addHook('onRequest', async (request, reply) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
    const pathname = request.url.split('?')[0];
    if (request.method === 'POST' && (pathname === '/api/unlock' || /^\/api\/topic-suggestions\/[a-z0-9_-]+\/feedback$/.test(pathname))) return;
    return reply.code(403).send({error:'This local trial only saves topic feedback. Processing is disabled.'});
  });
  return app;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const app = buildTopicTrialServer();
  await app.listen({host:'127.0.0.1',port:Number(process.env['PORT'] ?? 8767)});
}
