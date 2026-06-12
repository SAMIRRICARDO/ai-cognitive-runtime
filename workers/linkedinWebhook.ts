import { processLinkedInReply } from '../agents/lead-classifier/classifier.js';
import { notifyTelegram as notifyWhatsApp } from '../tools/telegram.js';

export interface LinkedInWebhookPayload {
  // Waalaxy (campos nativos da plataforma)
  firstName?:       string;
  lastName?:        string;
  occupation?:      string;
  linkedInUrl?:     string;  // Waalaxy usa camelCase com I maiúsculo
  message?:         string;
  lastMessage?:     string;
  // Formato interno snake_case (legado)
  prospect_name?:   string;
  job_title?:       string;
  linkedin_url?:    string;
  message_content?: string;
  // Formato interno camelCase
  name?:            string;
  role?:            string;
  linkedinUrl?:     string;
  reply?:           string;
  // Compartilhado
  company?:         string;
  companyName?:     string;
}

function normalizePayload(p: LinkedInWebhookPayload) {
  const fullName = p.name ?? p.prospect_name
    ?? (p.firstName && p.lastName ? `${p.firstName} ${p.lastName}` : p.firstName)
    ?? 'Desconhecido';

  return {
    name:        fullName,
    company:     p.company ?? p.companyName ?? 'Não informada',
    role:        p.role ?? p.job_title ?? p.occupation ?? 'Não informado',
    linkedinUrl: p.linkedinUrl ?? p.linkedInUrl ?? p.linkedin_url ?? '',
    reply:       p.reply ?? p.message ?? p.lastMessage ?? p.message_content ?? '',
  };
}

export async function handleLinkedInWebhook(payload: LinkedInWebhookPayload) {
  const normalized = normalizePayload(payload);
  return processLinkedInReply(normalized.reply, normalized);
}
