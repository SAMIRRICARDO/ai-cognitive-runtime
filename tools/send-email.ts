/**
 * send-email tool — Resend API integration for VRASHOWS outreach.
 *
 * Wraps the Resend SDK with:
 * - VRASHOWS branded HTML template + professional signature
 * - Rate limiting (configurable delay between sends)
 * - Deduplication via Redis (per-recipient, configurable window)
 * - Structured logging with delivery tracking
 *
 * Used directly by EmailSenderAgent.registerTool() and also
 * exported as a standalone sendEmail() function for scripts.
 */
import { readFileSync, existsSync } from "fs";
import { basename } from "path";
import { Resend } from "resend";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { RedisMemory } from "../memory/short-term/redis.js";
import { getIALeadsCache } from "../memory/sqlite-cache.js";
import { recordAnalytics } from "../memory/analytics.js";
import { saveLocalMemory } from "../memory/local-rag.js";
import type { ToolHandler } from "../agents/_base/types.js";
import type { EmailRecord, EmailType, EmailSenderOptions } from "../agents/email-sender-agent/types.js";
import { validateSendEmailInput } from "../agents/email-sender-agent/schemas.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_FROM_ADDRESS = env.RESEND_FROM_EMAIL;
const DEFAULT_FROM_NAME    = env.RESEND_FROM_NAME  ?? "Your Name | Your Brand";
const DEFAULT_BCC_ADDRESS  = env.OUTBOUND_BCC_EMAIL ?? undefined;
const DEFAULT_RATE_DELAY   = 1200; // ms between sends (< Resend's 2 req/s limit)
const DEFAULT_DEDUP_DAYS   = 7;
const DEDUP_KEY_PREFIX     = "email:sent:";

// ─── Utilities ────────────────────────────────────────────────────────────────

/** Extract first name for personalized greeting: "Rachel Louise Wilson" → "Rachel" */
export function extractFirstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName.trim();
}

/** Subject variant pool — A/B ready, selected deterministically by recipient hash */
export const SUBJECT_VARIANTS = [
  "Operação integrada para eventos corporativos",
  "Como reduzir ruído operacional em eventos corporativos",
  "Experiência operacional premium para eventos corporativos",
  "Estrutura operacional para eventos enterprise",
  "Operação invisível para experiências corporativas",
] as const;

/** Pick subject variant deterministically for a given recipient (consistent A/B) */
export function pickSubjectVariant(recipientEmail: string, override?: string): string {
  if (override) return override;
  let hash = 0;
  for (let i = 0; i < recipientEmail.length; i++) {
    hash = (hash * 31 + recipientEmail.charCodeAt(i)) & 0xffff;
  }
  return SUBJECT_VARIANTS[hash % SUBJECT_VARIANTS.length]!;
}

// ─── VRASHOWS HTML template ───────────────────────────────────────────────────

function buildHtmlEmail(opts: {
  contactName: string;
  company: string;
  bodyHtml: string;
  fromName: string;
  fromAddress?: string;
}): string {
  const { bodyHtml, fromName } = opts;
  const senderEmail = opts.fromAddress ?? DEFAULT_FROM_ADDRESS;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
  <title>VRASHOWS</title>
</head>
<body style="margin:0;padding:0;background:#f0f2f5;font-family:'Segoe UI',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f0f2f5;padding:40px 0;">
    <tr>
      <td align="center" style="padding:0 16px;">
        <table width="600" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border-radius:6px;overflow:hidden;max-width:600px;width:100%;">

          <!-- Header — discreet brand mark, not marketing banner -->
          <tr>
            <td style="background:#0f172a;padding:20px 40px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td>
                    <span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:1.5px;font-family:Georgia,serif;">VRASHOWS</span>
                  </td>
                  <td align="right">
                    <span style="color:#475569;font-size:11px;letter-spacing:0.3px;font-family:'Segoe UI',Arial,sans-serif;">Hub de Operações Enterprise</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body — generous whitespace, readable line-height -->
          <tr>
            <td style="padding:40px 44px 28px;color:#1e293b;font-size:15px;line-height:1.75;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
              ${bodyHtml}
            </td>
          </tr>

          <!-- Signature — oficial institucional VRASHOWS -->
          <tr>
            <td style="padding:0 44px 36px;">
              <table cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid #e2e8f0;padding-top:24px;width:100%;">
                <tr>
                  <td style="vertical-align:top;">
                    <p style="margin:0 0 4px;font-size:15px;font-weight:700;color:#0f172a;font-family:'Segoe UI',Helvetica,Arial,sans-serif;letter-spacing:0.3px;">VRASHOWS</p>
                    <p style="margin:0 0 4px;font-size:12px;color:#64748b;letter-spacing:0.2px;">Operações &amp; Experiência Corporativa · VRASHOWS</p>
                    <p style="margin:0 0 4px;font-size:12px;">
                      <a href="mailto:samir.ricardo@vrashows.com.br" style="color:#2563eb;text-decoration:none;">samir.ricardo@vrashows.com.br</a>
                    </p>
                    <p style="margin:0 0 4px;font-size:12px;">
                      <a href="https://www.vrashows.com.br" style="color:#64748b;text-decoration:none;">www.vrashows.com.br</a>
                    </p>
                    <p style="margin:0 0 0;font-size:12px;color:#64748b;">Whatsapp (11) 95357-7804</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer — professional opt-out, no newsletter feel -->
          <tr>
            <td style="background:#f8fafc;padding:14px 44px;border-top:1px solid #e2e8f0;">
              <p style="margin:0;font-size:11px;color:#94a3b8;line-height:1.5;">
                Caso prefira não receber novos contatos, basta responder este email informando.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ─── Plain text → paragraph HTML ─────────────────────────────────────────────

function textToHtml(text: string): string {
  return text
    .split(/\n\n+/)
    .map((p) => `<p style="margin:0 0 16px;">${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

// ─── Core send function ───────────────────────────────────────────────────────

export interface CoreSendOptions extends EmailSenderOptions {
  resendClient?: Resend;
  memory?: RedisMemory;
  /** Override global BCC. Pass an empty string "" to suppress BCC for a specific send. */
  bcc?: string | string[];
  /** Explicitly disable global BCC for this send */
  suppressBcc?: boolean;
}

export async function sendEmail(
  input: {
    company: string;
    contactName: string;
    recipientEmail: string;
    subject: string;
    bodyText: string;
    bodyHtml?: string;
    emailType?: EmailType;
    sequenceNumber?: number;
    attachmentPath?: string;
  },
  opts: CoreSendOptions = {}
): Promise<EmailRecord> {
  const {
    dryRun = false,
    rateDelayMs = DEFAULT_RATE_DELAY,
    deduplicationWindowDays = DEFAULT_DEDUP_DAYS,
    fromAddress = DEFAULT_FROM_ADDRESS,
    fromName = DEFAULT_FROM_NAME,
    memory,
    resendClient,
  } = opts;

  // BCC: explicit override → env default → undefined (disabled)
  // Set suppressBcc: true to skip BCC for a specific send
  const bcc: string | string[] | undefined =
    opts.suppressBcc ? undefined :
    (opts.bcc !== undefined && opts.bcc !== "") ? opts.bcc :
    DEFAULT_BCC_ADDRESS;

  const emailType = input.emailType ?? "cold-outreach";
  const sequenceNumber = input.sequenceNumber ?? 1;
  const sentAt = new Date().toISOString();

  const baseRecord: Omit<EmailRecord, "messageId" | "status" | "error" | "resendId"> = {
    company: input.company,
    contactName: input.contactName,
    recipientEmail: input.recipientEmail,
    subject: input.subject,
    emailType,
    sequenceNumber,
    sentAt,
  };

  const localCache = getIALeadsCache();
  const existingOutbound = localCache.hasOutbound({
    email: input.recipientEmail,
    emailType,
    sequenceNumber,
  });
  if (existingOutbound) {
    logger.info("[send-email] skipped — local SQLite outbound cache hit", {
      email: input.recipientEmail,
      company: input.company,
      emailType,
      sequenceNumber,
    });
    recordAnalytics({
      provider: "cache",
      source: "send-email",
      cacheHits: 1,
      estimatedSavingsUsd: 0.001,
      metadata: { emailType, sequenceNumber },
    });
    return {
      ...baseRecord,
      messageId: `cached:${input.recipientEmail}:${sentAt}`,
      status: "skipped",
      error: `Already recorded in local outbound cache (${existingOutbound.sent_at})`,
    };
  }

  // ── Deduplication check ──────────────────────────────────────────────────
  if (memory && deduplicationWindowDays > 0) {
    const dedupKey = `${DEDUP_KEY_PREFIX}${input.recipientEmail}`;
    const existing = await memory.get(dedupKey).catch(() => null);
    if (existing) {
      logger.info("[send-email] skipped — dedup window active", {
        email: input.recipientEmail,
        company: input.company,
        sentAt: existing,
      });
      return {
        ...baseRecord,
        messageId: `skipped:${input.recipientEmail}:${sentAt}`,
        status: "skipped",
        error: `Already contacted within ${deduplicationWindowDays} days (last sent: ${existing})`,
      };
    }
  }

  // ── Dry-run mode ─────────────────────────────────────────────────────────
  if (dryRun) {
    logger.info("[send-email] dry-run — email staged but not sent", {
      to: input.recipientEmail,
      company: input.company,
      subject: input.subject,
    });
    return {
      ...baseRecord,
      messageId: `dry:${input.recipientEmail}:${sentAt}`,
      status: "queued",
    };
  }

  // ── Build HTML body ──────────────────────────────────────────────────────
  const rawHtml = input.bodyHtml ?? textToHtml(input.bodyText);
  const fullHtml = buildHtmlEmail({
    contactName: input.contactName,
    company: input.company,
    bodyHtml: rawHtml,
    fromName,
    fromAddress,
  });

  // ── Resolve attachment ────────────────────────────────────────────────────
  type ResendAttachment = { filename: string; content: string };
  let attachments: ResendAttachment[] | undefined;

  if (input.attachmentPath) {
    if (!existsSync(input.attachmentPath)) {
      logger.error("[send-email] attachment not found", { path: input.attachmentPath });
      return {
        ...baseRecord,
        messageId: `failed:${input.recipientEmail}:${sentAt}`,
        status: "failed",
        error: `Attachment file not found: ${input.attachmentPath}`,
      };
    }
    try {
      const fileBuffer = readFileSync(input.attachmentPath);
      attachments = [{
        filename: basename(input.attachmentPath),
        content: fileBuffer.toString("base64"),
      }];
      logger.info("[send-email] attachment loaded", {
        filename: basename(input.attachmentPath),
        sizeKb: Math.round(fileBuffer.byteLength / 1024),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("[send-email] failed to read attachment", { path: input.attachmentPath, error: message });
      return {
        ...baseRecord,
        messageId: `failed:${input.recipientEmail}:${sentAt}`,
        status: "failed",
        error: `Failed to read attachment: ${message}`,
      };
    }
  }

  // ── Send via Resend ──────────────────────────────────────────────────────
  const client = resendClient ?? new Resend(env.RESEND_API_KEY);

  try {
    const response = await client.emails.send({
      from: `${fromName} <${fromAddress}>`,
      to: input.recipientEmail,
      subject: input.subject,
      text: input.bodyText,
      html: fullHtml,
      ...(bcc ? { bcc } : {}),
      ...(attachments ? { attachments } : {}),
    });

    if (response.error) {
      logger.error("[send-email] Resend API error", {
        to: input.recipientEmail,
        company: input.company,
        error: response.error,
      });
      return {
        ...baseRecord,
        messageId: `failed:${input.recipientEmail}:${sentAt}`,
        status: "failed",
        error: response.error.message ?? String(response.error),
      };
    }

    const resendId = response.data?.id ?? "unknown";

    logger.info("[send-email] sent", {
      to: input.recipientEmail,
      bcc: bcc ?? null,
      company: input.company,
      subject: input.subject,
      resendId,
      emailType,
      sequenceNumber,
    });

    // Record in dedup store
    if (memory) {
      const ttl = deduplicationWindowDays * 86400;
      await memory.set(`${DEDUP_KEY_PREFIX}${input.recipientEmail}`, sentAt, ttl).catch(() => {});
    }

    localCache.recordOutbound({
      email: input.recipientEmail,
      company: input.company,
      emailType,
      sequenceNumber,
      status: "sent",
      sentAt,
      metadata: { resendId, subject: input.subject },
    });
    localCache.upsertCompany({ company: input.company, status: "contacted" });
    saveLocalMemory({
      collection: "outbound",
      content: `${emailType} sent to ${input.company} <${input.recipientEmail}>`,
      tags: ["outbound", emailType, input.company],
      metadata: { resendId, sequenceNumber, subject: input.subject },
      id: `outbound:${input.recipientEmail}:${emailType}:${sequenceNumber}`,
    });
    recordAnalytics({
      provider: "outbound",
      source: "send-email",
      requests: 1,
      outboundExecuted: 1,
      metadata: { emailType, sequenceNumber, company: input.company },
    });

    // Rate-limiting delay (non-blocking for last send, still applied for safety)
    if (rateDelayMs > 0) {
      await new Promise<void>((r) => setTimeout(r, rateDelayMs));
    }

    return {
      ...baseRecord,
      messageId: resendId,
      status: "sent",
      resendId,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("[send-email] unexpected error", {
      to: input.recipientEmail,
      company: input.company,
      error: message,
    });
    return {
      ...baseRecord,
      messageId: `error:${input.recipientEmail}:${sentAt}`,
      status: "failed",
      error: message,
    };
  }
}

// ─── Tool handler factory ─────────────────────────────────────────────────────

/**
 * Creates a send_email ToolHandler bound to a shared records array and options.
 * Called by EmailSenderAgent.registerTool().
 */
export function createSendEmailTool(
  records: EmailRecord[],
  opts: CoreSendOptions = {}
): ToolHandler {
  const memory = opts.memory ?? new RedisMemory();
  const resendClient = opts.resendClient ?? new Resend(env.RESEND_API_KEY);

  return {
    name: "send_email",
    schema: {
      name: "send_email",
      description:
        "Send a professional outreach email via Resend API. Applies VRASHOWS HTML template, deduplication, and rate limiting automatically. Call once per recipient.",
      input_schema: {
        type: "object" as const,
        properties: {
          company: { type: "string", description: "Target company name" },
          contactName: { type: "string", description: "Full name of the recipient" },
          recipientEmail: { type: "string", description: "Recipient corporate email address" },
          subject: { type: "string", description: "Subject line — max 10 words, non-promotional" },
          bodyText: {
            type: "string",
            description: "Plain-text body — min 50 words. This is always sent as fallback.",
          },
          bodyHtml: {
            type: "string",
            description:
              "Optional HTML version. Use <p> tags for paragraphs. Do NOT include <html> or <body> tags — those are injected by the template.",
          },
          emailType: {
            type: "string",
            enum: ["cold-outreach", "follow-up", "re-engagement"],
            description: "Type of email in the outreach sequence",
          },
          sequenceNumber: {
            type: "number",
            description: "Position in sequence: 1=cold, 2=first follow-up, 3=second follow-up",
          },
          attachmentPath: {
            type: "string",
            description: "Absolute path to a file to attach (e.g. a PDF media kit). File must exist on disk.",
          },
        },
        required: ["company", "contactName", "recipientEmail", "subject", "bodyText"],
      },
    },

    execute: async (raw) => {
      const validation = validateSendEmailInput(raw);

      if (!validation.success) {
        const issues = validation.error.issues
          .map((i: any) => `${i.path.join(".")}: ${i.message}`)
          .join("; ");
        logger.warn("[send-email] invalid input rejected", { issues });
        return { success: false, error: `Validation failed: ${issues}` };
      }

      const record = await sendEmail(validation.data, { ...opts, memory, resendClient });
      records.push(record);

      return {
        success: record.status === "sent" || record.status === "queued",
        status: record.status,
        messageId: record.messageId,
        company: record.company,
        recipientEmail: record.recipientEmail,
        ...(record.error ? { error: record.error } : {}),
      };
    },
  };
}
