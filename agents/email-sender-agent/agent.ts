/**
 * EmailSenderAgent — enterprise outreach delivery for VRASHOWS.
 *
 * Sends personalized emails via Resend API with:
 * - VRASHOWS branded HTML template + professional signature
 * - Per-recipient deduplication (Redis, configurable window)
 * - Rate limiting between sends
 * - Structured delivery records saved to memory
 * - Full multi-agent pipeline support:
 *     outreach-agent → EmailSenderAgent
 *     lead-enrichment-agent + outreach-agent → EmailSenderAgent
 *
 * Tool: send_email — one call per recipient, structured output
 * Model: Haiku — deterministic dispatcher, no reasoning needed
 */

import { readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { Resend } from "resend";

import { BaseAgent } from "../_base/agent.js";
import type { AgentRunOptions } from "../_base/types.js";

import {
  createSendEmailTool,
  sendEmail,
} from "../../tools/send-email.js";

import {
  memoryReadTool,
  memoryWriteTool,
} from "../../tools/index.js";

import { RedisMemory } from "../../memory/short-term/redis.js";
import { logger } from "../../config/logger.js";
import { Models, ModelConfig, getMaxTokens, getMaxIterations } from "../../config/models.js";
import { env } from "../../config/env.js";

import type {
  EmailRecord,
  EmailSendResult,
  EmailSenderOptions,
  BatchSendRequest,
  SendEmailRequest,
} from "./types.js";

import type {
  OutreachPackage,
} from "../outreach-agent/types.js";

import type {
  EnrichedContact,
} from "../lead-enrichment-agent/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─────────────────────────────────────────────────────────────────────────────
// Agent
// ─────────────────────────────────────────────────────────────────────────────

export class EmailSenderAgent extends BaseAgent {
  private records: EmailRecord[] = [];

  private memory: RedisMemory;

  private resendClient: Resend;

  constructor(systemPrompt: string) {
    super({
      name: "email-sender-agent",

      description:
        "Sends enterprise outreach emails via Resend for VRASHOWS",

      systemPrompt,

      model: Models.fast,

      maxTokens: getMaxTokens(ModelConfig.maxTokens.default),

      temperature: ModelConfig.temperature.deterministic,

      maxIterations: getMaxIterations(30),

      memoryEnabled: false,

      memorySaveEnabled: false,
    });

    this.memory = new RedisMemory();

    this.resendClient = new Resend(env.RESEND_API_KEY);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Factory
  // ───────────────────────────────────────────────────────────────────────────

  static async create(): Promise<EmailSenderAgent> {
    const promptPath = join(
      __dirname,
      "../../prompts/agents/email-sender-agent.md"
    );

    let systemPrompt = `
You are the VRASHOWS Email Sender Agent.

Your role:
- send enterprise outreach emails
- maintain professional communication
- respect delivery constraints
- support outbound automation

Always behave safely and professionally.
`;

    try {
      systemPrompt = await readFile(promptPath, "utf8");
    } catch {
      logger.warn(
        "[email-sender-agent] prompt file not found, using fallback prompt"
      );
    }

    const agent = new EmailSenderAgent(systemPrompt);

    agent.registerTool(memoryReadTool);

    agent.registerTool(memoryWriteTool);

    agent.registerTool(
      createSendEmailTool(agent.records, {
        memory: agent.memory,
        resendClient: agent.resendClient,
      })
    );

    return agent;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Agentic send
  // ───────────────────────────────────────────────────────────────────────────

  async send(
    recipients: SendEmailRequest[],
    opts: EmailSenderOptions = {},
    runOptions: AgentRunOptions = {}
  ): Promise<EmailSendResult> {
    this.records = [];

    const sessionStartedAt = new Date().toISOString();

    Object.assign(this, {
      _sendOpts: opts,
    });

    const prompt = this.buildAgentPrompt(
      recipients,
      opts
    );

    logger.info(
      "[email-sender-agent] starting agentic send session",
      {
        recipients: recipients.length,
        dryRun: opts.dryRun ?? false,
      }
    );

    await super.run(prompt, runOptions);

    return this.buildResult(sessionStartedAt);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Direct batch send
  // ───────────────────────────────────────────────────────────────────────────

  async sendBatch(
    req: BatchSendRequest
  ): Promise<EmailSendResult> {
    const {
      recipients,
      options = {},
    } = req;

    this.records = [];

    const sessionStartedAt = new Date().toISOString();

    logger.info(
      "[email-sender-agent] starting direct batch send",
      {
        recipients: recipients.length,
        dryRun: options.dryRun ?? false,
      }
    );

    for (const recipient of recipients) {
      const record = await sendEmail(recipient, {
        ...options,
        memory: this.memory,
        resendClient: this.resendClient,
      });

      this.records.push(record);
    }

    return this.buildResult(sessionStartedAt);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Multi-agent outreach pipeline
  // ───────────────────────────────────────────────────────────────────────────

  async sendFromOutreach(
    packages: OutreachPackage[],
    recipientMap: Record<
      string,
      {
        email: string;
        contactName: string;
      }
    >,
    opts: EmailSenderOptions = {}
  ): Promise<EmailSendResult> {
    const recipients: SendEmailRequest[] = [];
    for (const pkg of packages) {
      const contact = recipientMap[pkg.company];
      if (!contact) {
        logger.warn("[email-sender-agent] no recipient for company", { company: pkg.company });
        continue;
      }
      recipients.push({
        company: pkg.company,
        contactName: contact.contactName,
        recipientEmail: contact.email,
        subject: pkg.coldEmail.subject,
        bodyText: pkg.coldEmail.body,
        emailType: "cold-outreach",
        sequenceNumber: 1,
      });
    }

    return this.sendBatch({
      recipients,
      options: opts,
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Contacts pipeline
  // ───────────────────────────────────────────────────────────────────────────

  async sendFromContacts(
    contacts: EnrichedContact[],
    template: (
      contact: EnrichedContact
    ) => {
      subject: string;
      bodyText: string;
      bodyHtml?: string;
    },
    opts: EmailSenderOptions = {}
  ): Promise<EmailSendResult> {
    const sendable = contacts.filter(
      (c) => c.possibleEmail !== "unknown"
    );

    if (sendable.length < contacts.length) {
      logger.warn(
        "[email-sender-agent] contacts without email skipped",
        {
          skipped:
            contacts.length - sendable.length,
        }
      );
    }

    const recipients: SendEmailRequest[] =
      sendable.map((contact) => {
        const {
          subject,
          bodyText,
          bodyHtml,
        } = template(contact);

        return {
          company: contact.company,

          contactName: contact.name,

          recipientEmail: contact.possibleEmail,

          subject,

          bodyText,

          bodyHtml,

          emailType: "cold-outreach" as const,

          sequenceNumber: 1,
        };
      });

    return this.sendBatch({
      recipients,
      options: opts,
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Helpers
  // ───────────────────────────────────────────────────────────────────────────

  private buildResult(
    sessionStartedAt: string
  ): EmailSendResult {
    const sent = this.records.filter(
      (r) => r.status === "sent"
    ).length;

    const failed = this.records.filter(
      (r) => r.status === "failed"
    ).length;

    const skipped = this.records.filter(
      (r) =>
        r.status === "skipped" ||
        r.status === "queued"
    ).length;

    const failedCompanies = [
      ...new Set(
        this.records
          .filter(
            (r) => r.status === "failed"
          )
          .map((r) => r.company)
      ),
    ];

    const sessionCompletedAt =
      new Date().toISOString();

    logger.info(
      "[email-sender-agent] session complete",
      {
        total: this.records.length,
        sent,
        failed,
        skipped,
      }
    );

    return {
      totalAttempted: this.records.length,

      sent,

      failed,

      skipped,

      records: this.records.slice(),

      failedCompanies,

      sessionStartedAt,

      sessionCompletedAt,
    };
  }

  private buildAgentPrompt(
    recipients: SendEmailRequest[],
    opts: EmailSenderOptions
  ): string {
    const mode = opts.dryRun
      ? "DRY-RUN"
      : "LIVE SEND";

    const recipientList = recipients
      .map(
        (r, i) =>
          `${i + 1}. ${r.company} | ${
            r.contactName
          } | ${r.recipientEmail}
Subject: ${r.subject}
Type: ${
            r.emailType ?? "cold-outreach"
          } | Seq: ${
            r.sequenceNumber ?? 1
          }`
      )
      .join("\n\n");

    return `
Send the following outreach emails for VRASHOWS.

Mode: ${mode}

Rate delay:
${opts.rateDelayMs ?? 1200}ms

For each recipient:
- call send_email
- use subject verbatim
- use body verbatim
- process ALL recipients

RECIPIENTS:

${recipientList}
`.trim();
  }
}