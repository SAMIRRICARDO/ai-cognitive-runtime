/**
 * outreach-builder/builder.ts — Deterministic personalized email builder
 *
 * Generates enterprise-grade outreach emails from ValidatedLead data.
 * No LLM required — all personalization is rule-based and auditable.
 *
 * Produces inner body HTML + plain-text for send-email's template wrapper.
 */

import type { ValidatedLead } from "../lead-validation/types.js";
import { pickSubjectVariant, extractFirstName } from "../../tools/send-email.js";
import { scoreEmailQuality } from "../../tools/email-quality.js";
import type { OutreachQualityReport } from "../../tools/email-quality.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PersonalizedEmail {
  subject: string;
  bodyText: string;
  bodyHtml: string;
  firstName: string;
  quality: OutreachQualityReport;
}

// ─── Company-specific context snippets ───────────────────────────────────────

const COMPANY_CONTEXT: Record<string, string> = {
  aws:       "A AWS é referência em presença enterprise em eventos de tecnologia e cloud no Brasil — eventos como re:Invent, Summit e a movimentada participação no Futurecom exigem operação integrada de alto nível.",
  claro:     "A Claro é uma das empresas com presença mais expressiva no Futurecom — stands de alto padrão, ativações de produto e equipes de relacionamento exigindo execução impecável em cada edição.",
  vivo:      "A Vivo/Telefônica tem uma das presenças mais marcantes em eventos do setor de conectividade no Brasil — com ativações de brand experience que precisam de operação precisa e fluida do início ao fim.",
  huawei:    "A Huawei mantém uma das presenças mais sofisticadas em eventos enterprise de tecnologia no Brasil — com instalações imponentes, demos técnicos e uma operação complexa que demanda controle total.",
  ericsson:  "A Ericsson mantém uma das presenças mais complexas no Futurecom — stand de múltiplos andares com demos 5G, hospitality VIP e diversas equipes simultâneas de produto e parceiros. Uma das operações mais exigentes do calendário enterprise.",
  cisco:     "A Cisco realiza grandes ativações de ecossistema no Futurecom — demos de switching, security e colaboração coordenados com dezenas de parceiros de canal, exigindo controle operacional absoluto e experiência consistente.",
  nokia:     "A Nokia usa o Futurecom para demos de rede privada 5G e soluções para utilities — stand de alto padrão com demos interativos e presença de executivos C-level que exigem uma experiência impecável do início ao fim.",
  tim:       "A TIM Brasil mantém presença estratégica no Futurecom com foco em IoT, 5G e B2B — stand com demos técnicos e área de relacionamento executivo que demanda operação precisa e suporte constante.",
  microsoft: "A Microsoft leva Azure, AI e Copilot ao Futurecom com uma das ativações de maior impacto — lounge executivo, demos assistidos e grandes equipes de campo que exigem uma operação integrada e sem improvisos.",
  embratel:  "A Embratel (Claro Empresas) é uma das marcas enterprise mais ativas em eventos de conectividade no Brasil — stand de alto padrão com SD-WAN, IoT e segurança gerenciada, exigindo operação integrada e execução impecável.",
  "v.tal":   "A V.tal, maior empresa de fibra neutra do Brasil, tem presença estratégica no Futurecom como infraestrutura crítica de conectividade — relacionamento executivo com operadoras que exige experiência de alto padrão.",
  ibm:       "A IBM usa eventos enterprise para posicionar AI (WatsonX) e hybrid cloud — stand de alto padrão com demos assistidos e agenda de reuniões executivas que exigem experiência premium e controle operacional preciso.",
  oracle:    "A Oracle Cloud Infrastructure (OCI) cresce no Brasil com foco em banco de dados e aplicações enterprise — presença no Futurecom com demos e agenda de parceiros que demanda execução integrada e sem improvisos.",
  zte:       "A ZTE participa do Futurecom com grandes demos de 5G e rede ótica — stand de alto padrão com reuniões executivas com operadoras e demos técnicos complexos que exigem operação impecável.",
  hpe:       "A Hewlett Packard Enterprise tem forte presença em eventos de infraestrutura — demos de Aruba (wireless enterprise) e GreenLake no Futurecom que exigem operação precisa e experiência consistente para parceiros e clientes.",
  dell:      "A Dell Technologies mantém presença enterprise significativa no Brasil — stand com demos de infraestrutura, storage e workstations para mercados verticais que exigem controle operacional e suporte constante.",
  sap:       "A SAP participa de eventos de transformação digital com demos de S/4HANA, Rise e BTP — presença de executivos e área de networking premium que exige operação impecável e experiência de marca consistente.",
  salesforce: "A Salesforce usa eventos enterprise para demonstrar AI e CRM — com Agentforce e Einstein em demos assistidos, equipes de campo e networking executivo que exigem operação integrada e fluida.",
  totvs:     "A TOTVS, maior ERP brasileiro, participa do Futurecom com stand de alto padrão e área executiva — demos de conectividade e integração com operadoras que exigem controle operacional total e experiência premium.",
};

function getCompanyContext(company: string): string {
  const key = company.toLowerCase();
  for (const [k, v] of Object.entries(COMPANY_CONTEXT)) {
    if (key.includes(k)) return v;
  }
  return "";
}

// ─── Area/role intro variants ─────────────────────────────────────────────────

function buildIntro(lead: ValidatedLead, firstName: string): { text: string; html: string } {
  const area = lead.area.toLowerCase();
  const role = lead.role.toLowerCase();
  const company = lead.company;
  const companyCtx = getCompanyContext(company);

  let introText: string;
  let introHtml: string;

  if (area === "c-suite" || lead.seniority === "c-level") {
    introText = [
      `${firstName},`,
      "",
      `Sei que o seu tempo é escasso — vou direto ao ponto.`,
      "",
      companyCtx ? `${companyCtx}\n\n` : "",
      `Sou Samir Ricardo, da VRASHOWS. Somos um hub de operações integradas para eventos corporativos enterprise — assumimos toda a logística, staff e produção executiva para que a liderança possa focar 100% em relacionamento e negócios.`,
    ].join("\n").replace("\n\n\n", "\n\n");

    introHtml = [
      `<p style="margin:0 0 18px;font-size:15px;"><strong>${firstName},</strong></p>`,
      `<p style="margin:0 0 16px;">Sei que o seu tempo é escasso — vou direto ao ponto.</p>`,
      companyCtx ? `<p style="margin:0 0 16px;">${companyCtx}</p>` : "",
      `<p style="margin:0 0 16px;">Sou Samir Ricardo, da <strong>VRASHOWS</strong>. Somos um hub de operações integradas para eventos corporativos enterprise — assumimos toda a logística, staff e produção executiva para que a liderança possa focar 100% em relacionamento e negócios.</p>`,
    ].filter(Boolean).join("\n");

  } else if (area.includes("marketing") && (role.includes("events") || role.includes("brand") || role.includes("eventos"))) {
    introText = [
      `Olá ${firstName},`,
      "",
      companyCtx ? `${companyCtx}\n` : "",
      `Coordenar uma operação de eventos enterprise com dezenas de fornecedores, equipes de campo e demandas simultâneas exige algo que vai muito além de gestão de fornecedores — exige um parceiro que assuma a operação e entregue controle total, sem ruído.`,
      "",
      `É exatamente esse o papel da VRASHOWS.`,
    ].join("\n").replace("\n\n\n", "\n\n");

    introHtml = [
      `<p style="margin:0 0 18px;font-size:15px;">Olá ${firstName},</p>`,
      companyCtx ? `<p style="margin:0 0 16px;">${companyCtx}</p>` : "",
      `<p style="margin:0 0 16px;">Coordenar uma operação de eventos enterprise com dezenas de fornecedores, equipes de campo e demandas simultâneas exige algo que vai muito além de gestão de fornecedores — exige um parceiro que assuma a operação e entregue controle total, sem ruído.</p>`,
      `<p style="margin:0 0 16px;">É exatamente esse o papel da <strong>VRASHOWS</strong>.</p>`,
    ].filter(Boolean).join("\n");

  } else if (area.includes("marketing") && role.includes("partner")) {
    introText = [
      `Olá ${firstName},`,
      "",
      companyCtx ? `${companyCtx}\n` : "",
      `Apoiar o ecossistema de parceiros em eventos enterprise — com qualidade de execução que reflita o posicionamento da marca — é uma das operações mais complexas do calendário corporativo. Staff qualificado, logística integrada, experiência do visitante: cada detalhe impacta a percepção dos parceiros.`,
      "",
      `A VRASHOWS existe exatamente para isso.`,
    ].join("\n").replace("\n\n\n", "\n\n");

    introHtml = [
      `<p style="margin:0 0 18px;font-size:15px;">Olá ${firstName},</p>`,
      companyCtx ? `<p style="margin:0 0 16px;">${companyCtx}</p>` : "",
      `<p style="margin:0 0 16px;">Apoiar o ecossistema de parceiros em eventos enterprise — com qualidade de execução que reflita o posicionamento da marca — é uma das operações mais complexas do calendário corporativo. Staff qualificado, logística integrada, experiência do visitante: cada detalhe impacta a percepção dos parceiros.</p>`,
      `<p style="margin:0 0 16px;">A <strong>VRASHOWS</strong> existe exatamente para isso.</p>`,
    ].filter(Boolean).join("\n");

  } else if (area.includes("partnerships")) {
    introText = [
      `Olá ${firstName},`,
      "",
      companyCtx ? `${companyCtx}\n` : "",
      `Desenvolver e ativar um ecossistema de parceiros enterprise em eventos do porte do Futurecom requer uma operação bastidores que seja invisível — mas absolutamente confiável. Cada parceiro que interage com a operação forma uma impressão da marca anfitriã.`,
      "",
      `A VRASHOWS é esse parceiro operacional.`,
    ].join("\n").replace("\n\n\n", "\n\n");

    introHtml = [
      `<p style="margin:0 0 18px;font-size:15px;">Olá ${firstName},</p>`,
      companyCtx ? `<p style="margin:0 0 16px;">${companyCtx}</p>` : "",
      `<p style="margin:0 0 16px;">Desenvolver e ativar um ecossistema de parceiros enterprise em eventos do porte do Futurecom requer uma operação bastidores que seja invisível — mas absolutamente confiável. Cada parceiro que interage com a operação forma uma impressão da marca anfitriã.</p>`,
      `<p style="margin:0 0 16px;">A <strong>VRASHOWS</strong> é esse parceiro operacional.</p>`,
    ].filter(Boolean).join("\n");

  } else {
    introText = [
      `Olá ${firstName},`,
      "",
      companyCtx ? `${companyCtx}\n` : "",
      `Grandes eventos corporativos exigem muito mais do que execução operacional. Exigem controle, velocidade de resposta e uma experiência consistente do início ao fim — mesmo quando dezenas de fornecedores, equipes e demandas acontecem simultaneamente.`,
      "",
      `É exatamente nesse cenário que a VRASHOWS atua.`,
    ].join("\n").replace("\n\n\n", "\n\n");

    introHtml = [
      `<p style="margin:0 0 18px;font-size:15px;">Olá ${firstName},</p>`,
      companyCtx ? `<p style="margin:0 0 16px;">${companyCtx}</p>` : "",
      `<p style="margin:0 0 16px;">Grandes eventos corporativos exigem muito mais do que execução operacional. Exigem controle, velocidade de resposta e uma experiência consistente do início ao fim — mesmo quando dezenas de fornecedores, equipes e demandas acontecem simultaneamente.</p>`,
      `<p style="margin:0 0 16px;">É exatamente nesse cenário que a <strong>VRASHOWS</strong> atua.</p>`,
    ].filter(Boolean).join("\n");
  }

  return { text: introText, html: introHtml };
}

// ─── Hub positioning block ────────────────────────────────────────────────────

const HUB_BLOCK_TEXT = `Somos um hub de soluções integradas para eventos corporativos e experiências de marca, assumindo toda a operação para que sua equipe possa concentrar energia no que realmente importa: relacionamento, negócios e resultado.

Coordenamos de forma integrada:
• logística operacional
• staff premium
• produção executiva
• hospitality
• suporte 360° em tempo real
• experiência do visitante

Tudo com acompanhamento próximo, agilidade operacional e execução sem improvisos.`;

const HUB_BLOCK_HTML = `<p style="margin:0 0 16px;">Somos um hub de soluções integradas para eventos corporativos e experiências de marca, assumindo toda a operação para que sua equipe possa concentrar energia no que realmente importa: relacionamento, negócios e resultado.</p>
<p style="margin:0 0 10px;">Coordenamos de forma integrada:</p>
<table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;">
  <tr><td style="padding:3px 0;color:#1e293b;font-size:15px;">&#8226;&nbsp; logística operacional</td></tr>
  <tr><td style="padding:3px 0;color:#1e293b;font-size:15px;">&#8226;&nbsp; staff premium</td></tr>
  <tr><td style="padding:3px 0;color:#1e293b;font-size:15px;">&#8226;&nbsp; produção executiva</td></tr>
  <tr><td style="padding:3px 0;color:#1e293b;font-size:15px;">&#8226;&nbsp; hospitality</td></tr>
  <tr><td style="padding:3px 0;color:#1e293b;font-size:15px;">&#8226;&nbsp; suporte 360&deg; em tempo real</td></tr>
  <tr><td style="padding:3px 0;color:#1e293b;font-size:15px;">&#8226;&nbsp; experiência do visitante</td></tr>
</table>
<p style="margin:0 0 16px;">Tudo com acompanhamento próximo, agilidade operacional e execução sem improvisos.</p>`;

// C-level gets a shorter hub block
const HUB_BLOCK_SHORT_TEXT = `Na VRASHOWS, assumimos toda a operação — logística, staff premium, produção executiva, hospitality e suporte 360° — para que a liderança foque em relacionamento e resultado.`;

const HUB_BLOCK_SHORT_HTML = `<p style="margin:0 0 16px;">Na <strong>VRASHOWS</strong>, assumimos toda a operação — logística, staff premium, produção executiva, hospitality e suporte 360° — para que a liderança foque em relacionamento e resultado.</p>`;

// ─── Tagline block ────────────────────────────────────────────────────────────

const TAGLINE_TEXT = `"Enquanto você fecha negócios, nós controlamos a operação."`;
const TAGLINE_HTML = `<p style="background:#f8fafc;border-left:3px solid #0f172a;padding:14px 18px;margin:24px 0;font-style:italic;color:#334155;font-size:14px;line-height:1.6;"><em>&ldquo;Enquanto você fecha negócios, nós controlamos a operação.&rdquo;</em></p>`;

// ─── ABRINT case block ────────────────────────────────────────────────────────

const ABRINT_TEXT = `Na ABRINT 2026, atuamos ao lado da Brasil TecPar conduzindo toda a operação do evento com foco em fluidez operacional, experiência do público e suporte integral à equipe da marca — reduzindo ruído operacional e permitindo total foco em networking e geração de negócios.`;

const ABRINT_HTML = `<p style="margin:0 0 16px;">Na <strong>ABRINT 2026</strong>, atuamos ao lado da <strong>Brasil TecPar</strong> conduzindo toda a operação do evento com foco em fluidez operacional, experiência do público e suporte integral à equipe da marca — reduzindo ruído operacional e permitindo total foco em networking e geração de negócios.</p>`;

// ─── Closing blocks ───────────────────────────────────────────────────────────

const ATTACHMENT_TEXT = `Estou encaminhando em anexo nosso material institucional com mais detalhes sobre a estrutura e metodologia da VRASHOWS.`;
const ATTACHMENT_HTML = `<p style="margin:0 0 16px;">Estou encaminhando em anexo nosso material institucional com mais detalhes sobre a estrutura e metodologia da VRASHOWS.</p>`;

function buildCta(lead: ValidatedLead): { text: string; html: string } {
  const text = lead.recommendedCTA;
  const html = `<p style="margin:0 0 0;">${text}</p>`;
  return { text, html };
}

// ─── Subject selection ────────────────────────────────────────────────────────

const EXECUTIVE_SUBJECTS = [
  "Parceria operacional para eventos enterprise",
  "Operação integrada para os próximos eventos",
  "Estrutura operacional para eventos de alta complexidade",
] as const;

function buildSubject(lead: ValidatedLead): string {
  if (lead.seniority === "c-level") {
    let hash = 0;
    for (let i = 0; i < lead.primaryEmail.length; i++) {
      hash = (hash * 31 + lead.primaryEmail.charCodeAt(i)) & 0xffff;
    }
    return EXECUTIVE_SUBJECTS[hash % EXECUTIVE_SUBJECTS.length]!;
  }
  return pickSubjectVariant(lead.primaryEmail);
}

// ─── Main builder ─────────────────────────────────────────────────────────────

export function buildPersonalizedEmail(lead: ValidatedLead): PersonalizedEmail {
  const firstName = extractFirstName(lead.contactName);
  const subject = buildSubject(lead);
  const isExecutive = lead.seniority === "c-level";

  const intro = buildIntro(lead, firstName);
  const hubText = isExecutive ? HUB_BLOCK_SHORT_TEXT : HUB_BLOCK_TEXT;
  const hubHtml = isExecutive ? HUB_BLOCK_SHORT_HTML : HUB_BLOCK_HTML;
  const cta = buildCta(lead);

  // ── Plain text assembly
  const bodyTextParts = [
    intro.text,
    "",
    hubText,
    "",
    TAGLINE_TEXT,
    "",
    ...(lead.useCaseABRINT ? [ABRINT_TEXT, ""] : []),
    ATTACHMENT_TEXT,
    "",
    cta.text,
  ];
  const bodyText = bodyTextParts.join("\n").replace(/\n{3,}/g, "\n\n").trim();

  // ── HTML assembly
  const bodyHtmlParts = [
    intro.html,
    hubHtml,
    TAGLINE_HTML,
    ...(lead.useCaseABRINT ? [ABRINT_HTML] : []),
    ATTACHMENT_HTML,
    cta.html,
  ];
  const bodyHtml = bodyHtmlParts.filter(Boolean).join("\n");

  const quality = scoreEmailQuality(subject, bodyText, bodyHtml);

  return { subject, bodyText, bodyHtml, firstName, quality };
}
