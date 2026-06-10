/**
 * notifyManager — canal de notificação para handoffs do pipeline.
 *
 * Plugar o canal preferido via variável de ambiente:
 *   NOTIFY_CHANNEL=slack    → SLACK_WEBHOOK_URL
 *   NOTIFY_CHANNEL=email    → RESEND_API_KEY + NOTIFY_EMAIL_TO
 *   NOTIFY_CHANNEL=telegram → TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID
 *   NOTIFY_CHANNEL=console  → apenas loga no terminal (default)
 */

import { logger } from '../../config/logger.js';
import { notifyWhatsApp } from '../../tools/whatsapp.js';
import { notifyTelegram as _notifyTelegram } from '../../tools/telegram.js';

type NotifyChannel = 'slack' | 'email' | 'telegram' | 'whatsapp' | 'console';

const CHANNEL = (process.env['NOTIFY_CHANNEL'] ?? 'console') as NotifyChannel;

// ─── Slack ────────────────────────────────────────────────────────────────────

async function notifySlack(report: string): Promise<void> {
  const webhookUrl = process.env['SLACK_WEBHOOK_URL'];
  if (!webhookUrl) throw new Error('SLACK_WEBHOOK_URL não definida');

  const res = await fetch(webhookUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      text: '🔔 *VRAXIA — Lead qualificado para handoff*',
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `\`\`\`\n${report}\n\`\`\`` },
        },
      ],
    }),
  });

  if (!res.ok) throw new Error(`Slack retornou ${res.status}`);
}

// ─── Email (Resend) ───────────────────────────────────────────────────────────

async function notifyEmail(report: string): Promise<void> {
  const apiKey = process.env['RESEND_API_KEY'];
  const to     = process.env['NOTIFY_EMAIL_TO'];
  if (!apiKey) throw new Error('RESEND_API_KEY não definida');
  if (!to)     throw new Error('NOTIFY_EMAIL_TO não definida');

  const { Resend } = await import('resend');
  const resend = new Resend(apiKey);

  const { error } = await resend.emails.send({
    from:    'contato@vrashows.com.br',
    to,
    subject: '🔔 VRAXIA — Lead qualificado para handoff',
    text:    report,
  });

  if (error) throw new Error(error.message);
}

// ─── Telegram (delegado para tools/telegram.ts) ───────────────────────────────

async function notifyTelegram(report: string): Promise<void> {
  await _notifyTelegram(report);
}

// ─── Console (fallback) ───────────────────────────────────────────────────────

function notifyConsole(report: string): void {
  console.log('\n' + '═'.repeat(50));
  console.log('  🔔 HANDOFF — notificação via console');
  console.log('═'.repeat(50));
  console.log(report);
  console.log('═'.repeat(50) + '\n');
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function notifyManager(report: string): Promise<void> {
  try {
    switch (CHANNEL) {
      case 'slack':     await notifySlack(report);      break;
      case 'email':     await notifyEmail(report);      break;
      case 'telegram':  await notifyTelegram(report);   break;
      case 'whatsapp':  await notifyWhatsApp(report);   break;
      default:          notifyConsole(report);
    }

    logger.info('[notify] handoff enviado', { channel: CHANNEL });

  } catch (err) {
    // Notify failure nunca deve parar o pipeline — loga e continua
    logger.error('[notify] falha ao notificar', {
      channel: CHANNEL,
      error:   err instanceof Error ? err.message : String(err),
    });
    // Fallback: sempre loga no console se o canal falhar
    if (CHANNEL !== 'console') notifyConsole(report);
  }
}
