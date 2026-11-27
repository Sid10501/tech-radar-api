import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { TopicSuggestionStore, feedbackSchema } from './topicSuggestions.js';
import { TOPIC_SUGGESTIONS_HTML } from './topicSuggestionsPage.js';

export function registerTopicSuggestionRoutes(app: FastifyInstance, store: TopicSuggestionStore, auth: preHandlerHookHandler) {
  app.get('/suggestions', async (_request, reply) => reply.type('text/html; charset=utf-8').send(TOPIC_SUGGESTIONS_HTML));
  app.get('/api/topic-suggestions', { preHandler: auth }, async (_request, reply) => {
    try { return store.list(); }
    catch { return reply.code(503).send({error: 'Saved feedback could not be read. Please try again after checking the trial log.'}); }
  });
  app.post<{Params: {id: string}}>('/api/topic-suggestions/:id/feedback', { preHandler: auth, bodyLimit: 2048 }, async (request, reply) => {
    const origin = request.headers.origin;
    if (origin) {
      let sameOrigin = false;
      try {
        const url = new URL(origin);
        sameOrigin = url.origin === origin && url.host === request.headers.host &&
          (url.protocol === 'https:' || (url.protocol === 'http:' && process.env['NODE_ENV'] !== 'production'));
      } catch { /* malformed or opaque origin */ }
      if (!sameOrigin) return reply.code(403).send({error:'Origin not allowed'});
    }
    if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) return reply.code(415).send({error:'JSON required'});
    const parsed = feedbackSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({error:'Invalid feedback'});
    try {
      const result = store.save(request.params.id, parsed.data);
      if (result.status !== 200) return reply.code(result.status).send({error:result.error});
      return {ok:true, feedback:result.feedback};
    } catch { return reply.code(503).send({error:'Your choice could not be saved. Please try again.'}); }
  });
}
