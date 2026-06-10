import Fastify, { FastifyRequest, FastifyReply } from 'fastify';
import { handleLinkedInWebhook, type LinkedInWebhookPayload } from './linkedinWebhook.js';

const app = Fastify({ logger: true });

app.post('/webhook/linkedin', async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    const body = request.body as LinkedInWebhookPayload;
    const result = await handleLinkedInWebhook(body);
    return reply.send({ status: 'ok', result });
  } catch (err) {
    console.error('Webhook error:', err);
    return reply.status(500).send({ status: 'error' });
  }
});

app.get('/health', async () => ({ status: 'ok', agent: 'VRAXIA SDR' }));

const PORT = Number(process.env.WEBHOOK_PORT) || 3001;

app.listen({ port: PORT, host: '0.0.0.0' }, (err: Error | null) => {
  if (err) throw err;
  console.log(`🚀 Webhook server rodando na porta ${PORT}`);
});
