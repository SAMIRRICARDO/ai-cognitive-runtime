/**
 * Lead Validation Scorer — VRASHOWS Enterprise Outbound Pipeline.
 *
 * Pure deterministic scoring — no LLM required.
 * All logic is explicit and auditable.
 *
 * Scoring axes:
 *   1. Relevance Score     — decision-making power for events/marketing
 *   2. Strategic Fit Score — company alignment with VRASHOWS profile
 *   3. Bounce Risk         — email reliability
 *   4. Outreach Priority   — weighted composite for sending order
 *   5. Classification      — HOT / WARM / LOW_PRIORITY / INVALID
 */

import type {
  RawLead,
  ValidatedLead,
  BounceRisk,
  StrategicFit,
  LeadStatus,
  RecommendedTemplate,
} from "./types.js";

// ─── Relevance scoring ────────────────────────────────────────────────────────

/**
 * Score 0-100: how much decision-making power does this person have
 * over corporate event operations and brand experience for VRASHOWS?
 */
function scoreRelevance(lead: RawLead): number {
  let base = 0;

  // Area scoring
  const area = lead.area.toLowerCase();
  if (area.includes("marketing") || area.includes("events") || area.includes("brand"))     base += 45;
  else if (area.includes("sponsorship") || area.includes("customer-experience"))           base += 35;
  else if (area.includes("communications") || area.includes("demand"))                    base += 30;
  else if (area.includes("partnerships") || area.includes("c-suite"))                     base += 25;
  else if (area.includes("enterprise-sales") || area.includes("sales"))                   base += 15;
  else                                                                                     base += 5;

  // Role keyword boost — accumulate multiple signals (cap at +40 from roles)
  const role = lead.role.toLowerCase();
  const BOOST_KEYWORDS: [RegExp, number][] = [
    // English — events decision makers
    [/events?\s+manager|event\s+program|events?\s+&\s+brand/i,       25],
    [/\bevents?\b/i,                                                  18],
    [/brand\s+experience|brand\s+manager/i,                          18],
    [/marketing\s+manager|head\s+of\s+marketing/i,                   15],
    [/partner\s+marketing|field\s+marketing/i,                       15],
    [/demand\s+generation/i,                                         12],
    [/country\s+manager|gm\s+brasil/i,                               10],
    [/head\s+of\s+partner|partner\s+development/i,                    8],
    [/account\s+manager/i,                                            5],
    // Portuguese — eventos/marketing/patrocínio decision makers
    [/gerente.*eventos|eventos.*gerente|coordenador[a]?\s+de\s+eventos/i, 25],
    [/\beventos?\b/i,                                                 18],
    [/brand\s+experience|experi[eê]ncia\s+de\s+marca/i,              18],
    [/gerente.*marketing|marketing.*gerente|head.*marketing/i,        15],
    [/patrocín|sponsorship/i,                                        20],
    [/gerente.*marca|marca.*gerente/i,                               12],
    [/country\s+manager|diretor.*pa[ií]s|pa[ií]s.*diretor/i,         10],
    // Negative signals (technical, non-events)
    [/solutions?\s+architect|technical/i,                            -15],
    [/engineer|developer|devops/i,                                   -25],
  ];
  let roleBoost = 0;
  for (const [pattern, delta] of BOOST_KEYWORDS) {
    if (pattern.test(role)) roleBoost += delta;
  }
  base += Math.min(40, Math.max(-30, roleBoost)); // cap contribution

  // Seniority multiplier
  const seniority = lead.seniority.toLowerCase();
  const seniorityMult =
    seniority === "c-level"   ? 1.0 :
    seniority === "director"  ? 0.95 :
    seniority === "manager"   ? 0.85 :
    seniority === "analyst"   ? 0.55 : 0.7;

  return Math.max(0, Math.min(100, Math.round(base * seniorityMult)));
}

// ─── Strategic fit scoring ────────────────────────────────────────────────────

/**
 * Score 0-100: how well does this company align with VRASHOWS profile?
 *
 * Criteria:
 *   - Participates in major enterprise events / trade shows
 *   - Corporate brand investment known
 *   - LATAM presence (Brazil focus)
 *   - Enterprise scale (brand recognition)
 */
function scoreStrategicFit(lead: RawLead): { score: number; fit: StrategicFit } {
  const company = lead.company.toLowerCase();

  // Company tier registry — known enterprise event spenders
  const TIER_1 = ["aws", "amazon", "microsoft", "google", "oracle", "salesforce", "sap"];
  const TIER_2 = ["claro", "vivo", "tim", "oi", "huawei", "cisco", "dell", "hp", "lenovo",
                  "ericsson", "nokia", "qualcomm", "intel", "ibm", "accenture"];
  const TIER_3 = ["telecom", "conectividade", "fintech", "startup"];

  let score = 0;
  let fit: StrategicFit = "moderate";

  if (TIER_1.some(t => company.includes(t))) {
    score = 90;
    fit = "excellent";
  } else if (TIER_2.some(t => company.includes(t))) {
    score = 75;
    fit = "strong";
  } else if (TIER_3.some(t => company.includes(t))) {
    score = 55;
    fit = "moderate";
  } else {
    score = 40;
    fit = "moderate";
  }

  // Known event participation signal from rationale + notes
  const rationale = (lead.rationale + " " + lead.notes).toLowerCase();
  if (rationale.includes("futurecom") || rationale.includes("feira") || rationale.includes("evento")) score += 5;
  if (rationale.includes("latam") || rationale.includes("brasil")) score += 5;
  if (rationale.includes("stand") || rationale.includes("ativação") || rationale.includes("ativacao")) score += 5;

  return { score: Math.min(100, score), fit };
}

// ─── Bounce risk scoring ──────────────────────────────────────────────────────

function scoreBounceRisk(lead: RawLead): BounceRisk {
  const topEmail = lead.guessedEmails[0];
  if (!topEmail) return "high";

  // Well-known corporate domains have predictable patterns
  const RELIABLE_DOMAINS = ["amazon.com", "amazon.com.br", "microsoft.com", "google.com",
    "claro.com.br", "vivo.com.br", "huawei.com", "cisco.com"];
  const domain = topEmail.email.split("@")[1] ?? "";
  const knownDomain = RELIABLE_DOMAINS.some(d => domain.endsWith(d));

  if (topEmail.confidence === "high" && knownDomain) return "low";
  if (topEmail.confidence === "high") return "low";
  if (topEmail.confidence === "medium" && knownDomain) return "medium";
  if (topEmail.confidence === "medium") return "medium";
  return "high";
}

// ─── Combined priority ────────────────────────────────────────────────────────

function computeOutreachPriority(
  relevance: number,
  strategicFit: number,
  bounceRisk: BounceRisk
): number {
  const riskPenalty = bounceRisk === "low" ? 0 : bounceRisk === "medium" ? 8 : 20;
  return Math.max(0, Math.min(100, Math.round(relevance * 0.55 + strategicFit * 0.35 - riskPenalty)));
}

// ─── Classification ───────────────────────────────────────────────────────────

function classify(
  relevance: number,
  priority: number,
  bounceRisk: BounceRisk,
  area: string
): LeadStatus {
  // INVALID: completely off-target (technical, no event authority)
  if (relevance < 15) return "INVALID";
  if (bounceRisk === "high" && relevance < 35) return "INVALID";

  // HOT: clear events/marketing decision maker + acceptable bounce risk
  if (relevance >= 60 && bounceRisk !== "high") return "HOT";
  if (relevance >= 55 && priority >= 65 && bounceRisk === "low") return "HOT";

  // WARM: solid fit, approaching threshold, or high-authority contacts
  if (relevance >= 32 && bounceRisk !== "high") return "WARM";
  if (priority >= 50 && bounceRisk === "low") return "WARM";

  // LOW_PRIORITY: some relevance but indirect authority
  if (relevance >= 15) return "LOW_PRIORITY";

  return "INVALID";
}

// ─── Outreach recommendations ─────────────────────────────────────────────────

function buildRecommendations(lead: RawLead, relevance: number): {
  template: RecommendedTemplate;
  approach: string;
  cta: string;
  useABRINT: boolean;
  personalization: "high" | "medium" | "standard";
} {
  const seniority = lead.seniority.toLowerCase();
  const area = lead.area.toLowerCase();

  // Template by seniority
  const template: RecommendedTemplate =
    seniority === "c-level" ? "executive-intro" :
    seniority === "director" ? "cold-outreach" :
    relevance >= 60 ? "cold-outreach" : "linkedin-message";

  // CTA by seniority
  const cta =
    seniority === "c-level"
      ? "Vale 20 minutos para alinharmos o que o evento exige operacionalmente?"
      : "Se fizer sentido para o momento da sua empresa, ficarei à disposição para uma conversa breve nos próximos dias.";

  // Approach by area
  const role = lead.role.toLowerCase();
  let approach = "";
  if (area.includes("marketing") || area.includes("events") || area.includes("brand")) {
    approach = "Frame around fluidez operacional e experiência do visitante — a operação que desaparece para que a ativação seja o centro de tudo.";
  } else if (area.includes("partnerships")) {
    approach = "Frame around suporte operacional a eventos de parceiros AWS — logística integrada para ativações de parceiros enterprise.";
  } else if (area === "c-suite" || seniority === "c-level") {
    approach = "Tom ultra-executivo, peer-to-peer. Foco em parceria estratégica de operação, não em serviços. Mencionar ABRINT 2026 como credencial operacional.";
  } else if (area.includes("enterprise-sales")) {
    approach = "Frame around suporte operacional a ativações de clientes enterprise — experiência do visitante como acelerador de negócio.";
  } else {
    approach = "Abordagem padrão cold outreach com foco em controle operacional integrado.";
  }

  // Use ABRINT case for contacts with enough relevance to appreciate it
  const useABRINT = relevance >= 45;

  // Personalization level
  const personalization: "high" | "medium" | "standard" =
    relevance >= 70 ? "high" :
    relevance >= 45 ? "medium" : "standard";

  return { template, approach, cta, useABRINT, personalization };
}

// ─── Main scorer ──────────────────────────────────────────────────────────────

export function scoreLead(
  lead: RawLead,
  campaignId: string,
  targetEvent: string
): ValidatedLead {
  const relevanceScore = scoreRelevance(lead);
  const { score: strategicFitScore, fit: strategicFit } = scoreStrategicFit(lead);
  const bounceRisk = scoreBounceRisk(lead);
  const outreachPriority = computeOutreachPriority(relevanceScore, strategicFitScore, bounceRisk);
  const status = classify(relevanceScore, outreachPriority, bounceRisk, lead.area);
  const recommendations = buildRecommendations(lead, relevanceScore);

  const primaryEmail = lead.guessedEmails[0]?.email ?? "unknown";

  return {
    // Identity
    company: lead.company,
    contactName: lead.contactName,
    role: lead.role,
    linkedin: lead.linkedin,
    area: lead.area,
    seniority: lead.seniority,

    // Email
    guessedEmails: lead.guessedEmails,
    primaryEmail,
    confidence: lead.confidence,
    bounceRisk,

    // Scores
    relevanceScore,
    strategicFitScore,
    outreachPriority,

    // Strategic
    strategicFit,
    rationale: lead.rationale,

    // Recommendations
    recommendedTemplate: recommendations.template,
    recommendedApproach: recommendations.approach,
    recommendedCTA: recommendations.cta,
    useCaseABRINT: recommendations.useABRINT,
    personalizationLevel: recommendations.personalization,

    // Classification
    status,

    // Metadata
    campaignId,
    targetEvent,
    validatedAt: new Date().toISOString(),
    originalPriorityScore: lead.priorityScore,
  };
}

export function scoreLeads(
  leads: RawLead[],
  campaignId: string,
  targetEvent: string
): ValidatedLead[] {
  return leads
    .map(l => scoreLead(l, campaignId, targetEvent))
    .sort((a, b) => b.outreachPriority - a.outreachPriority);
}
