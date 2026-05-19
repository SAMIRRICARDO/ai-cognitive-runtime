import type { ValidatedLead } from "../lead-validation/types.js";
import type { OutreachQualityReport } from "../../tools/email-quality.js";

export interface OutreachQueueEntry {
  id: string;
  priority: "HOT" | "WARM";
  lead: ValidatedLead;
  email: {
    to: string;
    subject: string;
    bodyText: string;
    bodyHtml: string;
    attachmentPath?: string;
  };
  quality: OutreachQualityReport;
  status: "queued" | "sent" | "failed" | "skipped";
  sentAt?: string;
  resendId?: string;
  error?: string;
}

export interface OutreachQueue {
  queueId: string;
  generatedAt: string;
  campaign: string;
  targetEvent: string;
  attachmentPath: string;
  totalEntries: number;
  hotCount: number;
  warmCount: number;
  avgQualityScore: number;
  entries: OutreachQueueEntry[];
}
