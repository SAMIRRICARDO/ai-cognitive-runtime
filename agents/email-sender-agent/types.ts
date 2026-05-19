/**
 * Types for the Email Sender Agent.
 *
 * Models email delivery records, send requests, follow-up chains,
 * and session results for VRASHOWS enterprise outreach.
 *
 * Designed to consume OutreachPackage from outreach-agent
 * and EnrichedContact from lead-enrichment-agent.
 */

// ─── Delivery status ──────────────────────────────────────────────────────────

export type DeliveryStatus =
  | "sent"       // accepted by Resend — in transit
  | "failed"     // Resend returned an error
  | "skipped"    // rate-limited or already contacted recently
  | "queued";    // staged but not yet sent (dry-run mode)

export type EmailType =
  | "cold-outreach"   // first contact
  | "follow-up"       // scheduled follow-up (day 3, day 7)
  | "re-engagement";  // re-contact after >30 days silence

// ─── Single email record ──────────────────────────────────────────────────────

export interface EmailRecord {
  /** Unique ID returned by Resend (or synthetic for skipped/dry-run) */
  messageId: string;

  /** Target company */
  company: string;

  /** Contact name */
  contactName: string;

  /** Recipient email address */
  recipientEmail: string;

  /** Email subject */
  subject: string;

  /** Delivery status */
  status: DeliveryStatus;

  /** Type of email sent */
  emailType: EmailType;

  /** Sequence number within a follow-up chain (1 = cold, 2 = first follow-up, …) */
  sequenceNumber: number;

  /** ISO timestamp of send attempt */
  sentAt: string;

  /** Error message if status === "failed" or "skipped" */
  error?: string;

  /** Resend-assigned message ID for tracking */
  resendId?: string;
}

// ─── Send request (tool input model) ─────────────────────────────────────────

export interface SendEmailRequest {
  /** Target company name */
  company: string;

  /** Contact full name */
  contactName: string;

  /** Recipient email address */
  recipientEmail: string;

  /** Email subject line */
  subject: string;

  /** Plain-text body */
  bodyText: string;

  /** HTML body (overrides bodyText for HTML-capable clients) */
  bodyHtml?: string;

  /** Email type (default: cold-outreach) */
  emailType?: EmailType;

  /** Sequence number in follow-up chain (default: 1) */
  sequenceNumber?: number;

  /** Absolute path to a file to attach (e.g. a PDF) */
  attachmentPath?: string;
}

// ─── Session result ───────────────────────────────────────────────────────────

export interface EmailSendResult {
  /** Total emails attempted */
  totalAttempted: number;

  /** Emails successfully sent */
  sent: number;

  /** Emails failed */
  failed: number;

  /** Emails skipped (rate-limited or duplicate) */
  skipped: number;

  /** All email records from this session */
  records: EmailRecord[];

  /** Companies that failed all sends */
  failedCompanies: string[];

  /** ISO timestamp of session start */
  sessionStartedAt: string;

  /** ISO timestamp of session end */
  sessionCompletedAt: string;
}

// ─── Send options ─────────────────────────────────────────────────────────────

export interface EmailSenderOptions {
  /**
   * If true, build and validate emails but do NOT actually send.
   * Records are returned with status "queued".
   * Default: false
   */
  dryRun?: boolean;

  /**
   * Minimum delay between sends in milliseconds.
   * Default: 1200 (keeps well under Resend's 2 req/s free tier limit)
   */
  rateDelayMs?: number;

  /**
   * Skip contacts already emailed within this many days.
   * Default: 7
   */
  deduplicationWindowDays?: number;

  /**
   * Override the default sender address.
   * Default: RESEND_FROM_EMAIL env var
   */
  fromAddress?: string;

  /**
   * Override the default sender display name.
   * Default: RESEND_FROM_NAME env var
   */
  fromName?: string;

  /**
   * BCC address(es) for every outbound email — used for audit, commercial tracking,
   * and campaign monitoring. Falls back to OUTBOUND_BCC_EMAIL env var if not set.
   */
  bcc?: string | string[];
}

// ─── Multi-agent bridge ───────────────────────────────────────────────────────

/** Direct (non-agent) batch send request — used by orchestration scripts */
export interface BatchSendRequest {
  recipients: SendEmailRequest[];
  options?: EmailSenderOptions;
}
