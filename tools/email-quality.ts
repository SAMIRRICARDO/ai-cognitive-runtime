/**
 * email-quality.ts — Outreach Quality Scoring for VRASHOWS
 *
 * Evaluates email content before send on four axes:
 *   - Enterprise tone
 *   - Spamminess (lower is better)
 *   - Personalization depth
 *   - Structural completeness
 *
 * Designed to catch low-quality sends before they damage domain reputation.
 */

export interface OutreachQualityReport {
  /** Overall quality 0-100 (>= 70 = send, 50-69 = review, < 50 = rewrite) */
  score: number;
  /** How executive/consultive the tone is (0-100) */
  enterpriseToneScore: number;
  /** Spamminess — lower is better (0-100, should be < 25) */
  spamminessScore: number;
  /** Personalization depth (0-100) */
  personalizationScore: number;
  /** Structural completeness (0-100) */
  structureScore: number;
  /** Actionable issues found */
  issues: string[];
  /** Suggestions for improvement */
  recommendations: string[];
  /** Pass/review/rewrite decision */
  decision: "send" | "review" | "rewrite";
}

// ─── Signal definitions ───────────────────────────────────────────────────────

const SPAM_SIGNALS: [RegExp, number, string][] = [
  [/adoraria\s+conversar|adoraria\s+conectar/i,       15, 'Evitar "adoraria conversar" — soa como template genérico'],
  [/I'd love to|feel free to reach out/i,             15, 'Usar português corporativo — sem anglicismos informais'],
  [/última\s+chance|só\s+essa\s+semana|oferta\s+especial/i, 20, 'Urgência explícita reduz credibilidade enterprise'],
  [/clique\s+aqui|click\s+here/i,                     10, '"Clique aqui" — soa como newsletter, usar link contextual'],
  [/promoção|desconto|preço\s+especial/i,             20, 'Menção a preço/promoção — contra posicionamento premium'],
  [/prezado\(a\)|prezados/i,                          12, '"Prezado(a)" genérico — usar primeiro nome do contato'],
  [/staff\s+de\s+eventos|agência\s+de\s+staff/i,     15, '"Staff" como proposta principal — usar "operação integrada"'],
  [/terceiriz|outsourc/i,                             20, '"Terceirização" — contra posicionamento VRASHOWS'],
  [/prestação\s+de\s+serviço/i,                       15, '"Prestação de serviço" — usar "parceria estratégica"'],
];

const ENTERPRISE_SIGNALS: [RegExp, number][] = [
  [/hub\s+de\s+soluções\s+integradas/i,              15],
  [/controle\s+operacional|operação\s+integrada/i,   12],
  [/enquanto\s+você\s+fecha\s+negócios/i,            15],
  [/execução\s+sem\s+improvisos/i,                   10],
  [/ruído\s+operacional/i,                           10],
  [/experiência\s+(de\s+marca|premium|do\s+visitante)/i, 10],
  [/suporte\s+360/i,                                  8],
  [/abrint\s+2026|brasil\s+tecpar/i,                  8],
  [/parceria\s+estratégica|parceiro\s+estratégico/i,  8],
];

const PERSONALIZATION_SIGNALS: [RegExp, number][] = [
  [/^olá\s+[a-záàâãéêíóôõúç]+,/im,                 30], // "Olá Rachel,"
  [/latam|brasil\s+tecpar|futurecom/i,               15],
  [/abrint\s+2026/i,                                 12],
  [/aws|amazon|claro|vivo|huawei/i,                   8], // company mention
  [/evento|feira|ativação|congressos/i,               8],
];

const STRUCTURE_SIGNALS: [RegExp, number][] = [
  [/material\s+institucional|em\s+anexo/i,           15], // PDF mention
  [/conversa\s+breve|20\s+minutos|conversar\b/i,     15], // CTA
  [/\bvrashows\b/i,                                  10], // brand present
  [/https?:\/\/vrashows\.com\.br/i,                  10], // link present
];

// ─── Scorer ───────────────────────────────────────────────────────────────────

export function scoreEmailQuality(
  subject: string,
  bodyText: string,
  bodyHtml?: string,
): OutreachQualityReport {
  const content = `${subject}\n${bodyText}\n${bodyHtml ?? ""}`;
  const issues: string[] = [];
  const recommendations: string[] = [];

  // ── Spamminess (lower is better)
  let spamScore = 0;
  for (const [pattern, weight, issue] of SPAM_SIGNALS) {
    if (pattern.test(content)) {
      spamScore += weight;
      issues.push(issue);
    }
  }
  spamScore = Math.min(100, spamScore);

  // ── Enterprise tone
  let enterpriseRaw = 0;
  for (const [pattern, weight] of ENTERPRISE_SIGNALS) {
    if (pattern.test(content)) enterpriseRaw += weight;
  }
  const enterpriseToneScore = Math.min(100, enterpriseRaw);

  // ── Personalization
  let personRaw = 0;
  for (const [pattern, weight] of PERSONALIZATION_SIGNALS) {
    if (pattern.test(content)) personRaw += weight;
  }
  const personalizationScore = Math.min(100, personRaw);

  // ── Structure
  let structureRaw = 0;
  for (const [pattern, weight] of STRUCTURE_SIGNALS) {
    if (pattern.test(content)) structureRaw += weight;
  }

  // Word count check
  const wordCount = bodyText.split(/\s+/).length;
  if (wordCount < 80)  { structureRaw -= 15; issues.push(`Email muito curto (${wordCount} palavras) — mínimo recomendado: 80`); }
  if (wordCount > 350) { structureRaw -= 10; recommendations.push(`Email longo (${wordCount} palavras) — considerar versão mais concisa para C-level`); }
  const structureScore = Math.min(100, Math.max(0, structureRaw + 50)); // base 50 for structure

  // ── Composite score
  const score = Math.round(
    enterpriseToneScore * 0.30 +
    (100 - spamScore)  * 0.35 +
    personalizationScore * 0.20 +
    structureScore     * 0.15
  );

  // ── Recommendations
  if (enterpriseToneScore < 40) recommendations.push("Adicionar tagline VRASHOWS: 'Enquanto você fecha negócios, nós controlamos a operação'");
  if (personalizationScore < 30) recommendations.push("Usar primeiro nome do destinatário na saudação: 'Olá [Nome],'");
  if (!content.match(/abrint|brasil\s+tecpar/i)) recommendations.push("Considerar mencionar o case ABRINT 2026 — Brasil TecPar como credencial");
  if (!content.match(/em\s+anexo|material\s+institucional/i)) recommendations.push("Mencionar o material institucional em anexo");

  const decision: OutreachQualityReport["decision"] =
    score >= 70 ? "send" :
    score >= 50 ? "review" :
    "rewrite";

  return {
    score,
    enterpriseToneScore,
    spamminessScore: spamScore,
    personalizationScore,
    structureScore,
    issues,
    recommendations,
    decision,
  };
}
