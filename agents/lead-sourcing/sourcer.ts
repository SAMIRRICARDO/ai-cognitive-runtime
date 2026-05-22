/**
 * lead-sourcing/sourcer.ts — Deterministic lead sourcer for VRASHOWS.
 *
 * Converts the companies-seed.json into a RawLeadFile by resolving email
 * patterns via EmailPatternResolver. Zero LLM / API calls required.
 *
 * For web-augmented sourcing (new companies via web search), see the
 * FuturecomResearcherAgent + LeadEnrichmentAgent pipeline.
 */

import type { SeedFile, SeedCompany, SeedContact } from "./types.js";
import type { RawLeadFile, RawLead } from "../lead-validation/types.js";
import { emailPatternResolver } from "../lead-enrichment-agent/email-resolver.js";

// ─── Event fit → rationale ────────────────────────────────────────────────────

function buildRationale(company: SeedCompany, contact: SeedContact): string {
  const eventList = company.events.slice(0, 3).join(", ");
  const boothDesc = {
    standard: "stand padrão",
    custom: "stand customizado",
    large: "stand de grande porte",
    mega: "stand mega/multi-andar",
  }[company.boothComplexity];

  return [
    `${company.strategicNotes}`,
    `Participa de: ${eventList}.`,
    `Operação estimada: ${boothDesc}, potencial de budget ${company.budgetPotential}.`,
    `Role: ${contact.role} — decisor relevante para operação de eventos e experiência de marca.`,
  ].join(" ");
}

// ─── Score estimation from seed metadata ──────────────────────────────────────

function estimatePriorityScore(company: SeedCompany): number {
  const budgetWeight = { medium: 60, high: 75, enterprise: 90 }[company.budgetPotential];
  const boothWeight  = { standard: 0, custom: 5, large: 10, mega: 15 }[company.boothComplexity];
  return Math.min(100, Math.round((company.eventFitScore * 0.7 + budgetWeight * 0.3) + boothWeight));
}

// ─── Main converter ───────────────────────────────────────────────────────────

export function seedToRawLeadFile(
  seed: SeedFile,
  campaign: string,
  targetEvent: string,
  opts: { excludeCompanies?: Set<string> } = {}
): RawLeadFile {
  const leads: RawLead[] = [];

  for (const company of seed.companies) {
    if (opts.excludeCompanies?.has(company.company.toLowerCase())) continue;

    for (const contact of company.contacts) {
      const emailResult = emailPatternResolver.resolve({
        name: contact.name,
        company: company.company,
        website: company.website,
      });

      const lead: RawLead = {
        company: company.company,
        contactName: contact.name,
        role: contact.role,
        area: contact.area,
        seniority: contact.seniority,
        linkedin: contact.linkedin ?? "unknown",
        guessedEmails: emailResult.guessedEmails,
        confidence: emailResult.confidence,
        priority: company.eventFitScore >= 85 ? "high" : company.eventFitScore >= 75 ? "medium" : "low",
        priorityScore: estimatePriorityScore(company),
        outreachStatus: "pending",
        rationale: buildRationale(company, contact),
        notes: company.events.join(", "),
      };

      leads.push(lead);
    }
  }

  return {
    campaign,
    targetEvent,
    enrichedAt: new Date().toISOString().split("T")[0]!,
    leads,
  };
}

// ─── Deduplication helpers ────────────────────────────────────────────────────

export function buildExistingEmailSet(existingLeadFiles: RawLeadFile[]): Set<string> {
  const emails = new Set<string>();
  for (const file of existingLeadFiles) {
    for (const lead of file.leads) {
      for (const ge of lead.guessedEmails) {
        emails.add(ge.email.toLowerCase());
      }
    }
  }
  return emails;
}

export function deduplicateLeads(
  rawFile: RawLeadFile,
  existingEmails: Set<string>
): RawLeadFile {
  const deduped = rawFile.leads.filter(
    (l) => !l.guessedEmails.some((ge) => existingEmails.has(ge.email.toLowerCase()))
  );
  return { ...rawFile, leads: deduped };
}
