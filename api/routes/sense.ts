import { Router } from 'express';
import type { LinkedInWebhookPayload } from '../../workers/linkedinWebhook.js';
import { runCommercialSense, type SenseResult } from '../../agents/sense/senseCore.js';
import { getSenseStats, getRecentEvents } from '../../agents/sense/senseLogger.js';
import { logger } from '../../config/logger.js';

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

// GET /api/sense/stats — contadores para o dashboard
senseRouter.get('/stats', (_req, res) => {
  res.json(getSenseStats());
});

// GET /api/sense/events — eventos recentes para o dashboard
senseRouter.get('/events', (req, res) => {
  const limit = Math.min(Number((req.query as Record<string, string>).limit ?? 20), 100);
  res.json(getRecentEvents(limit));
});
