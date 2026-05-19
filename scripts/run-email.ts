#!/usr/bin/env tsx
/**
 * Email Sender CLI — sends VRASHOWS enterprise outreach emails via Resend.
 *
 * Modes:
 *   1. Pipeline (default): research → outreach → send in one command
 *   2. From outreach file: reads outreach packages JSON and sends
 *   3. Single test:        sends a single test email to verify setup
 *
 * Usage:
 *   tsx scripts/run-email.ts --dry-run                  # validate without sending
 *   tsx scripts/run-email.ts --test-to you@example.com  # send one test email
 *   tsx scripts/run-email.ts --from-file outreach.json  # send from outreach-agent output
 *   tsx scripts/run-email.ts --pipeline                 # full research→outreach→send
 *   tsx scripts/run-email.ts --json                     # output delivery records as JSON
 *
 * Options:
 *   --dry-run            Build emails but do NOT send (status: queued)
 *   --test-to <email>    Send a single branded test email to this address
 *   --attach <path>      Absolute path to a file to attach (used with --test-to)
 *   --from-file <path>   Read outreach packages from JSON file (run-outreach.ts --json output)
 *   --pipeline           Full pipeline: research → outreach → send
 *   --min-score <n>      Min lead score in pipeline mode (default: 50)
 *   --max-leads <n>      Max leads in pipeline mode (default: 8)
 *   --rate-delay <ms>    Delay between sends in ms (default: 1200)
 *   --json               Output delivery records as JSON to stdout
 */

import { readFile } from "fs/promises";
import { EmailSenderAgent } from "../agents/email-sender-agent/agent.js";
import { FuturecomResearcherAgent } from "../agents/futurecom-researcher/agent.js";
import { OutreachAgent } from "../agents/outreach-agent/agent.js";
import { sendEmail } from "../tools/send-email.js";
import type { OutreachPackage } from "../agents/outreach-agent/types.js";
import type { AgentStep } from "../agents/_base/types.js";

// ─── Parse CLI args ───────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function flag(name: string): string | undefined {
  const idx = args.indexOf(name);
  return idx !== -1 ? args[idx + 1] : undefined;
}

function hasFlag(name: string): boolean {
  return args.includes(name);
}

const dryRun     = hasFlag("--dry-run");
const testTo     = flag("--test-to");
const attachPath = flag("--attach");
const fromFile   = flag("--from-file");
const pipeline   = hasFlag("--pipeline");
const minScore   = parseInt(flag("--min-score") ?? "50", 10);
const maxLeads   = parseInt(flag("--max-leads") ?? "8", 10);
const rateDelay  = parseInt(flag("--rate-delay") ?? "1200", 10);
const jsonOutput = hasFlag("--json");

const sendOpts = { dryRun, rateDelayMs: rateDelay };

// ─── Step handler ─────────────────────────────────────────────────────────────

function makeStepHandler(label: string) {
  return (step: AgentStep) => {
    if (jsonOutput) return;
    if (step.type === "thinking") {
      process.stderr.write(`\x1b[2m[${label}] ${step.content}\x1b[0m\n`);
    } else if (step.type === "tool_call") {
      const inp = step.input as Record<string, unknown>;
      if (step.tool === "send_email") {
        const statusColor = dryRun ? "\x1b[33m" : "\x1b[32m";
        process.stderr.write(
          `${statusColor}[email]\x1b[0m ${inp.company} → ${inp.recipientEmail}\n`
        );
      } else if (step.tool === "web_search") {
        process.stderr.write(`\x1b[34m[search]\x1b[0m ${(inp.query as string)?.slice(0, 80)}\n`);
      } else if (step.tool === "save_lead") {
        process.stderr.write(`\x1b[36m[lead]\x1b[0m ${inp.company}\n`);
      } else if (step.tool === "save_outreach") {
        process.stderr.write(`\x1b[35m[outreach]\x1b[0m ${inp.company}\n`);
      }
    }
  };
}

// ─── Mode: single test email ──────────────────────────────────────────────────

if (testTo) {
  if (!jsonOutput) {
    console.log(`\nVRASHOWS Email Sender — Test Mode`);
    console.log(`Sending test email to: ${testTo}`);
    if (attachPath) console.log(`Attachment: ${attachPath}`);
    console.log();
  }

  const record = await sendEmail(
    {
      company: "VRASHOWS",
      contactName: "Samir Ricardo",
      recipientEmail: testTo,
      subject: "VRASHOWS — Media Kit 2026",
      bodyText: [
        "Olá,",
        "",
        "Segue em anexo o Media Kit 2026 da VRASHOWS com informações completas sobre nossas soluções de operações 360° para eventos enterprise.",
        "",
        "Ficamos à disposição para qualquer dúvida.",
        "",
        "Att,",
        "VRASHOWS",
      ].join("\n"),
      bodyHtml: [
        "<p>Olá,</p>",
        "<p>Segue em anexo o <strong>Media Kit 2026</strong> da VRASHOWS com informações completas sobre nossas soluções de operações 360° para eventos enterprise.</p>",
        "<p>Ficamos à disposição para qualquer dúvida.</p>",
        "<p>Att,<br><strong>VRASHOWS</strong></p>",
      ].join("\n"),
      emailType: "cold-outreach",
      sequenceNumber: 1,
      ...(attachPath ? { attachmentPath: attachPath } : {}),
    },
    { dryRun }
  );

  if (jsonOutput) {
    process.stdout.write(JSON.stringify(record, null, 2) + "\n");
  } else {
    const statusColor = record.status === "sent" ? "\x1b[32m" : record.status === "queued" ? "\x1b[33m" : "\x1b[31m";
    console.log(`${statusColor}Status: ${record.status.toUpperCase()}\x1b[0m`);
    console.log(`Message ID: ${record.messageId}`);
    if (record.error) console.log(`Error: ${record.error}`);
  }

  process.exit(0);
}

// ─── Mode: pipeline (research → outreach → send) ──────────────────────────────

let packages: OutreachPackage[] = [];

if (fromFile) {
  if (!jsonOutput) console.log(`\nLoading outreach packages from ${fromFile}…`);
  const raw = JSON.parse(await readFile(fromFile, "utf8"));
  packages = Array.isArray(raw) ? raw : (raw.packages ?? []);
  if (!jsonOutput) console.log(`Loaded ${packages.length} outreach packages.\n`);

} else if (pipeline) {
  if (!jsonOutput) {
    console.log("\nVRASHOWS Full Pipeline: Research → Outreach → Send");
    console.log(`Mode: ${dryRun ? "DRY-RUN" : "LIVE SEND"}\n`);
    console.log("Phase 1/3 — Researching Futurecom 2026 leads…\n");
  }

  const researcher = await FuturecomResearcherAgent.create();
  const research = await researcher.research(
    "Identify companies exhibiting at Futurecom 2026 with high 360° event operations potential for VRASHOWS",
    { minScore, maxLeads },
    { onStep: makeStepHandler("research") }
  );

  if (!jsonOutput) console.log(`\nPhase 2/3 — Generating outreach for ${research.leads.length} leads…\n`);

  const outreachAgent = await OutreachAgent.create();
  const outreachResult = await outreachAgent.generate(
    research.leads,
    { channel: "email", tone: "consultive", event: "Futurecom 2026" },
    { onStep: makeStepHandler("outreach") }
  );

  packages = outreachResult.packages;

  if (!jsonOutput) console.log(`\nPhase 3/3 — Sending ${packages.length} emails…\n`);

} else {
  if (!jsonOutput) {
    console.error("No mode specified. Use --test-to, --from-file, or --pipeline.");
    console.error("For dry-run of pipeline: --pipeline --dry-run");
  }
  process.exit(1);
}

if (packages.length === 0) {
  if (!jsonOutput) console.log("No outreach packages to send. Exiting.\n");
  process.exit(0);
}

// ─── Send ─────────────────────────────────────────────────────────────────────

if (!jsonOutput && !pipeline) {
  console.log(`Sending ${packages.length} emails${dryRun ? " (dry-run)" : ""}…\n`);
}

// Build recipient map from package data — real emails require enrichment
// Here we use the possibleEmail if available (for pipeline use after enrichment)
// For packages without contact emails, warn and skip
const emailAgent = await EmailSenderAgent.create();

const recipients = packages
  .map((pkg) => {
    // Outreach packages don't carry an email address — they need enrichment.
    // When running --from-file or --pipeline without enrichment, this will be empty.
    // For full pipeline: use run-outreach.ts output + run-enrichment.ts output together.
    const email = (pkg as any).recipientEmail as string | undefined;
    if (!email) return null;
    return {
      company: pkg.company,
      contactName: (pkg as any).contactName ?? pkg.company,
      recipientEmail: email,
      subject: pkg.coldEmail.subject,
      bodyText: pkg.coldEmail.body,
      emailType: "cold-outreach" as const,
      sequenceNumber: 1,
    };
  })
  .filter((r): r is NonNullable<typeof r> => r !== null);

if (recipients.length === 0) {
  if (!jsonOutput) {
    console.log("Outreach packages do not contain recipient email addresses.");
    console.log("To send emails you need to:");
    console.log("  1. Run: tsx scripts/run-enrichment.ts --json > enriched.json");
    console.log("  2. Join enriched contacts with outreach packages");
    console.log("  3. Or use --test-to to verify email delivery is working\n");
  }
  process.exit(0);
}

const result = await emailAgent.sendBatch({ recipients, options: sendOpts });

// ─── Output ───────────────────────────────────────────────────────────────────

if (jsonOutput) {
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  process.exit(0);
}

const hr = "─".repeat(80);
const modeLabel = dryRun ? "\x1b[33mDRY-RUN\x1b[0m" : "\x1b[32mLIVE\x1b[0m";

console.log(`\n${hr}`);
console.log(`  SEND SESSION COMPLETE  [${modeLabel}]`);
console.log(`  Sent: ${result.sent}  Failed: ${result.failed}  Skipped: ${result.skipped}  Total: ${result.totalAttempted}`);
if (result.failedCompanies.length > 0) {
  console.log(`  Failed companies: ${result.failedCompanies.join(", ")}`);
}
console.log(`${hr}\n`);

for (const record of result.records) {
  const statusColor =
    record.status === "sent"    ? "\x1b[32m" :
    record.status === "queued"  ? "\x1b[33m" :
    record.status === "skipped" ? "\x1b[2m"  :
    "\x1b[31m";

  console.log(
    `${statusColor}${record.status.toUpperCase().padEnd(8)}\x1b[0m` +
    `${record.company.padEnd(20)} → ${record.recipientEmail}`
  );
  if (record.status === "sent") {
    console.log(`         \x1b[2mMessage ID: ${record.messageId}\x1b[0m`);
  } else if (record.error) {
    console.log(`         \x1b[31mError: ${record.error}\x1b[0m`);
  }
}

console.log(`\nSession: ${result.sessionStartedAt} → ${result.sessionCompletedAt}`);
