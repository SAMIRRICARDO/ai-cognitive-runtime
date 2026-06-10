import { processLinkedInReply } from '../agents/lead-classifier/classifier.js';
import { notifyTelegram as notifyWhatsApp } from '../tools/telegram.js';

export interface LinkedInWebhookPayload {
  name:        string;
  company:     string;
  role:        string;
  linkedinUrl: string;
  reply:       string;
}

export async function handleLinkedInWebhook(payload: LinkedInWebhookPayload) {
  return processLinkedInReply(payload.reply, {
    name:        payload.name,
    company:     payload.company,
    role:        payload.role,
    linkedinUrl: payload.linkedinUrl,
  });
}
