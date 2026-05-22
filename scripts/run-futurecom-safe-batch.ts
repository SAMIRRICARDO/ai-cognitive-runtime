#!/usr/bin/env tsx
/**
 * Futurecom Safe Batch — valida empresas da Futurecom e prepara lote seguro.
 *
 * Leitura:
 *   data/leads/futurecom/companies-seed.json
 *
 * Saída:
 *   data/leads/futurecom/validated-top5.json
 *   data/leads/futurecom/safe-outbound-batch.json
 *
 * Regras:
 *   - top 5 leads
 *   - eventFitScore >= 70
 *   - cargos marketing/eventos/brand/experience/partnerships/field marketing
 *   - máximo 5 emails
 *   - BCC: configured via OUTBOUND_BCC_EMAIL env var
 */

import { mkdirSync } from "fs";
import { readFile, writeFile } from "fs/promises";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

import type { SeedFile, SeedCompany, SeedContact } from "../agents/lead-sourcing/types.js";
import { emailPatternResolver } from "../agents/lead-enrichment-agent/email-resolver.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SOURCE_PATH = resolve(ROOT, "data/leads/futurecom/companies-seed.json");
const OUT_DIR = resolve(ROOT, "data/leads/futurecom");
const VALIDATED_PATH = resolve(OUT_DIR, "validated-top5.json");
const BATCH_PATH = resolve(OUT_DIR, "safe-outbound-batch.json");
const BCC_EMAIL = process.env.OUTBOUND_BCC_EMAIL ?? undefined;

const TARGET_ROLE_REGEX = /marketing|eventos?|brand|experience|partnerships?|partnership|field marketing/i;
const TOP_EMAIL_PATTERNS = ["firstname.lastname", "flastname", "firstname"];
const MIN_EVENT_FIT_SCORE = 70;
const MAX_BATCH_SIZE = 5;

const SENIORITY_WEIGHT: Record<string, number> = {
  "c-level": 100,
  director: 80,
  manager: 60,
  analyst: 30,
};

const CONFIDENCE_WEIGHT: Record<string, number> = {
  high: 30,
  medium: 15,
  low: 0,
};

interface ValidatedLead {
  company: string;
  website: string;
  segment: string;
  eventFitScore: number;
  boothComplexity: string;
  budgetPotential: string;
  events: string[];
  strategicNotes: string;
  contactName: string;
  role: string;
  area: string;
  seniority: string;
  linkedin: string;
  domain: string;
  emailPattern: string;
  probableEmail: string;
  confidenceScore: "HIGH" | "MEDIUM" | "LOW";
  validationNotes: string;
  classification: "HIGH" | "MEDIUM" | "LOW";
  emailVariants: Array<{ email: string; pattern: string; confidence: string }>;
}

interface SafeBatch {
  campaign: string;
  createdAt: string;
  source: string;
  maxRecipients: number;
  bcc: string | null;
  criteria: {
    minEventFitScore: number;
    allowedRoles: string[];
    maxBatchSize: number;
  };
  instructions: string;
  recipients: ValidatedLead[];
  summary: {
    totalRecipients: number;
    high: number;
    medium: number;
    low: number;
  };
}

function normalizeText(value: string) {
  return value.trim().toLowerCase();
}

function roleMatches(role: string, area: string) {
  return TARGET_ROLE_REGEX.test(role) || TARGET_ROLE_REGEX.test(area);
}

function chooseProbableEmail(guesses: Array<{ email: string; pattern: string; confidence: string }>) {
  for (const pattern of TOP_EMAIL_PATTERNS) {
    const candidate = guesses.find((g) => g.pattern === pattern);
    if (candidate) return candidate;
  }
  return guesses[0];
}

function classifyLead(lead: ValidatedLead) {
  if (lead.confidenceScore === "HIGH" && lead.eventFitScore >= 80 && lead.seniority !== "analyst") {
    return "HIGH" as const;
  }
  if (lead.confidenceScore !== "LOW" && lead.eventFitScore >= 75) {
    return "MEDIUM" as const;
  }
  return "LOW" as const;
}

function buildValidationNotes(company: SeedCompany, contact: SeedContact, emailResult: ReturnType<typeof emailPatternResolver.resolve>, classification: string) {
  const notes = [
    `Dominio corporativo: ${emailResult.domain} (${emailResult.domainSource}, pattern ${emailResult.pattern}).`,
    `Cargo: ${contact.role} — senioridade ${contact.seniority}.`,
    `Alinhamento enterprise: segmento ${company.segment}, budget ${company.budgetPotential}, eventFitScore ${company.eventFitScore}.`,
    `Presença em eventos/stands: ${company.events.join(", ")} — stand ${company.boothComplexity}.`,
    `Classificação preliminar: ${classification}.`,
  ];
  return notes.join(" ");
}

async function loadSeed(): Promise<SeedFile> {
  const raw = await readFile(SOURCE_PATH, "utf8");
  return JSON.parse(raw) as SeedFile;
}

function buildLeadRecords(seed: SeedFile) {
  const leads: ValidatedLead[] = [];

  for (const company of seed.companies) {
    if (company.eventFitScore < MIN_EVENT_FIT_SCORE) continue;

    for (const contact of company.contacts) {
      if (!roleMatches(contact.role, contact.area)) continue;
      if (!contact.seniority || contact.seniority.toLowerCase() === "analyst") continue;

      const emailResult = emailPatternResolver.resolve({
        name: contact.name,
        company: company.company,
        website: company.website,
      });

      const candidate = chooseProbableEmail(emailResult.guessedEmails);
      const confidenceScore = emailResult.confidence === "high" ? "HIGH" : emailResult.confidence === "medium" ? "MEDIUM" : "LOW";
      const classification = classifyLead({
        company: company.company,
        website: company.website,
        segment: company.segment,
        eventFitScore: company.eventFitScore,
        boothComplexity: company.boothComplexity,
        budgetPotential: company.budgetPotential,
        events: company.events,
        strategicNotes: company.strategicNotes,
        contactName: contact.name,
        role: contact.role,
        area: contact.area,
        seniority: contact.seniority,
        linkedin: contact.linkedin ?? "unknown",
        domain: emailResult.domain,
        emailPattern: candidate.pattern,
        probableEmail: candidate.email,
        confidenceScore,
        validationNotes: "",
        classification: "LOW",
        emailVariants: emailResult.guessedEmails.map((g) => ({ email: g.email, pattern: g.pattern, confidence: g.confidence })),
      });

      const lead: ValidatedLead = {
        company: company.company,
        website: company.website,
        segment: company.segment,
        eventFitScore: company.eventFitScore,
        boothComplexity: company.boothComplexity,
        budgetPotential: company.budgetPotential,
        events: company.events,
        strategicNotes: company.strategicNotes,
        contactName: contact.name,
        role: contact.role,
        area: contact.area,
        seniority: contact.seniority,
        linkedin: contact.linkedin ?? "unknown",
        domain: emailResult.domain,
        emailPattern: candidate.pattern,
        probableEmail: candidate.email,
        confidenceScore,
        validationNotes: "",
        classification: "LOW",
        emailVariants: emailResult.guessedEmails.map((g) => ({ email: g.email, pattern: g.pattern, confidence: g.confidence })),
      };

      lead.classification = classifyLead(lead);
      lead.validationNotes = buildValidationNotes(company, contact, emailResult, lead.classification);

      leads.push(lead);
    }
  }

  return leads;
}

function scoreLeadForSorting(lead: ValidatedLead) {
  return (
    lead.eventFitScore * 3 +
    SENIORITY_WEIGHT[lead.seniority.toLowerCase()] +
    CONFIDENCE_WEIGHT[lead.confidenceScore.toLowerCase()] +
    (TARGET_ROLE_REGEX.test(lead.role) ? 20 : 0)
  );
}

function selectTop5(leads: ValidatedLead[]) {
  const byCompany = new Map<string, ValidatedLead>();
  const sorted = [...leads].sort((a, b) => scoreLeadForSorting(b) - scoreLeadForSorting(a));

  for (const lead of sorted) {
    if (byCompany.has(lead.company)) continue;
    byCompany.set(lead.company, lead);
    if (byCompany.size >= MAX_BATCH_SIZE) break;
  }

  return Array.from(byCompany.values());
}

async function saveOutputs(topLeads: ValidatedLead[]) {
  mkdirSync(OUT_DIR, { recursive: true });

  const validatedData = {
    generatedAt: new Date().toISOString(),
    source: SOURCE_PATH,
    selectedLeads: topLeads,
  };

  const batchData: SafeBatch = {
    campaign: "VRASHOWS Futurecom Safe Outbound Batch",
    createdAt: new Date().toISOString(),
    source: SOURCE_PATH,
    maxRecipients: MAX_BATCH_SIZE,
    bcc: BCC_EMAIL ?? null,
    criteria: {
      minEventFitScore: MIN_EVENT_FIT_SCORE,
      allowedRoles: ["marketing", "events", "brand", "experience", "partnerships", "field marketing"],
      maxBatchSize: MAX_BATCH_SIZE,
    },
    instructions:
      "Este é um lote seguro preparado para revisão manual. Não enviar automaticamente. Priorizar 1 email por dia, evitar disparos em burst, incluir BCC configurado via OUTBOUND_BCC_EMAIL.",
    recipients: topLeads,
    summary: {
      totalRecipients: topLeads.length,
      high: topLeads.filter((l) => l.classification === "HIGH").length,
      medium: topLeads.filter((l) => l.classification === "MEDIUM").length,
      low: topLeads.filter((l) => l.classification === "LOW").length,
    },
  };

  await writeFile(VALIDATED_PATH, JSON.stringify(validatedData, null, 2), "utf8");
  await writeFile(BATCH_PATH, JSON.stringify(batchData, null, 2), "utf8");
}

async function main() {
  const seed = await loadSeed();
  const leads = buildLeadRecords(seed);
  if (leads.length === 0) {
    throw new Error("Nenhum lead válido foi encontrado no seed. Revise os critérios de filtragem.");
  }

  const top5 = selectTop5(leads);
  if (top5.length === 0) {
    throw new Error("Nenhum lead top5 foi selecionado. Revise os critérios de filtragem.");
  }

  await saveOutputs(top5);

  console.log(`Saved validated top 5 leads to ${VALIDATED_PATH}`);
  console.log(`Saved safe outbound batch to ${BATCH_PATH}`);
}

await main();
