#!/usr/bin/env tsx
/**
 * run-imprensa-fase1.ts — Campanha livro 0907 · Outreach de Imprensa
 *
 * Envia press pitches para jornalistas e editores com email validado.
 * Templates diferenciados por tipo de veículo (A/B/C/D/E).
 *
 * Uso:
 *   tsx scripts/run-imprensa-fase1.ts              # dry-run (padrão)
 *   tsx scripts/run-imprensa-fase1.ts --live        # envio real
 *   tsx scripts/run-imprensa-fase1.ts --preview     # mostra emails sem enviar
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

const LIVE    = hasFlag("--live");
const DRY_RUN = !LIVE;
const PREVIEW = hasFlag("--preview");

// ─── Types ────────────────────────────────────────────────────────────────────

interface Contato {
  veiculo: string;
  nome_completo: string;
  cargo: string;
  editoria: string;
  email_validado: string;
  linkedin_url: string;
  cobre_ia_gestao: boolean;
  score_relevancia: number;
  template_recomendado: string;
  status: string;
}

interface LogEntry {
  veiculo: string;
  nome_completo: string;
  email: string;
  template: string;
  assunto: string;
  timestamp_sent: string;
  resend_status: "sent" | "failed" | "dry-run";
  resend_id?: string;
  error?: string;
}

// ─── Subjects ────────────────────────────────────────────────────────────────

function selectSubject(c: Contato): string {
  switch (c.template_recomendado) {
    case "A":
      return "Pauta: o ativo invisível que toda empresa está perdendo — lançamento 09/07";
    case "B":
      return "Pauta: Human RAG — o framework que preserva inteligência organizacional";
    case "C":
      return "Pauta: Hemorragia Cognitiva — o problema de RH que ninguém sabe nomear";
    case "D":
      return "Pauta/episódio: Capital Decisório e o conhecimento que vai embora com as pessoas";
    case "E":
      return "Pauta: lançamento de livro — Hemorragia Cognitiva e o custo invisível das demissões";
    default:
      return "Pauta: lançamento do livro O Maior Ativo da Sua Empresa — 09/07/2026";
  }
}

// ─── Email bodies ─────────────────────────────────────────────────────────────

function buildBodyText(c: Contato): string {
  const firstName  = c.nome_completo.split(" ")[0];
  const isEquipe   = c.nome_completo.toLowerCase().startsWith("equipe");
  const equipeNome = isEquipe ? c.nome_completo.replace(/^equipe\s+/i, "") : "";
  const saudacao   = isEquipe ? `Olá, equipe ${equipeNome},` : `Olá, ${firstName},`;

  switch (c.template_recomendado) {
    case "A":
      return `${saudacao}

Tenho uma pauta para ${c.veiculo}.

Em 09 de julho lanço o livro "O Maior Ativo da Sua Empresa — E por que ele está indo embora" — um trabalho sobre um fenômeno que toda empresa experimenta mas pouquíssimas sabem nomear.

O argumento central: quando um profissional sênior deixa uma organização, a empresa não perde apenas uma pessoa. Perde décadas de contextos, julgamentos e inteligência organizacional que nunca foram formalmente documentados.

Chamo isso de Hemorragia Cognitiva.

O livro apresenta o framework Human RAG — a arquitetura que desenvolvi para preservar o que denomino Capital Decisório antes que ele desapareça.

O tema é relevante para CEOs e fundadores de médio porte que já vivenciaram essa perda. Tenho disponível para entrevista, capítulo de amostra e material de imprensa.

Abraço,
Samir Ricardo
Autor · Criador do Human RAG · vrashows.com.br/livro`;

    case "B":
      return `${saudacao}

Tenho uma pauta de tecnologia e IA para ${c.veiculo}.

Em 09 de julho lanço o livro "O Maior Ativo da Sua Empresa — E por que ele está indo embora" — um trabalho que formaliza um conceito inédito no cruzamento entre IA e gestão do conhecimento.

O framework central: Human RAG (Retrieval-Augmented Generation aplicado ao conhecimento humano organizacional). A ideia é que assim como sistemas de IA recuperam contexto de bases externas antes de responder, organizações precisam de uma arquitetura para recuperar e preservar o Capital Decisório dos seus profissionais antes que ele se perca.

O problema que nomeio: Hemorragia Cognitiva — a perda silenciosa de inteligência organizacional quando pessoas-chave saem.

Seria interessante para ${c.veiculo} discutir como IA e gestão do conhecimento humano se cruzam? Tenho disponível para entrevista e material de imprensa.

Abraço,
Samir Ricardo
Autor · Criador do Human RAG · vrashows.com.br/livro`;

    case "C":
      return `${saudacao}

Tenho uma pauta de RH e gestão de pessoas para ${c.veiculo}.

Em 09 de julho lanço o livro "O Maior Ativo da Sua Empresa — E por que ele está indo embora" — um trabalho sobre um fenômeno crítico para quem atua em gestão de pessoas.

O argumento: a maioria das organizações gerencia retenção com rigor, mas ignora a preservação do conhecimento que as pessoas carregam. Quando um profissional sênior sai, a empresa perde não apenas um talento — perde décadas de inteligência organizacional construída a um custo imenso.

Chamo isso de Hemorragia Cognitiva.

O livro apresenta o framework Human RAG como arquitetura prática para preservar o Capital Decisório — o ativo mais estratégico e menos gerenciado da maioria das organizações brasileiras.

Tenho disponível para entrevista, capítulo de amostra e material de imprensa.

Abraço,
Samir Ricardo
Autor · Criador do Human RAG · vrashows.com.br/livro`;

    case "D":
      return `${saudacao}

Tenho uma sugestão de episódio para ${c.veiculo}.

Em 09 de julho lanço o livro "O Maior Ativo da Sua Empresa — E por que ele está indo embora" — um trabalho sobre um fenômeno que toda organização experimenta mas que raramente é nomeado ou gerenciado.

O tema central: o que acontece com décadas de experiência, julgamento e contexto organizacional quando um profissional excepcional vai embora? E como as organizações mais inteligentes estão começando a preservar esse conhecimento antes que ele se perca?

Desenvolvi um framework para isso — Human RAG — e o conceito de Capital Decisório como o ativo mais estratégico das organizações.

Seria um episódio relevante para a audiência de ${c.veiculo}? Tenho disponível para uma conversa a qualquer momento.

Abraço,
Samir Ricardo
Autor · Criador do Human RAG · vrashows.com.br/livro`;

    case "E":
      return `${saudacao}

Tenho uma sugestão de pauta para ${c.veiculo}.

Em 09 de julho lanço o livro "O Maior Ativo da Sua Empresa — E por que ele está indo embora" — um trabalho que aborda um custo organizacional amplamente ignorado: a perda de inteligência acumulada quando profissionais sênior deixam uma empresa.

O conceito central é o que denomino Hemorragia Cognitiva — a perda silenciosa de décadas de contextos, julgamentos e decisões que nenhum processo de offboarding consegue capturar. O custo estimado de substituição de um executivo sênior chega a 2x o salário anual, mas a perda real de Capital Decisório raramente é mensurada.

O livro apresenta o framework Human RAG como solução para esse problema e está voltado para CEOs, diretores e executivos de empresas de médio porte.

Tenho disponível para entrevista e material de imprensa.

Abraço,
Samir Ricardo
Autor · Criador do Human RAG · vrashows.com.br/livro`;

    default:
      return `${saudacao}

Tenho uma pauta para ${c.veiculo}.

Em 09 de julho lanço o livro "O Maior Ativo da Sua Empresa — E por que ele está indo embora".

Tenho disponível para entrevista e material de imprensa.

Abraço,
Samir Ricardo
vrashows.com.br/livro`;
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

function buildBodyHtml(contato: Contato): string {
  const bodyText = buildBodyText(contato);
  const signatureSeparator = "\nAbraço,\n";
  const sigIdx = bodyText.lastIndexOf(signatureSeparator);
  const mainText      = sigIdx > -1 ? bodyText.slice(0, sigIdx) : bodyText;
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

// ─── Log utilities ────────────────────────────────────────────────────────────

const LOG_DIR  = resolve(ROOT, "data/outreach/campanha_livro/imprensa");
const LOG_PATH = resolve(LOG_DIR, "2026-06-08.json");
const DATA_PATH = resolve(ROOT, "dados_imprensa_linkedin/contatos_validados.json");

function loadLog(): LogEntry[] {
  if (existsSync(LOG_PATH)) {
    try { return JSON.parse(readFileSync(LOG_PATH, "utf8")) as LogEntry[]; }
    catch { return []; }
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
};

// ─── Main ─────────────────────────────────────────────────────────────────────

const FROM_ADDRESS = "samir@vrashows.com.br";
const FROM_NAME    = "Samir Ricardo";
const REPLY_TO     = "samir@vrashows.com.br";

async function main() {
  const contatos: Contato[] = JSON.parse(readFileSync(DATA_PATH, "utf8"));

  const resend = new Resend(process.env.RESEND_API_KEY ?? "");

  const log = loadLog();
  const sentEmails = new Set(log.filter(e => e.resend_status === "sent").map(e => e.email));

  // Only contacts with validated email, not yet sent
  const candidates = contatos.filter(
    ct => ct.email_validado && ct.email_validado.trim() !== "" && !sentEmails.has(ct.email_validado)
  );

  const pendentes = contatos.filter(ct => !ct.email_validado || ct.email_validado.trim() === "");

  const hr = "═".repeat(68);

  console.log(`\n${c.bold("VRAXIA — Campanha Livro 0907 · Outreach de Imprensa")}`);
  console.log(hr);
  console.log(`  Modo:         ${DRY_RUN ? c.yellow("DRY-RUN (adicione --live para enviar)") : c.red("⚡ LIVE SEND")}`);
  console.log(`  Com email:    ${c.cyan(String(candidates.length + sentEmails.size))} contatos · Já enviados: ${sentEmails.size} · A enviar: ${c.cyan(String(candidates.length))}`);
  console.log(`  Sem email:    ${c.yellow(String(pendentes.length))} pendentes de enriquecimento`);
  console.log(hr);

  if (PREVIEW) {
    console.log(`\n${c.bold("PREVIEW DOS PRESS PITCHES")}\n`);
    for (const ct of candidates) {
      const subject  = selectSubject(ct);
      const bodyText = buildBodyText(ct);
      console.log(`  ${c.cyan(`[${ct.template_recomendado}]`)} ${c.bold(ct.nome_completo)} — ${ct.veiculo}`);
      console.log(`  ${c.dim("Cargo:")}   ${ct.cargo}`);
      console.log(`  ${c.dim("Para:")}    ${ct.email_validado}`);
      console.log(`  ${c.dim("Assunto:")} ${subject}`);
      console.log(c.dim("  ─".repeat(34)));
      console.log(c.dim(bodyText.split("\n").map(l => `  ${l}`).join("\n")));
      console.log();
    }
    if (pendentes.length > 0) {
      console.log(c.yellow(`\n  ${pendentes.length} contatos aguardando email (enriquecimento pendente):`));
      for (const ct of pendentes) {
        console.log(c.dim(`    · ${ct.veiculo} — ${ct.nome_completo} [${ct.template_recomendado}]`));
      }
    }
    console.log();
    return;
  }

  if (candidates.length === 0) {
    console.log(`\n  ${c.yellow("Nenhum contato novo para enviar. Todos já foram processados ou sem email validado.")}\n`);
    return;
  }

  console.log(`\n${c.bold("ENVIANDO")}\n`);

  let sent    = 0;
  let failed  = 0;

  for (let i = 0; i < candidates.length; i++) {
    const ct = candidates[i]!;
    const subject  = selectSubject(ct);
    const bodyText = buildBodyText(ct);
    const bodyHtml = buildBodyHtml(ct);
    const timestamp = new Date().toISOString();

    console.log(`  ${c.dim(`[${i + 1}/${candidates.length}]`)} ${c.bold(ct.nome_completo.padEnd(28))} ${c.dim("→")} ${ct.email_validado}`);
    console.log(`         ${c.dim("Veículo:")} ${ct.veiculo} · Template ${ct.template_recomendado}`);
    console.log(`         ${c.dim("Assunto:")} ${subject}`);

    const entry: LogEntry = {
      veiculo:        ct.veiculo,
      nome_completo:  ct.nome_completo,
      email:          ct.email_validado,
      template:       ct.template_recomendado,
      assunto:        subject,
      timestamp_sent: timestamp,
      resend_status:  "dry-run",
    };

    if (DRY_RUN) {
      console.log(`         ${c.yellow("DRY-RUN — email não enviado")}`);
    } else {
      try {
        const result = await resend.emails.send({
          from:    `${FROM_NAME} <${FROM_ADDRESS}>`,
          to:      ct.email_validado,
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
          console.log(`         ${c.green("SENT")} ${c.dim(`· ID: ${entry.resend_id}`)}`);
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

    log.push(entry);
    saveLog(log);

    // Brief pause between sends (press pitches, lower volume — 3s is fine)
    if (!DRY_RUN && i < candidates.length - 1) {
      await new Promise(r => setTimeout(r, 3000));
    }

    console.log();
  }

  console.log(hr);
  if (DRY_RUN) {
    console.log(`  ${c.bold("DRY-RUN COMPLETO")} — nenhum email foi enviado`);
    console.log(`  Prontos para envio: ${c.yellow(String(candidates.length))}`);
  } else {
    console.log(`  ${c.bold("SESSÃO COMPLETA")}`);
    console.log(`  Enviados:  ${c.green(String(sent).padStart(3))}`);
    console.log(`  Falhas:    ${c.red(String(failed).padStart(3))}`);
  }
  if (pendentes.length > 0) {
    console.log(`  ${c.yellow(`${pendentes.length} veículos sem email`)} — enriquecimento necessário para próximo batch`);
  }
  console.log(`  Log:       ${LOG_PATH}`);
  console.log(hr + "\n");
}

await main();
