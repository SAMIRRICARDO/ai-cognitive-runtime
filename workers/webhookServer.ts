import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Fastify, { FastifyRequest, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import { handleLinkedInWebhook, type LinkedInWebhookPayload } from './linkedinWebhook.js';
import { runCommercialSense, type SenseResult } from '../agents/sense/senseCore.js';
import { runCommercialSense as runCommercialChat } from '../agents/sense/senseOrchestrator.js';
import { createEmptySession } from '../memory/sessionMemory.js';
import type { SessionMemory } from '../memory/sessionMemory.js';

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
await app.register(cors, { origin: true });

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

// ── VRAXIA SENSE — percepção proativa comercial ────────────────────────────
// Entrada separada do /webhook/waalaxy existente.
// Rota: POST /sense/commercial
// Aceita: { prospect_name, company, job_title, linkedin_url, message_content }
// Fluxo: Nível 0 (filtro grátis) → Nível 1 (Haiku triagem) → Nível 2 (classify + Telegram)
app.post('/sense/commercial', async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    const event = request.body as Parameters<typeof runCommercialSense>[0];
    const result: SenseResult = await runCommercialSense(event);
    return reply.send(result);
  } catch (err) {
    console.error('[Sense] Erro no pipeline:', err);
    return reply.status(500).send({ processed: false, stage: 'error', detail: String(err) });
  }
});

// ── VRAXIA Commercial Sense — Chat autônomo com Session Memory ────────────────
// Rota: POST /sense/commercial/chat
// Aceita: { sessionId: string, message: string }
// Retorna: resultado do pipeline + memória atualizada
const sessionStore = new Map<string, SessionMemory>();

app.post('/sense/commercial/chat', async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    const { sessionId, message } = request.body as { sessionId: string; message: string };
    if (!sessionId || !message) {
      return reply.status(400).send({ error: 'sessionId e message são obrigatórios' });
    }

    const memory = sessionStore.get(sessionId) ?? createEmptySession(sessionId);
    const result = await runCommercialChat(message, memory);
    sessionStore.set(sessionId, result.updated_memory);

    return reply.send({
      session_id: sessionId,
      message: result.formatted_response,
      raw: result.response,
      next_action: result.next_action,
      plan_executed: result.plan_executed
    });
  } catch (err) {
    console.error('[CommercialChat] Erro:', err);
    return reply.status(500).send({ error: String(err) });
  }
});

app.get('/sense/commercial/chat', async (_request: FastifyRequest, reply: FastifyReply) => {
  reply.header('Cache-Control', 'no-store').type('text/html').send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>VRAXIA Sense — SDR</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f0f13;color:#e8e8f0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center}
  h1{font-size:1.1rem;font-weight:600;letter-spacing:.05em;color:#a78bfa;margin-bottom:1.5rem}
  #chat{width:min(680px,96vw);display:flex;flex-direction:column;gap:.75rem;height:70vh}
  #messages{flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:.6rem;padding:.5rem 0}
  .msg{padding:.65rem 1rem;border-radius:.75rem;max-width:85%;font-size:.9rem;line-height:1.5;white-space:pre-wrap;word-break:break-word}
  .user{align-self:flex-end;background:#5b21b6;color:#fff}
  .bot{align-self:flex-start;background:#1e1e2e;border:1px solid #2d2d44;color:#e8e8f0}
  .bot pre{background:#111827;border-radius:.4rem;padding:.6rem;overflow-x:auto;font-size:.78rem;margin-top:.4rem}
  #form{display:flex;gap:.5rem}
  #input{flex:1;padding:.7rem 1rem;border-radius:.5rem;border:1px solid #3d3d5c;background:#1a1a28;color:#e8e8f0;font-size:.9rem;outline:none}
  #input:focus{border-color:#7c3aed}
  button{padding:.7rem 1.2rem;border-radius:.5rem;background:#7c3aed;color:#fff;border:none;cursor:pointer;font-size:.9rem;font-weight:600}
  button:hover{background:#6d28d9}
  button:disabled{opacity:.5;cursor:not-allowed}
  .loading{color:#6b7280;font-style:italic;font-size:.82rem}
</style>
</head>
<body>
<h1>⚡ VRAXIA Sense — SDR Comercial</h1>
<div id="chat">
  <div id="messages"><div class="msg bot">Olá! Sou o SDR da VRASHOWS. Como posso ajudar? Tente: <em>"Me traga um diretor de marketing em telecom em SP"</em></div></div>
  <form id="form" onsubmit="send(event)">
    <input id="input" type="text" placeholder="Digite sua mensagem..." autocomplete="off" autofocus>
    <button id="btn" type="submit">Enviar</button>
  </form>
</div>
<script>
const sessionId = 'browser-' + Math.random().toString(36).slice(2,8);
const msgs = document.getElementById('messages');
const input = document.getElementById('input');
const btn = document.getElementById('btn');

function addMsg(text, cls) {
  const d = document.createElement('div');
  d.className = 'msg ' + cls;
  d.textContent = String(text);
  msgs.appendChild(d);
  msgs.scrollTop = msgs.scrollHeight;
}

async function send(e) {
  e.preventDefault();
  const msg = input.value.trim();
  if (!msg) return;
  addMsg(msg, 'user');
  input.value = '';
  btn.disabled = true;
  const loading = document.createElement('div');
  loading.className = 'msg bot loading';
  loading.textContent = 'Processando...';
  msgs.appendChild(loading);
  msgs.scrollTop = msgs.scrollHeight;
  try {
    const res = await fetch('/sense/commercial/chat', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ sessionId, message: msg })
    });
    const data = await res.json();
    loading.remove();
    addMsg(data.message ?? '✅ Feito.', 'bot');
  } catch(err) {
    loading.remove();
    addMsg('Erro: ' + err.message, 'bot');
  } finally {
    btn.disabled = false;
    input.focus();
  }
}
</script>
</body>
</html>`);
});

app.get('/vraxia', async (_request: FastifyRequest, reply: FastifyReply) => {
  const html = fs.readFileSync(path.join(ROOT, 'dashboard/vraxia/index.html'), 'utf-8');
  reply.header('Cache-Control', 'no-store').type('text/html').send(html);
});

app.get('/vraxia/comercial.html', async (_request: FastifyRequest, reply: FastifyReply) => {
  reply.redirect('/dashboard');
});

app.get('/dashboard', async (_request: FastifyRequest, reply: FastifyReply) => {
  const html = fs.readFileSync(path.join(ROOT, 'dashboard/vraxia/comercial.html'), 'utf-8');
  reply.header('Cache-Control', 'no-store').type('text/html').send(html);
});

app.get('/health', async () => ({ status: 'ok', agent: 'VRAXIA SDR', sense: 'active' }));

const PORT = Number(process.env.PORT ?? process.env.WEBHOOK_PORT) || 3001;

app.listen({ port: PORT, host: '0.0.0.0' }, (err: Error | null) => {
  if (err) throw err;
  console.log(`🚀 Webhook server rodando na porta ${PORT}`);
});
