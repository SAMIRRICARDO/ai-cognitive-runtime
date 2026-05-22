/**
 * outreach-builder/builder.ts — Deterministic personalized email builder
 *
 * Generates enterprise-grade outreach emails from ValidatedLead data.
 * No LLM required — all personalization is rule-based and auditable.
 *
 * Produces inner body HTML + plain-text for send-email's template wrapper.
 *
 * Template oficial v3.0 — 2026-05-21
 * Posicionamento: parceiro operacional estratégico para eventos enterprise e feiras de negócios.
 * Centralização operacional em um único fornecedor, operação sem improvisos.
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
      `Vou direto ao ponto.`,
      "",
      companyCtx ? `${companyCtx}\n\n` : "",
      `Grandes marcas não participam de eventos como o Futurecom apenas com um stand — existe toda uma operação estratégica por trás da experiência, logística e presença da marca no evento. É exatamente nesse ponto que a VRASHOWS atua.`,
    ].join("\n").replace("\n\n\n", "\n\n");

    introHtml = [
      `<p style="margin:0 0 18px;font-size:15px;"><strong>${firstName},</strong></p>`,
      `<p style="margin:0 0 16px;">Vou direto ao ponto.</p>`,
      companyCtx ? `<p style="margin:0 0 16px;">${companyCtx}</p>` : "",
      `<p style="margin:0 0 16px;">Grandes marcas não participam de eventos como o Futurecom apenas com um stand — existe toda uma operação estratégica por trás da experiência, logística e presença da marca no evento. É exatamente nesse ponto que a <strong>VRASHOWS</strong> atua.</p>`,
    ].filter(Boolean).join("\n");

  } else if (area.includes("marketing") && (role.includes("events") || role.includes("brand") || role.includes("eventos"))) {
    introText = [
      `Olá ${firstName},`,
      "",
      companyCtx ? `${companyCtx}\n` : "",
      `Grandes marcas não participam de eventos como o Futurecom apenas com um stand — coordenar toda a operação por trás da experiência, logística e presença da marca é um trabalho que vai muito além da gestão de fornecedores.`,
      "",
      `É exatamente nesse ponto que a VRASHOWS atua.`,
    ].join("\n").replace("\n\n\n", "\n\n");

    introHtml = [
      `<p style="margin:0 0 18px;font-size:15px;">Olá ${firstName},</p>`,
      companyCtx ? `<p style="margin:0 0 16px;">${companyCtx}</p>` : "",
      `<p style="margin:0 0 16px;">Grandes marcas não participam de eventos como o Futurecom apenas com um stand — coordenar toda a operação por trás da experiência, logística e presença da marca é um trabalho que vai muito além da gestão de fornecedores.</p>`,
      `<p style="margin:0 0 16px;">É exatamente nesse ponto que a <strong>VRASHOWS</strong> atua.</p>`,
    ].filter(Boolean).join("\n");

  } else if (area.includes("marketing") && role.includes("partner")) {
    introText = [
      `Olá ${firstName},`,
      "",
      companyCtx ? `${companyCtx}\n` : "",
      `Grandes marcas não participam de eventos como o Futurecom apenas com um stand — apoiar o ecossistema de parceiros com qualidade de execução que reflita o posicionamento da marca é uma das operações mais complexas do calendário enterprise.`,
      "",
      `A VRASHOWS é esse parceiro operacional.`,
    ].join("\n").replace("\n\n\n", "\n\n");

    introHtml = [
      `<p style="margin:0 0 18px;font-size:15px;">Olá ${firstName},</p>`,
      companyCtx ? `<p style="margin:0 0 16px;">${companyCtx}</p>` : "",
      `<p style="margin:0 0 16px;">Grandes marcas não participam de eventos como o Futurecom apenas com um stand — apoiar o ecossistema de parceiros com qualidade de execução que reflita o posicionamento da marca é uma das operações mais complexas do calendário enterprise.</p>`,
      `<p style="margin:0 0 16px;">A <strong>VRASHOWS</strong> é esse parceiro operacional.</p>`,
    ].filter(Boolean).join("\n");

  } else if (area.includes("partnerships")) {
    introText = [
      `Olá ${firstName},`,
      "",
      companyCtx ? `${companyCtx}\n` : "",
      `Grandes marcas não participam de eventos como o Futurecom apenas com um stand — ativar um ecossistema de parceiros enterprise nessa escala requer uma operação bastidores absolutamente confiável e invisível para quem está no palco.`,
      "",
      `A VRASHOWS é esse parceiro operacional.`,
    ].join("\n").replace("\n\n\n", "\n\n");

    introHtml = [
      `<p style="margin:0 0 18px;font-size:15px;">Olá ${firstName},</p>`,
      companyCtx ? `<p style="margin:0 0 16px;">${companyCtx}</p>` : "",
      `<p style="margin:0 0 16px;">Grandes marcas não participam de eventos como o Futurecom apenas com um stand — ativar um ecossistema de parceiros enterprise nessa escala requer uma operação bastidores absolutamente confiável e invisível para quem está no palco.</p>`,
      `<p style="margin:0 0 16px;">A <strong>VRASHOWS</strong> é esse parceiro operacional.</p>`,
    ].filter(Boolean).join("\n");

  } else {
    introText = [
      `Olá ${firstName},`,
      "",
      companyCtx ? `${companyCtx}\n` : "",
      `Grandes marcas não participam de eventos como o Futurecom apenas com um stand — existe toda uma operação estratégica por trás da experiência, logística e presença da marca no evento.`,
      "",
      `É exatamente nesse ponto que a VRASHOWS atua.`,
    ].join("\n").replace("\n\n\n", "\n\n");

    introHtml = [
      `<p style="margin:0 0 18px;font-size:15px;">Olá ${firstName},</p>`,
      companyCtx ? `<p style="margin:0 0 16px;">${companyCtx}</p>` : "",
      `<p style="margin:0 0 16px;">Grandes marcas não participam de eventos como o Futurecom apenas com um stand — existe toda uma operação estratégica por trás da experiência, logística e presença da marca no evento.</p>`,
      `<p style="margin:0 0 16px;">É exatamente nesse ponto que a <strong>VRASHOWS</strong> atua.</p>`,
    ].filter(Boolean).join("\n");
  }

  return { text: introText, html: introHtml };
}

// ─── Hub positioning block — v3.0 ────────────────────────────────────────────

const HUB_BLOCK_TEXT = `Somos especializados em operação completa para feiras de negócios e eventos enterprise, centralizando em um único parceiro tudo o que normalmente exige múltiplos fornecedores e uma grande carga operacional da equipe interna.

Cuidamos de toda a estrutura operacional para que sua equipe possa focar exclusivamente em relacionamento, networking e geração de negócios durante o evento.

Entre as soluções que entregamos:
• operação de stands e ativações
• vans executivas e transfers corporativos
• logística de brindes, alimentos e bebidas
• vans de carga e suporte operacional
• recepcionistas e modelos
• segurança
• fotógrafos e videomakers
• suporte operacional completo durante o evento
• coordenação e execução ponta a ponta

Nosso objetivo é transformar a participação da marca em eventos em uma operação organizada, eficiente e sem improvisos.`;

const HUB_BLOCK_HTML = `<p style="margin:0 0 16px;">Somos especializados em operação completa para feiras de negócios e eventos enterprise, centralizando em um único parceiro tudo o que normalmente exige múltiplos fornecedores e uma grande carga operacional da equipe interna.</p>
<p style="margin:0 0 16px;">Cuidamos de toda a estrutura operacional para que sua equipe possa focar exclusivamente em relacionamento, networking e geração de negócios durante o evento.</p>
<p style="margin:0 0 10px;">Entre as soluções que entregamos:</p>
<table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;">
  <tr><td style="padding:3px 0;color:#1e293b;font-size:15px;">&#8226;&nbsp; operação de stands e ativações</td></tr>
  <tr><td style="padding:3px 0;color:#1e293b;font-size:15px;">&#8226;&nbsp; vans executivas e transfers corporativos</td></tr>
  <tr><td style="padding:3px 0;color:#1e293b;font-size:15px;">&#8226;&nbsp; logística de brindes, alimentos e bebidas</td></tr>
  <tr><td style="padding:3px 0;color:#1e293b;font-size:15px;">&#8226;&nbsp; vans de carga e suporte operacional</td></tr>
  <tr><td style="padding:3px 0;color:#1e293b;font-size:15px;">&#8226;&nbsp; recepcionistas e modelos</td></tr>
  <tr><td style="padding:3px 0;color:#1e293b;font-size:15px;">&#8226;&nbsp; segurança</td></tr>
  <tr><td style="padding:3px 0;color:#1e293b;font-size:15px;">&#8226;&nbsp; fotógrafos e videomakers</td></tr>
  <tr><td style="padding:3px 0;color:#1e293b;font-size:15px;">&#8226;&nbsp; suporte operacional completo durante o evento</td></tr>
  <tr><td style="padding:3px 0;color:#1e293b;font-size:15px;">&#8226;&nbsp; coordenação e execução ponta a ponta</td></tr>
</table>
<p style="margin:0 0 16px;">Nosso objetivo é transformar a participação da marca em eventos em uma operação organizada, eficiente e sem improvisos.</p>`;

// C-level gets a condensed hub block
const HUB_BLOCK_SHORT_TEXT = `Somos especializados em operação completa para eventos enterprise — centralizando em um único parceiro: stands, transfers executivos, logística, staff, segurança e coordenação ponta a ponta. Para que a liderança foque 100% em negócios e relacionamento.`;

const HUB_BLOCK_SHORT_HTML = `<p style="margin:0 0 16px;">Somos especializados em operação completa para eventos enterprise — centralizando em um único parceiro: stands, transfers executivos, logística, staff, segurança e coordenação ponta a ponta. Para que a liderança foque 100% em negócios e relacionamento.</p>`;

// ─── ABRINT case block ────────────────────────────────────────────────────────

const ABRINT_TEXT = `Na ABRINT 2026, atuamos ao lado da Brasil TecPar conduzindo toda a operação do evento com foco em fluidez operacional, experiência do público e suporte integral à equipe da marca — reduzindo ruído operacional e permitindo total foco em networking e geração de negócios.`;

const ABRINT_HTML = `<p style="margin:0 0 16px;">Na <strong>ABRINT 2026</strong>, atuamos ao lado da <strong>Brasil TecPar</strong> conduzindo toda a operação do evento com foco em fluidez operacional, experiência do público e suporte integral à equipe da marca — reduzindo ruído operacional e permitindo total foco em networking e geração de negócios.</p>`;

// ─── Attachment + media kit block — v3.0 ─────────────────────────────────────

const ATTACHMENT_TEXT = `Anexei nosso material institucional para que você possa conhecer melhor a estrutura da VRASHOWS, nossa abordagem operacional e como apoiamos marcas em eventos B2B de alta complexidade.

Acredito que o material pode trazer insights interessantes para futuras operações e ativações da sua empresa em eventos corporativos.

Também deixo nosso site para uma visão mais ampla das soluções:
www.vrashows.com.br`;

const ATTACHMENT_HTML = `<p style="margin:0 0 16px;">Anexei nosso material institucional para que você possa conhecer melhor a estrutura da <strong>VRASHOWS</strong>, nossa abordagem operacional e como apoiamos marcas em eventos B2B de alta complexidade.</p>
<p style="margin:0 0 16px;">Acredito que o material pode trazer insights interessantes para futuras operações e ativações da sua empresa em eventos corporativos.</p>
<p style="margin:0 0 16px;">Também deixo nosso site para uma visão mais ampla das soluções: <a href="https://www.vrashows.com.br" style="color:#0f172a;font-weight:600;">www.vrashows.com.br</a></p>`;

// ─── Signature ────────────────────────────────────────────────────────────────

const PLAIN_TEXT_SIGNATURE = `--
VRASHOWS
Operações & Experiência Corporativa · VRASHOWS
samir.ricardo@vrashows.com.br | www.vrashows.com.br
Whatsapp (11) 95357-7804`;

// ─── CTA ─────────────────────────────────────────────────────────────────────

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

  // ── Plain text assembly — v3.0 template
  const bodyTextParts = [
    intro.text,
    "",
    hubText,
    "",
    ...(lead.useCaseABRINT ? [ABRINT_TEXT, ""] : []),
    ATTACHMENT_TEXT,
    "",
    cta.text,
    "",
    PLAIN_TEXT_SIGNATURE,
  ];
  const bodyText = bodyTextParts.join("\n").replace(/\n{3,}/g, "\n\n").trim();

  // ── HTML assembly — v3.0 template
  const bodyHtmlParts = [
    intro.html,
    hubHtml,
    ...(lead.useCaseABRINT ? [ABRINT_HTML] : []),
    ATTACHMENT_HTML,
    cta.html,
  ];
  const bodyHtml = bodyHtmlParts.filter(Boolean).join("\n");

  const quality = scoreEmailQuality(subject, bodyText, bodyHtml);

  return { subject, bodyText, bodyHtml, firstName, quality };
}
