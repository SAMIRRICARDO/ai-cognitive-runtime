import { Router } from 'express';
import type { LinkedInWebhookPayload } from '../../workers/linkedinWebhook.js';
import { runCommercialSense, type SenseResult } from '../../agents/sense/senseCore.js';
import { runCommercialSense as runCommercialChat } from '../../agents/sense/senseOrchestrator.js';
import { createEmptySession } from '../../memory/sessionMemory.js';
import type { SessionMemory } from '../../memory/sessionMemory.js';
import { getSenseStats, getRecentEvents } from '../../agents/sense/senseLogger.js';
import { logger } from '../../config/logger.js';

const sessionStore = new Map<string, SessionMemory>();

export const senseRouter = Router();

// Normaliza qualquer variação de payload Waalaxy/interno para RawEvent
function toRawEvent(body: LinkedInWebhookPayload) {
  const fullName =
    body.prospect_name ?? body.name ??
    (body.firstName && body.lastName ? `${body.firstName} ${body.lastName}` : body.firstName) ?? '';
  return {
    prospect_name:   fullName,
    company:         body.company ?? body.companyName ?? '',
    job_title:       body.job_title ?? body.role ?? body.occupation ?? '',
    linkedin_url:    body.linkedin_url ?? body.linkedinUrl ?? body.linkedInUrl ?? '',
    message_content: body.message_content ?? body.reply ?? body.message ?? body.lastMessage ?? '',
  };
}

// POST /api/sense/commercial — entrada do Waalaxy (sem auth — webhook externo)
senseRouter.post('/commercial', async (req, res) => {
  try {
    const event = toRawEvent(req.body as LinkedInWebhookPayload);
    logger.info('[Sense] evento recebido', { prospect: event.prospect_name, company: event.company });
    const result: SenseResult = await runCommercialSense(event);
    res.json(result);
  } catch (err) {
    logger.error('[Sense] erro no pipeline', { err });
    res.status(500).json({ processed: false, stage: 'error', detail: String(err) });
  }
});

// POST /api/sense/commercial/chat — chat autônomo com session memory (sem auth — acesso direto do dashboard)
senseRouter.post('/chat', async (req, res) => {
  try {
    const { sessionId, message } = req.body as { sessionId: string; message: string };
    if (!sessionId || !message) {
      res.status(400).json({ error: 'sessionId e message são obrigatórios' });
      return;
    }
    const memory = sessionStore.get(sessionId) ?? createEmptySession(sessionId);
    const result = await runCommercialChat(message, memory);
    sessionStore.set(sessionId, result.updated_memory);
    res.json({
      session_id: sessionId,
      message: result.formatted_response,
      raw: result.response,
      next_action: result.next_action,
      plan_executed: result.plan_executed
    });
  } catch (err) {
    logger.error('[CommercialChat] erro', { err });
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/sense/stats — contadores para o dashboard
senseRouter.get('/stats', (_req, res) => {
  res.json(getSenseStats());
});

// GET /api/sense/events — eventos recentes para o dashboard
senseRouter.get('/events', (req, res) => {
  const limit = Math.min(Number((req.query as Record<string, string>).limit ?? 20), 100);
  res.json(getRecentEvents(limit));
});
