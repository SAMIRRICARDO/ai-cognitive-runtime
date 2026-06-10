import { processLinkedInReply } from '../agents/lead-classifier/classifier.js';
import { notifyTelegram as notifyWhatsApp } from '../tools/telegram.js';

// Aceita campos no formato Waalaxy (snake_case) e formato interno (camelCase)
export interface LinkedInWebhookPayload {
  // Waalaxy / snake_case
  prospect_name?:   string;
  job_title?:       string;
  linkedin_url?:    string;
  message_content?: string;
  // Interno / camelCase
  name?:            string;
  role?:            string;
  linkedinUrl?:     string;
  reply?:           string;
  // Compartilhado
  company:          string;
}

function normalizePayload(p: LinkedInWebhookPayload) {
  return {
    name:        p.name        ?? p.prospect_name   ?? 'Desconhecido',
    company:     p.company,
    role:        p.role        ?? p.job_title        ?? 'Não informado',
    linkedinUrl: p.linkedinUrl ?? p.linkedin_url     ?? '',
    reply:       p.reply       ?? p.message_content  ?? '',
  };
}

export async function handleLinkedInWebhook(payload: LinkedInWebhookPayload) {
  const normalized = normalizePayload(payload);
  return processLinkedInReply(normalized.reply, normalized);
}
