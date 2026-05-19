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
const attachPath = flag("--attach") ?? (env.MEDIA_KIT_PDF ? resolve(env.MEDIA_KIT_PDF) : undefined);
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
  const startedAt = Date.now();

  // ── Executive outreach email — VRASHOWS premium positioning ──────────────
  const subject = "Operação premium para eventos corporativos";

  const bodyText = [
    "Prezado(a),",
    "",
    "Empresas que lideram eventos corporativos enfrentam um desafio crescente: manter o padrão de excelência enquanto coordenam uma operação cada vez mais complexa — fornecedores, logística, staff, timing, experiência do público. Tudo acontece ao mesmo tempo. Qualquer falha é visível.",
    "",
    "A VRASHOWS foi construída para resolver exatamente isso.",
    "",
    "Somos um hub de operação integrada para eventos corporativos de alto padrão. Assumimos o controle de toda a estrutura — coordenação executiva, logística integrada, staff premium, produção operacional e suporte 360° em tempo real — para que sua equipe concentre energia onde realmente gera resultado.",
    "",
    "Sem improvisos. Sem retrabalho. Sem surpresas no dia do evento.",
    "",
    "No ABRINT 2026, operamos ao lado da Brasil TecPar com um nível de execução que a equipe percebeu desde a fase de planejamento: menos ruído operacional, mais resultado visível.",
    "",
    "Gostaria de conversar por 20 minutos para entender o contexto dos seus eventos em 2026 e mostrar como a VRASHOWS pode assumir a operação enquanto você foca no seu negócio.",
    "",
    "Segue em anexo o nosso material institucional com estrutura, metodologia e referências.",
    "",
    "Fico à disposição.",
  ].join("\n");

  const bodyHtml = [
    `<p style="margin:0 0 16px;">Prezado(a),</p>`,
    `<p style="margin:0 0 16px;">Empresas que lideram eventos corporativos enfrentam um desafio crescente: manter o padrão de excelência enquanto coordenam uma operação cada vez mais complexa — fornecedores, logística, staff, timing, experiência do público. Tudo acontece ao mesmo tempo. Qualquer falha é visível.</p>`,
    `<p style="margin:0 0 16px;">A <strong>VRASHOWS</strong> foi construída para resolver exatamente isso.</p>`,
    `<p style="margin:0 0 16px;">Somos um hub de operação integrada para eventos corporativos de alto padrão. Assumimos o controle de toda a estrutura — coordenação executiva, logística integrada, staff premium, produção operacional e suporte 360° em tempo real — para que sua equipe concentre energia onde realmente gera resultado.</p>`,
    `<p style="background:#f8fafc;border-left:3px solid #0f172a;padding:12px 16px;margin:20px 0;font-style:italic;color:#334155;">"Enquanto você fecha negócios, nós controlamos a operação."</p>`,
    `<p style="margin:0 0 16px;">Sem improvisos. Sem retrabalho. Sem surpresas no dia do evento.</p>`,
    `<p style="margin:0 0 16px;">No <strong>ABRINT 2026</strong>, operamos ao lado da <strong>Brasil TecPar</strong> com um nível de execução que a equipe percebeu desde a fase de planejamento: menos ruído operacional, mais resultado visível.</p>`,
    `<p style="margin:0 0 16px;">Gostaria de conversar por <strong>20 minutos</strong> para entender o contexto dos seus eventos em 2026 e mostrar como a VRASHOWS pode assumir a operação enquanto você foca no seu negócio.</p>`,
    `<p style="margin:0 0 16px;">Segue em anexo o nosso material institucional com estrutura, metodologia e referências.</p>`,
    `<p style="margin:0 0 16px;">Fico à disposição.</p>`,
    `<p style="margin:24px 0 0;"><a href="https://vrashows.com.br" style="display:inline-block;background:#0f172a;color:#ffffff;font-size:13px;font-weight:600;padding:10px 22px;border-radius:4px;text-decoration:none;letter-spacing:0.3px;">Vamos conversar 20 min →</a></p>`,
  ].join("\n");

  const bccAddress = env.OUTBOUND_BCC_EMAIL ?? undefined;

  // ── Print send payload ───────────────────────────────────────────────────
  if (!jsonOutput) {
    const hr = "─".repeat(72);
    console.log(`\n\x1b[1mVRASHOWS Email Sender — Outreach Real\x1b[0m`);
    console.log(hr);
    console.log(`  \x1b[2mMode:\x1b[0m          ${dryRun ? "\x1b[33mDRY-RUN\x1b[0m" : "\x1b[32mLIVE SEND\x1b[0m"}`);
    console.log(`  \x1b[2mTo:\x1b[0m            ${testTo}`);
    console.log(`  \x1b[2mBCC:\x1b[0m           ${bccAddress ?? "\x1b[2mnone\x1b[0m"}`);
    console.log(`  \x1b[2mSubject:\x1b[0m       ${subject}`);
    console.log(`  \x1b[2mType:\x1b[0m          cold-outreach | seq 1`);
    console.log(`  \x1b[2mAttachment:\x1b[0m    ${attachPath ?? "none"}`);
    console.log(`  \x1b[2mTemplate:\x1b[0m      VRASHOWS branded HTML + signature`);
    console.log(hr);
    console.log();
  }

  const record = await sendEmail(
    {
      company: "VRASHOWS",
      contactName: "Prezado(a)",
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
    process.stdout.write(JSON.stringify({ record, elapsed, bcc: bccAddress ?? null }, null, 2) + "\n");
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
    console.log(`  \x1b[2mLLM cost:\x1b[0m  $0.00 (direct send — no agent reasoning)`);
    if (attachPath) console.log(`  \x1b[32m✓\x1b[0m Attachment: ${attachPath.split(/[\\/]/).pop()} loaded`);
    if (bccAddress) console.log(`  \x1b[32m✓\x1b[0m BCC:        ${bccAddress}`);
    if (record.error) console.log(`  \x1b[31mError:\x1b[0m     ${record.error}`);
    console.log(hr);
    console.log();
    if (record.status === "sent") {
      console.log(`\x1b[32m✓\x1b[0m Email entregue ao servidor Resend.`);
      console.log(`  Verifique a caixa de entrada em: ${testTo}`);
      console.log(`  Links clicáveis: vrashows.com.br · samir.ricardo@vrashows.com.br`);
      console.log(`  CTA: "Vamos conversar 20 min →"`);
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
