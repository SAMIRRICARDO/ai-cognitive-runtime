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
import { resolve } from "path";
import { env } from "../config/env.js";
import { EmailSenderAgent } from "../agents/email-sender-agent/agent.js";
import { FuturecomResearcherAgent } from "../agents/futurecom-researcher/agent.js";
import { OutreachAgent } from "../agents/outreach-agent/agent.js";
import { sendEmail, extractFirstName, pickSubjectVariant } from "../tools/send-email.js";
import { scoreEmailQuality } from "../tools/email-quality.js";
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

const dryRun      = hasFlag("--dry-run");
const testTo      = flag("--test-to");
const contactName = flag("--contact-name") ?? "Samir Ricardo";
const attachPath  = flag("--attach") ?? (env.MEDIA_KIT_PDF ? resolve(env.MEDIA_KIT_PDF) : undefined);
const fromFile    = flag("--from-file");
const pipeline    = hasFlag("--pipeline");
const minScore    = parseInt(flag("--min-score") ?? "50", 10);
const maxLeads    = parseInt(flag("--max-leads") ?? "8", 10);
const rateDelay   = parseInt(flag("--rate-delay") ?? "1200", 10);
const jsonOutput  = hasFlag("--json");
const skipQuality = hasFlag("--skip-quality");

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
  const startedAt = Date.now();

  // ── Subject: deterministic A/B variant selection ──────────────────────────
  const subject = pickSubjectVariant(testTo);

  // ── Personalized greeting — firstName extraction ──────────────────────────
  const firstName = extractFirstName(contactName);
  const greeting = `Olá ${firstName},`;

  // Official copy v2.0 — validated 2026-05-19
  const bodyText = [
    greeting,
    "",
    "Grandes eventos corporativos exigem muito mais do que execução operacional. Exigem controle, velocidade de resposta e uma experiência consistente do início ao fim — mesmo quando dezenas de fornecedores, equipes e demandas acontecem simultaneamente.",
    "",
    "É exatamente nesse cenário que a VRASHOWS atua.",
    "",
    "Somos um hub de soluções integradas para eventos corporativos e experiências de marca, assumindo toda a operação para que sua equipe possa concentrar energia no que realmente importa: relacionamento, negócios e resultado.",
    "",
    "Coordenamos de forma integrada:",
    "• logística operacional",
    "• staff premium",
    "• produção executiva",
    "• hospitality",
    "• suporte 360° em tempo real",
    "• experiência do visitante",
    "",
    "Tudo com acompanhamento próximo, agilidade operacional e execução sem improvisos.",
    "",
    '"Enquanto você fecha negócios, nós controlamos a operação."',
    "",
    "Na ABRINT 2026, atuamos ao lado da Brasil TecPar conduzindo toda a operação do evento com foco em fluidez operacional, experiência do público e suporte integral à equipe da marca — reduzindo ruído operacional e permitindo total foco em networking e geração de negócios.",
    "",
    "Estou encaminhando em anexo nosso material institucional com mais detalhes sobre a estrutura e metodologia da VRASHOWS.",
    "",
    "Se fizer sentido para o momento da sua empresa, ficarei à disposição para uma conversa breve nos próximos dias.",
  ].join("\n");

  const bodyHtml = [
    `<p style="margin:0 0 18px;font-size:15px;">${greeting}</p>`,
    `<p style="margin:0 0 16px;">Grandes eventos corporativos exigem muito mais do que execução operacional. Exigem controle, velocidade de resposta e uma experiência consistente do início ao fim — mesmo quando dezenas de fornecedores, equipes e demandas acontecem simultaneamente.</p>`,
    `<p style="margin:0 0 16px;">É exatamente nesse cenário que a <strong>VRASHOWS</strong> atua.</p>`,
    `<p style="margin:0 0 16px;">Somos um hub de soluções integradas para eventos corporativos e experiências de marca, assumindo toda a operação para que sua equipe possa concentrar energia no que realmente importa: relacionamento, negócios e resultado.</p>`,
    `<p style="margin:0 0 10px;">Coordenamos de forma integrada:</p>`,
    `<table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;">`,
    `  <tr><td style="padding:3px 0;color:#1e293b;font-size:15px;">&#8226;&nbsp; logística operacional</td></tr>`,
    `  <tr><td style="padding:3px 0;color:#1e293b;font-size:15px;">&#8226;&nbsp; staff premium</td></tr>`,
    `  <tr><td style="padding:3px 0;color:#1e293b;font-size:15px;">&#8226;&nbsp; produção executiva</td></tr>`,
    `  <tr><td style="padding:3px 0;color:#1e293b;font-size:15px;">&#8226;&nbsp; hospitality</td></tr>`,
    `  <tr><td style="padding:3px 0;color:#1e293b;font-size:15px;">&#8226;&nbsp; suporte 360&deg; em tempo real</td></tr>`,
    `  <tr><td style="padding:3px 0;color:#1e293b;font-size:15px;">&#8226;&nbsp; experiência do visitante</td></tr>`,
    `</table>`,
    `<p style="margin:0 0 16px;">Tudo com acompanhamento próximo, agilidade operacional e execução sem improvisos.</p>`,
    `<p style="background:#f8fafc;border-left:3px solid #0f172a;padding:14px 18px;margin:24px 0;font-style:italic;color:#334155;font-size:14px;line-height:1.6;"><em>&ldquo;Enquanto você fecha negócios, nós controlamos a operação.&rdquo;</em></p>`,
    `<p style="margin:0 0 16px;">Na <strong>ABRINT 2026</strong>, atuamos ao lado da <strong>Brasil TecPar</strong> conduzindo toda a operação do evento com foco em fluidez operacional, experiência do público e suporte integral à equipe da marca — reduzindo ruído operacional e permitindo total foco em networking e geração de negócios.</p>`,
    `<p style="margin:0 0 16px;">Estou encaminhando em anexo nosso material institucional com mais detalhes sobre a estrutura e metodologia da VRASHOWS.</p>`,
    `<p style="margin:0 0 0;">Se fizer sentido para o momento da sua empresa, ficarei à disposição para uma conversa breve nos próximos dias.</p>`,
  ].join("\n");

  const bccAddress = env.OUTBOUND_BCC_EMAIL ?? undefined;

  // ── Quality gate ─────────────────────────────────────────────────────────
  const quality = scoreEmailQuality(subject, bodyText, bodyHtml);

  // ── Print send payload ───────────────────────────────────────────────────
  if (!jsonOutput) {
    const hr = "─".repeat(72);
    console.log(`\n\x1b[1mVRASHOWS Email Sender — Outreach Real\x1b[0m`);
    console.log(hr);
    console.log(`  \x1b[2mMode:\x1b[0m          ${dryRun ? "\x1b[33mDRY-RUN\x1b[0m" : "\x1b[32mLIVE SEND\x1b[0m"}`);
    console.log(`  \x1b[2mTo:\x1b[0m            ${testTo}`);
    console.log(`  \x1b[2mContact:\x1b[0m       ${contactName} (${firstName})`);
    console.log(`  \x1b[2mBCC:\x1b[0m           ${bccAddress ?? "\x1b[2mnone\x1b[0m"}`);
    console.log(`  \x1b[2mSubject:\x1b[0m       ${subject}`);
    console.log(`  \x1b[2mType:\x1b[0m          cold-outreach | seq 1`);
    console.log(`  \x1b[2mAttachment:\x1b[0m    ${attachPath ?? "none"}`);
    console.log(`  \x1b[2mTemplate:\x1b[0m      VRASHOWS branded HTML + signature`);
    console.log(hr);

    // Quality score display
    const qColor =
      quality.decision === "send"   ? "\x1b[32m" :
      quality.decision === "review" ? "\x1b[33m" :
      "\x1b[31m";
    const decisionLabel =
      quality.decision === "send"   ? "✓ SEND"   :
      quality.decision === "review" ? "⚠ REVIEW" :
      "✗ REWRITE";
    console.log(`\n  \x1b[1mQUALITY SCORE\x1b[0m`);
    console.log(`  Overall:        ${qColor}${quality.score}/100  ${decisionLabel}\x1b[0m`);
    console.log(`  Enterprise tone: ${String(quality.enterpriseToneScore).padStart(3)}/100`);
    console.log(`  Spamminess:      ${String(quality.spamminessScore).padStart(3)}/100  (lower is better)`);
    console.log(`  Personalization: ${String(quality.personalizationScore).padStart(3)}/100`);
    console.log(`  Structure:       ${String(quality.structureScore).padStart(3)}/100`);
    if (quality.issues.length > 0) {
      console.log(`\n  \x1b[33mIssues:\x1b[0m`);
      for (const issue of quality.issues) console.log(`    • ${issue}`);
    }
    if (quality.recommendations.length > 0) {
      console.log(`\n  \x1b[36mRecommendations:\x1b[0m`);
      for (const rec of quality.recommendations) console.log(`    → ${rec}`);
    }
    console.log(hr);
    console.log();

    if (!skipQuality && quality.decision === "rewrite") {
      console.log(`\x1b[31m✗ Quality gate failed (score ${quality.score}/100 < 50). Use --skip-quality to override.\x1b[0m\n`);
      process.exit(1);
    }
    if (!skipQuality && quality.decision === "review") {
      console.log(`\x1b[33m⚠ Quality score ${quality.score}/100 — proceeding (review recommended)\x1b[0m\n`);
    }
  }

  const record = await sendEmail(
    {
      company: "VRASHOWS",
      contactName,
      recipientEmail: testTo,
      subject,
      bodyText,
      bodyHtml,
      emailType: "cold-outreach",
      sequenceNumber: 1,
      ...(attachPath ? { attachmentPath: attachPath } : {}),
    },
    { dryRun }
  );

  const elapsed = Date.now() - startedAt;

  if (jsonOutput) {
    process.stdout.write(JSON.stringify({ record, quality, elapsed, bcc: bccAddress ?? null }, null, 2) + "\n");
  } else {
    const statusColor =
      record.status === "sent"   ? "\x1b[32m" :
      record.status === "queued" ? "\x1b[33m" :
      "\x1b[31m";

    const hr = "─".repeat(72);
    console.log(hr);
    console.log(`  ${statusColor}STATUS:    ${record.status.toUpperCase()}\x1b[0m`);
    console.log(`  \x1b[2mResend ID:\x1b[0m ${record.resendId ?? record.messageId}`);
    console.log(`  \x1b[2mSent at:\x1b[0m   ${record.sentAt}`);
    console.log(`  \x1b[2mElapsed:\x1b[0m   ${elapsed}ms`);
    console.log(`  \x1b[2mQuality:\x1b[0m   ${quality.score}/100 (${quality.decision})`);
    console.log(`  \x1b[2mLLM cost:\x1b[0m  $0.00 (direct send — no agent reasoning)`);
    if (attachPath) console.log(`  \x1b[32m✓\x1b[0m Attachment: ${attachPath.split(/[\\/]/).pop()} loaded`);
    if (bccAddress) console.log(`  \x1b[32m✓\x1b[0m BCC:        ${bccAddress}`);
    if (record.error) console.log(`  \x1b[31mError:\x1b[0m     ${record.error}`);
    console.log(hr);
    console.log();
    if (record.status === "sent") {
      console.log(`\x1b[32m✓\x1b[0m Email entregue ao servidor Resend.`);
      console.log(`  Verifique a caixa de entrada em: ${testTo}`);
      console.log(`  Links clicáveis: vrashows.com.br · sender@yourdomain.com`);
    }
    console.log();
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
