import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Fastify, { FastifyRequest, FastifyReply } from 'fastify';
import { handleLinkedInWebhook, type LinkedInWebhookPayload } from './linkedinWebhook.js';

// Load .env before anything else
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
try {
  const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf-8');
  for (const line of env.split(/\r?\n/)) {
    const m = line.match(/^([^#=\s]+)\s*=\s*(.+)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  }
} catch { /* ignore */ }

const app = Fastify({ logger: true });

// Rota genérica — usada internamente e por integrações snake_case
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

// Rota Waalaxy — recebe evento "prospect replied" e dispara classificação + Telegram
app.post('/webhook/waalaxy', async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    const body = request.body as LinkedInWebhookPayload;

    // Waalaxy envia eventos de vários tipos — só processa respostas de prospects
    const reply_text = body.message ?? body.lastMessage ?? (body as Record<string, unknown>).reply as string;
    if (!reply_text) {
      return reply.send({ status: 'ignored', reason: 'no message content' });
    }

    console.log('[Waalaxy] Resposta recebida de:', body.firstName ?? body.prospect_name ?? body.name);
    const result = await handleLinkedInWebhook(body);
    return reply.send({ status: 'ok', result });
  } catch (err) {
    console.error('[Waalaxy] Webhook error:', err);
    return reply.status(500).send({ status: 'error' });
  }
});

app.get('/health', async () => ({ status: 'ok', agent: 'VRAXIA SDR' }));

const PORT = Number(process.env.PORT ?? process.env.WEBHOOK_PORT) || 3001;

app.listen({ port: PORT, host: '0.0.0.0' }, (err: Error | null) => {
  if (err) throw err;
  console.log(`🚀 Webhook server rodando na porta ${PORT}`);
});
