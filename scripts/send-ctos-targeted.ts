#!/usr/bin/env tsx
import "dotenv/config";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { Resend } from "resend";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const TARGET_EMAILS = new Set([
  "felipe.cavalcanti@wildlifestudios.com",
  "rogerio.tessari@olist.com",
  "fabiola.marchiori@neon.com.br",
  "marcus.fontoura@stone.com",
]);

interface Lead {
  full_name: string; first_name: string; job_title: string;
  company_name: string; email: string;
}

function classifyPersona(t: string): "cto" | "ceo" | "rh" | "outros" {
  const s = t.toLowerCase();
  if (s.includes("cto") || s.includes("chief technology") || s.includes("chief technical")) return "cto";
  if (s.includes("ceo") || s.includes("founder") || s.includes("presidente")) return "ceo";
  if (s.includes("rh") || s.includes("people") || s.includes("chro")) return "rh";
  return "outros";
}

function buildSubject(lead: Lead, persona: string): string {
  if (persona === "cto") return `O ativo que ${lead.company_name} não consegue repor`;
  return "A cadeira vazia na sala de reuniões";
}

function buildBody(lead: Lead, persona: string): string {
  const name = lead.first_name;
  const company = lead.company_name;

  if (persona === "cto") {
    return `Olá, ${name},

A maioria das empresas documenta bem o que as tecnologias fazem.

Documenta muito mal o que as pessoas que as construíram sabem.

Há uma diferença fundamental entre um sistema legado e o profissional que passou anos construindo a inteligência que o sustenta. O código pode ser lido. O contexto decisório por trás dele, não.

Quando esse profissional sai, ${company} não perde um recurso técnico.

Perde o julgamento acumulado que nenhum repositório consegue capturar.

Chamo isso de Hemorragia Cognitiva. É silenciosa, progressiva e quase sempre irreversível.

Nos próximos dias vou compartilhar o que aprendi sobre como as organizações mais inteligentes estão resolvendo esse problema.

Abraço,
Samir Ricardo
Criador do Human RAG · vrashows.com.br/livro`;
  }

  return `Olá, ${name},

Toda empresa tem pelo menos um profissional cujo conhecimento é insubstituível.

Não pelo cargo. Pelo que está na cabeça dele: os contextos, os julgamentos, as decisões que ele tomou nos últimos 10, 15, 20 anos.

Quando esse profissional sai — por qualquer motivo — ${company} não perde um colaborador.

Perde décadas de inteligência organizacional construída a um custo imenso.

Chamo isso de Hemorragia Cognitiva. É silenciosa, progressiva e quase sempre irreversível.

Nos próximos dias vou compartilhar o que aprendi sobre como as organizações mais inteligentes estão resolvendo esse problema.

Abraço,
Samir Ricardo
Criador do Human RAG · vrashows.com.br/livro`;
}

function toHtml(text: string): string {
  const paragraphs = text
    .split(/\n\n+/)
    .map(p => `<p style="margin:0 0 18px;color:#1a1a1a;font-size:15px;line-height:1.75;">${p.trim().replace(/\n/g, "<br>")}</p>`)
    .join("\n");
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f8f9fa;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f8f9fa;padding:32px 0;">
    <tr><td align="center" style="padding:0 16px;">
      <table width="580" cellpadding="0" cellspacing="0" border="0" style="background:#fff;border-radius:6px;max-width:580px;width:100%;border:1px solid #e5e7eb;">
        <tr><td style="padding:40px 44px 36px;">
          ${paragraphs}
          <table cellpadding="0" cellspacing="0" border="0" style="margin-top:32px;border-top:1px solid #e5e7eb;width:100%;">
            <tr><td style="padding-top:20px;">
              <p style="margin:0;font-size:11px;color:#9ca3af;line-height:1.5;">Caso prefira não receber novas mensagens, responda este email informando.</p>
            </td></tr>
          </table>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

async function main() {
  const leads: Lead[] = JSON.parse(readFileSync(resolve(ROOT, "leads_validados_2026-06-03.json"), "utf8"));
  const targets = leads.filter(l => TARGET_EMAILS.has(l.email));

  if (targets.length === 0) { console.error("Nenhum lead encontrado."); process.exit(1); }

  const resend = new Resend(process.env.RESEND_API_KEY ?? "");
  const LOG_DIR = resolve(ROOT, "data/outreach/campanha_livro/fase_1");
  mkdirSync(LOG_DIR, { recursive: true });
  const LOG_PATH = resolve(LOG_DIR, "2026-06-08-ctos.json");
  const log: object[] = [];

  const hr = "═".repeat(60);
  console.log(`\n${"VRAXIA — CTO Targeted Send · Fase 1"}`);
  console.log(hr);
  console.log(`  Alvos: ${targets.length}\n`);

  for (const lead of targets) {
    const persona = classifyPersona(lead.job_title);
    const subject = buildSubject(lead, persona);
    const bodyText = buildBody(lead, persona);

    process.stdout.write(`  ${lead.full_name.padEnd(22)} → ${lead.email} ... `);

    try {
      const result = await resend.emails.send({
        from: "Samir Ricardo <samir@vrashows.com.br>",
        to: lead.email,
        replyTo: "samir@vrashows.com.br",
        subject,
        text: bodyText,
        html: toHtml(bodyText),
      });
      if (result.error) throw new Error(result.error.message ?? String(result.error));
      log.push({ email: lead.email, full_name: lead.full_name, subject, persona, status: "sent", resend_id: result.data?.id, timestamp: new Date().toISOString() });
      console.log(`SENT · ${result.data?.id}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.push({ email: lead.email, full_name: lead.full_name, subject, persona, status: "failed", error: msg, timestamp: new Date().toISOString() });
      console.log(`FAILED · ${msg}`);
    }

    writeFileSync(LOG_PATH, JSON.stringify(log, null, 2));
  }

  console.log(`\n${hr}`);
  const sent   = (log as any[]).filter(e => e.status === "sent").length;
  const failed = (log as any[]).filter(e => e.status === "failed").length;
  console.log(`  Enviados: ${sent}  |  Falhas: ${failed}`);
  console.log(`  Log: ${LOG_PATH}\n`);
}

await main();
