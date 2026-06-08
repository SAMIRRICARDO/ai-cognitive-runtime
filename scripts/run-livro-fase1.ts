#!/usr/bin/env tsx
/**
 * run-livro-fase1.ts — Campanha: lancamento-livro-0907 · Fase 1
 *
 * Ativação de Autoridade — "Hemorragia Cognitiva" cold outreach
 * para CEOs, CTOs, Diretores de RH e executivos de tech enterprises.
 *
 * Fluxo:
 *   1. Lê leads_validados_2026-06-03.json
 *   2. Classifica por job_title → escolhe assunto e corpo
 *   3. Personaliza por buying_signal quando presente
 *   4. Envia via Resend com from/reply_to de Samir Ricardo
 *   5. Intervalo randomizado 8–15 min entre envios
 *   6. Para automaticamente às 18h (Brasília)
 *   7. Salva log incremental em data/outreach/campanha_livro/fase_1/2026-06-03.json
 *
 * Uso:
 *   tsx scripts/run-livro-fase1.ts              # dry-run (padrão)
 *   tsx scripts/run-livro-fase1.ts --live        # envio real
 *   tsx scripts/run-livro-fase1.ts --live --limit 10
 *   tsx scripts/run-livro-fase1.ts --preview     # mostra emails sem enviar
 */

import "dotenv/config";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { Resend } from "resend";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const hasFlag = (f: string) => args.includes(f);
const getVal = (f: string) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : undefined; };

const LIVE      = hasFlag("--live");
const DRY_RUN   = !LIVE;
const PREVIEW   = hasFlag("--preview");
const LIMIT     = parseInt(getVal("--limit") ?? "50", 10);
const CUTOFF_H  = 18; // 18h Brasília

// ─── Types ────────────────────────────────────────────────────────────────────

interface Lead {
  lead_id: string;
  full_name: string;
  first_name: string;
  last_name: string;
  job_title: string;
  company_name: string;
  company_domain: string;
  company_size: string;
  email: string;
  email_status: string;
  buying_signal: string;
  confidence: string;
  decisao_maker_score: number;
}

interface LogEntry {
  lead_id: string;
  full_name: string;
  email: string;
  company: string;
  job_title: string;
  assunto: string;
  persona: string;
  timestamp_sent: string;
  resend_status: "sent" | "failed" | "dry-run" | "skipped";
  resend_id?: string;
  error?: string;
  delay_ms?: number;
}

// ─── Persona classification ───────────────────────────────────────────────────

type Persona = "ceo" | "cto" | "rh" | "outros";

function classifyPersona(jobTitle: string): Persona {
  const t = jobTitle.toLowerCase();

  // "presidente" only matches CEO when NOT preceded by "vice"
  const hasPresidente =
    t.includes("presidente") &&
    !t.includes("vice-presidente") &&
    !t.includes("vice presidente");

  const isCeo =
    t.includes("ceo") ||
    t.includes("co-ceo") ||
    t.includes("chief executive") ||
    t.includes("founder") ||
    t.includes("co-founder") ||
    t.includes("cofundador") ||
    t.includes("diretor-presidente") ||
    t.includes("diretor presidente") ||
    hasPresidente;

  if (isCeo) return "ceo";

  const isCto =
    /\bcto\b/.test(t) ||           // word boundary — avoids "director"
    /\bcio\b/.test(t) ||
    t.includes("ctio") ||
    t.includes("chief technology") ||
    t.includes("chief information") ||
    t.includes("chief technical") ||
    t.includes("vp of engineering") ||
    t.includes("vp engineering") ||
    t.includes("head of ai") ||
    t.includes("head of tech") ||
    t.includes("vice-president of technology") ||
    t.includes("vice president of technology") ||
    t.includes("technology officer");

  if (isCto) return "cto";

  const isRh =
    t.includes("human resources") ||
    t.includes("relações humanas") ||
    t.includes("relacoes humanas") ||
    t.includes("chief people") ||
    t.includes("chief human") ||
    t.includes("people officer") ||
    t.includes("chro") ||
    t.includes("people & culture") ||
    t.includes("talent");

  if (isRh) return "rh";

  return "outros";
}

// ─── Subject selection ────────────────────────────────────────────────────────

function selectSubject(lead: Lead, persona: Persona): string {
  const company = lead.company_name.replace(" / RD Station", "").trim();

  switch (persona) {
    case "ceo":    return "A cadeira vazia na sala de reuniões";
    case "cto":    return `O ativo que ${company} não consegue repor`;
    case "rh":     return "O problema que ninguém nomeia";
    case "outros": return `Uma pergunta sobre ${company}`;
  }
}

// ─── Buying signal insert ─────────────────────────────────────────────────────

function signalInsert(lead: Lead): string {
  const s = lead.buying_signal.toLowerCase();
  if (s.includes("ai") || s.includes("ml") || s.includes("artificial intelligence")) {
    return `\nEm um momento em que ${lead.company_name} acelera investimentos em IA, a questão do conhecimento humano preservado se torna ainda mais estratégica — não menos.\n`;
  }
  if (s.includes("careers") || s.includes("hiring")) {
    return `\nUma empresa em crescimento contrata talentos continuamente. O que raramente é gerido com o mesmo rigor é o conhecimento acumulado pelos profissionais que ficam — ou que vão embora.\n`;
  }
  if (s.includes("hr") || s.includes("people")) {
    return `\nA contratação de um HR Ops reflete atenção à estrutura de pessoas. Mas existe uma camada anterior à gestão de talentos que poucas organizações mapeiam formalmente.\n`;
  }
  return "";
}

// ─── Email bodies ─────────────────────────────────────────────────────────────

function buildBodyText(lead: Lead, persona: Persona): string {
  const name = lead.first_name;
  const company = lead.company_name.replace(" / RD Station", "").trim();
  const signal = signalInsert(lead);

  switch (persona) {
    case "ceo":
      return `Olá, ${name},

Toda empresa tem pelo menos um profissional cujo conhecimento é insubstituível.

Não pelo cargo. Pelo que está na cabeça dele: os contextos, os julgamentos, as decisões que ele tomou nos últimos 10, 15, 20 anos.

Quando esse profissional sai — por qualquer motivo — a empresa não perde um colaborador.

Perde décadas de inteligência organizacional construída a um custo imenso.
${signal}
Chamo isso de Hemorragia Cognitiva. É silenciosa, progressiva e quase sempre irreversível.

Nos próximos dias vou compartilhar o que aprendi sobre como as organizações mais inteligentes estão resolvendo esse problema — antes que ele se torne irreversível.

Abraço,
Samir Ricardo
Criador do Human RAG · vrashows.com.br/livro`;

    case "cto":
      return `Olá, ${name},

A maioria das empresas documenta bem o que as tecnologias fazem.

Documenta muito mal o que as pessoas que as construíram sabem.

Há uma diferença fundamental entre um sistema legado e o profissional que passou anos construindo a inteligência que o sustenta. O código pode ser lido. O contexto decisório por trás dele, não.

Quando esse profissional sai, ${company} não perde um recurso técnico.

Perde o julgamento acumulado que nenhum repositório consegue capturar.
${signal}
Chamo isso de Hemorragia Cognitiva. É silenciosa, progressiva e quase sempre irreversível.

Nos próximos dias vou compartilhar o que aprendi sobre como as organizações mais inteligentes estão resolvendo esse problema.

Abraço,
Samir Ricardo
Criador do Human RAG · vrashows.com.br/livro`;

    case "rh":
      return `Olá, ${name},

Existe uma diferença importante entre reter talentos e preservar conhecimento.

Retenção é sobre pessoas. Preservação é sobre o que está na cabeça delas — os contextos, os julgamentos, as decisões construídas ao longo de anos dentro de uma organização específica.

Quando uma pessoa-chave sai, ${company} pode encontrar outro profissional com as mesmas habilidades técnicas.

Não pode recuperar as décadas de inteligência organizacional que foram embora com ela.
${signal}
Chamo isso de Hemorragia Cognitiva. É silenciosa, progressiva e quase sempre irreversível.

Nos próximos dias vou compartilhar o que aprendi sobre como as organizações mais inteligentes estão resolvendo esse problema.

Abraço,
Samir Ricardo
Criador do Human RAG · vrashows.com.br/livro`;

    case "outros":
      return `Olá, ${name},

Uma pergunta direta sobre ${company}:

Existe alguém na empresa cujo conhecimento — se perdido amanhã — causaria um impacto que levaria meses ou anos para ser recuperado?

Não estou falando de habilidades técnicas ou capacidades de mercado.

Estou falando dos contextos, dos julgamentos, das decisões que essa pessoa tomou ao longo de anos e que nunca foram formalmente documentadas.
${signal}
Chamo esse fenômeno de Hemorragia Cognitiva. É silenciosa, progressiva e quase sempre irreversível.

Nos próximos dias vou compartilhar o que aprendi sobre como as organizações mais inteligentes estão resolvendo esse problema.

Abraço,
Samir Ricardo
Criador do Human RAG · vrashows.com.br/livro`;
  }
}

function textToHtmlParagraphs(text: string): string {
  return text
    .split(/\n\n+/)
    .map((p) => {
      const trimmed = p.trim();
      if (!trimmed) return "";
      return `<p style="margin:0 0 18px;color:#1a1a1a;font-size:15px;line-height:1.75;">${trimmed.replace(/\n/g, "<br>")}</p>`;
    })
    .filter(Boolean)
    .join("\n");
}

function buildBodyHtml(lead: Lead, persona: Persona): string {
  const bodyText = buildBodyText(lead, persona);

  // Strip the closing signature from the text to render it separately
  const signatureSeparator = "\nAbraço,\n";
  const sigIdx = bodyText.lastIndexOf(signatureSeparator);
  const mainText = sigIdx > -1 ? bodyText.slice(0, sigIdx) : bodyText;
  const signatureText = sigIdx > -1 ? bodyText.slice(sigIdx + 1) : "";

  const mainHtml = textToHtmlParagraphs(mainText);
  const signatureHtml = signatureText
    ? signatureText
        .split("\n")
        .filter(Boolean)
        .map((line, i) => {
          if (i === 0) return `<p style="margin:24px 0 0;color:#1a1a1a;font-size:15px;line-height:1.75;">${line}</p>`;
          if (line.startsWith("Samir")) return `<p style="margin:2px 0 0;font-size:15px;font-weight:600;color:#0f172a;">${line}</p>`;
          return `<p style="margin:2px 0 0;font-size:13px;color:#64748b;">${line}</p>`;
        })
        .join("\n")
    : "";

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f8f9fa;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f8f9fa;padding:32px 0;">
    <tr>
      <td align="center" style="padding:0 16px;">
        <table width="580" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border-radius:6px;max-width:580px;width:100%;border:1px solid #e5e7eb;">
          <tr>
            <td style="padding:40px 44px 36px;">
              ${mainHtml}
              ${signatureHtml}
              <table cellpadding="0" cellspacing="0" border="0" style="margin-top:32px;border-top:1px solid #e5e7eb;width:100%;">
                <tr>
                  <td style="padding-top:20px;">
                    <p style="margin:0;font-size:11px;color:#9ca3af;line-height:1.5;">
                      Caso prefira não receber novas mensagens, responda este email informando.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ─── Timing utilities ─────────────────────────────────────────────────────────

function brasiliaHour(): number {
  // Brasília = UTC-3
  const now = new Date();
  const utcH = now.getUTCHours();
  const utcM = now.getUTCMinutes();
  return ((utcH - 3 + 24) % 24) + utcM / 60;
}

function isBeforeCutoff(): boolean {
  return brasiliaHour() < CUTOFF_H;
}

function randomDelayMs(): number {
  const minMs = 8 * 60 * 1000;  // 8 minutes
  const maxMs = 15 * 60 * 1000; // 15 minutes
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function formatDelay(ms: number): string {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}m${s.toString().padStart(2, "0")}s`;
}

// ─── Log utilities ────────────────────────────────────────────────────────────

const LOG_DIR  = resolve(ROOT, "data/outreach/campanha_livro/fase_1");
const LOG_PATH = resolve(LOG_DIR, "2026-06-03.json");

function loadLog(): LogEntry[] {
  if (existsSync(LOG_PATH)) {
    try {
      return JSON.parse(readFileSync(LOG_PATH, "utf8")) as LogEntry[];
    } catch { return []; }
  }
  return [];
}

function saveLog(entries: LogEntry[]): void {
  mkdirSync(LOG_DIR, { recursive: true });
  writeFileSync(LOG_PATH, JSON.stringify(entries, null, 2), "utf8");
}

// ─── Console helpers ──────────────────────────────────────────────────────────

const USE_COLOR = process.stdout.isTTY;
const c = {
  bold:   (s: string) => USE_COLOR ? `\x1b[1m${s}\x1b[0m` : s,
  dim:    (s: string) => USE_COLOR ? `\x1b[2m${s}\x1b[0m` : s,
  green:  (s: string) => USE_COLOR ? `\x1b[32m${s}\x1b[0m` : s,
  yellow: (s: string) => USE_COLOR ? `\x1b[33m${s}\x1b[0m` : s,
  red:    (s: string) => USE_COLOR ? `\x1b[31m${s}\x1b[0m` : s,
  cyan:   (s: string) => USE_COLOR ? `\x1b[36m${s}\x1b[0m` : s,
  blue:   (s: string) => USE_COLOR ? `\x1b[34m${s}\x1b[0m` : s,
};

// ─── Main ─────────────────────────────────────────────────────────────────────

const FROM_ADDRESS = "samir@vrashows.com.br";
const FROM_NAME    = "Samir Ricardo";
const REPLY_TO     = "samir@vrashows.com.br";
const CAMPAIGN     = "lancamento-livro-0907";

async function main() {
  const leadsPath = resolve(ROOT, "leads_validados_2026-06-03.json");
  const leads: Lead[] = JSON.parse(readFileSync(leadsPath, "utf8"));

  const resend = new Resend(process.env.RESEND_API_KEY ?? "");

  // Load existing log to skip already-sent leads
  const log = loadLog();
  const sentEmails = new Set(log.filter(e => e.resend_status === "sent").map(e => e.email));

  // Filter candidates
  const candidates = leads
    .filter(l => !sentEmails.has(l.email))
    .slice(0, LIMIT);

  const hr = "═".repeat(68);

  console.log(`\n${c.bold("VRAXIA — Campanha Livro 0907 · Fase 1 · Ativação de Autoridade")}`);
  console.log(c.dim(`Arquivo: leads_validados_2026-06-03.json`));
  console.log(c.dim(`Campanha: ${CAMPAIGN} · From: ${FROM_ADDRESS}`));
  console.log(hr);
  console.log(`  Modo:        ${DRY_RUN ? c.yellow("DRY-RUN (adicione --live para enviar)") : c.red("⚡ LIVE SEND")}`);
  console.log(`  Leads total: ${leads.length} · Já enviados: ${sentEmails.size} · A processar: ${candidates.length}`);
  console.log(`  Limite:      ${LIMIT} emails/dia`);
  console.log(`  Intervalo:   8–15 min randomizado`);
  console.log(`  Janela:      até ${CUTOFF_H}h00 (Brasília)`);
  console.log(hr);

  // ── Preview mode ──────────────────────────────────────────────────────────

  if (PREVIEW) {
    console.log(`\n${c.bold("PREVIEW DOS EMAILS")}\n`);
    for (const lead of candidates) {
      const persona = classifyPersona(lead.job_title);
      const subject = selectSubject(lead, persona);
      const bodyText = buildBodyText(lead, persona);
      console.log(`  ${c.cyan(`[${lead.lead_id}]`)} ${c.bold(lead.full_name)} — ${lead.company_name}`);
      console.log(`  ${c.dim("Cargo:")}   ${lead.job_title}`);
      console.log(`  ${c.dim("Persona:")} ${persona.toUpperCase()}`);
      console.log(`  ${c.dim("Para:")}    ${lead.email}`);
      console.log(`  ${c.dim("Assunto:")} ${subject}`);
      console.log(`  ${c.dim("Signal:")}  ${lead.buying_signal}`);
      console.log(c.dim("  ─".repeat(34)));
      console.log(c.dim(bodyText.split("\n").map(l => `  ${l}`).join("\n")));
      console.log();
    }
    console.log(c.cyan(`Preview completo. ${candidates.length} leads prontos para envio.\n`));
    return;
  }

  // ── Send loop ─────────────────────────────────────────────────────────────

  console.log(`\n${c.bold("ENVIANDO")}\n`);

  let sent = 0;
  let failed = 0;
  let skippedCutoff = 0;

  for (let i = 0; i < candidates.length; i++) {
    const lead = candidates[i]!;

    if (!isBeforeCutoff()) {
      console.log(`\n  ${c.yellow("→ 18h Brasília atingido — parando envios.")}`);
      skippedCutoff = candidates.length - i;
      break;
    }

    const persona = classifyPersona(lead.job_title);
    const subject = selectSubject(lead, persona);
    const bodyText = buildBodyText(lead, persona);
    const bodyHtml = buildBodyHtml(lead, persona);

    const timestamp = new Date().toISOString();

    console.log(`  ${c.dim(`[${i + 1}/${candidates.length}]`)} ${c.bold(lead.full_name.padEnd(28))} ${c.dim("→")} ${lead.email}`);
    console.log(`         ${c.dim("Assunto:")} ${subject}`);

    let entry: LogEntry = {
      lead_id:       lead.lead_id,
      full_name:     lead.full_name,
      email:         lead.email,
      company:       lead.company_name,
      job_title:     lead.job_title,
      assunto:       subject,
      persona:       persona,
      timestamp_sent: timestamp,
      resend_status: "dry-run",
    };

    if (DRY_RUN) {
      entry.resend_status = "dry-run";
      console.log(`         ${c.yellow("DRY-RUN — email não enviado")}`);
    } else {
      try {
        const result = await resend.emails.send({
          from:    `${FROM_NAME} <${FROM_ADDRESS}>`,
          to:      lead.email,
          replyTo: REPLY_TO,
          subject: subject,
          text:    bodyText,
          html:    bodyHtml,
        });

        if (result.error) {
          entry.resend_status = "failed";
          entry.error = result.error.message ?? String(result.error);
          console.log(`         ${c.red(`FAILED — ${entry.error}`)}`);
          failed++;
        } else {
          entry.resend_status = "sent";
          entry.resend_id = result.data?.id;
          console.log(`         ${c.green(`SENT`)} ${c.dim(`· ID: ${entry.resend_id}`)}`);
          sent++;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        entry.resend_status = "failed";
        entry.error = msg;
        console.log(`         ${c.red(`ERROR — ${msg}`)}`);
        failed++;
      }
    }

    // Save log after every send (crash-safe)
    log.push(entry);
    saveLog(log);

    // Wait before next send (skip delay after last lead)
    if (i < candidates.length - 1 && isBeforeCutoff()) {
      const delay = randomDelayMs();
      entry.delay_ms = delay;
      saveLog(log); // update delay in log
      console.log(`         ${c.dim(`Próximo em ${formatDelay(delay)}…`)}\n`);
      await sleep(delay);
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────

  console.log(`\n${hr}`);
  if (DRY_RUN) {
    console.log(`  ${c.bold("DRY-RUN COMPLETO")} — nenhum email foi enviado`);
    console.log(`  Leads prontos: ${c.yellow(String(candidates.length))}`);
  } else {
    console.log(`  ${c.bold("SESSÃO COMPLETA")}`);
    console.log(`  Enviados:  ${c.green(String(sent).padStart(3))}`);
    console.log(`  Falhas:    ${c.red(String(failed).padStart(3))}`);
    if (skippedCutoff > 0) {
      console.log(`  Adiados:   ${String(skippedCutoff).padStart(3)} ${c.dim("(janela 18h encerrada)")}`);
    }
  }
  console.log(`  Log:       ${LOG_PATH}`);
  console.log(hr + "\n");
}

await main();
