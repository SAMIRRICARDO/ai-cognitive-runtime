#!/usr/bin/env tsx
/**
 * lead-validation-worker.ts — valida leads Futurecom e salva top 5.
 *
 * Fonte:
 *   data/leads/futurecom/companies-seed.json
 *
 * Saída:
 *   data/leads/futurecom/validated-top5.json
 *
 * Regras:
 *   - eventFitScore >= 70
 *   - cargos marketing/eventos/brand/experience/partnerships/field marketing
 *   - máximo 5 leads selecionados
 *   - sem scraping pesado, operação local leve
 */
import { readFile, writeFile, mkdir } from "fs/promises";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SOURCE_PATH = resolve(ROOT, "data/leads/futurecom/companies-seed.json");
const OUT_DIR = resolve(ROOT, "data/leads/futurecom");
const VALIDATED_PATH = resolve(OUT_DIR, "validated-top5.json");
const REPORT_DIR = resolve(ROOT, "logs/leads");

const TARGET_ROLE_REGEX = /marketing|eventos?|brand|experience|partnerships?|partnership|field marketing/i;
const MIN_EVENT_FIT_SCORE = 70;
const MAX_TOP_LEADS = 5;

interface SeedContact {
  name: string;
  role: string;
  area: string;
  seniority: string;
  linkedin?: string;
}

interface SeedCompany {
  company: string;
  website: string;
  segment: string;
  boothComplexity: string;
  budgetPotential: string;
  eventFitScore: number;
  events: string[];
  strategicNotes: string;
  contacts: SeedContact[];
}

interface SeedFile {
  _meta: { description: string; updatedAt: string; version: string };
  companies: SeedCompany[];
}

interface ValidatedLead {
  company: string;
  website: string;
  segment: string;
  eventFitScore: number;
  contactName: string;
  role: string;
  area: string;
  seniority: string;
  linkedin: string;
  validationReason: string;
}

function roleMatches(contact: SeedContact) {
  return TARGET_ROLE_REGEX.test(contact.role) || TARGET_ROLE_REGEX.test(contact.area);
}

function scoreLead(lead: ValidatedLead) {
  const seniorityScore = lead.seniority.toLowerCase().includes("director") ? 30 : lead.seniority.toLowerCase().includes("manager") ? 20 : lead.seniority.toLowerCase().includes("vp") || lead.seniority.toLowerCase().includes("c-level") ? 40 : 10;
  return lead.eventFitScore * 4 + seniorityScore + (TARGET_ROLE_REGEX.test(lead.role) ? 20 : 0);
}

async function loadSeed(): Promise<SeedFile> {
  const raw = await readFile(SOURCE_PATH, "utf8");
  return JSON.parse(raw) as SeedFile;
}

function buildValidatedLeads(seed: SeedFile) {
  const validated: ValidatedLead[] = [];

  for (const company of seed.companies) {
    if (company.eventFitScore < MIN_EVENT_FIT_SCORE) continue;
    for (const contact of company.contacts) {
      if (!roleMatches(contact)) continue;
      if (!contact.seniority || contact.seniority.toLowerCase() === "analyst") continue;

      validated.push({
        company: company.company,
        website: company.website,
        segment: company.segment,
        eventFitScore: company.eventFitScore,
        contactName: contact.name,
        role: contact.role,
        area: contact.area,
        seniority: contact.seniority,
        linkedin: contact.linkedin ?? "",
        validationReason: `eventFitScore ${company.eventFitScore}, cargo ${contact.role}, área ${contact.area}`,
      });
    }
  }

  return validated;
}

function pickTopLeads(leads: ValidatedLead[]) {
  return leads
    .sort((a, b) => scoreLead(b) - scoreLead(a))
    .slice(0, MAX_TOP_LEADS);
}

async function saveResults(leads: ValidatedLead[]) {
  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(REPORT_DIR, { recursive: true });

  const result = {
    generatedAt: new Date().toISOString(),
    source: SOURCE_PATH,
    criteria: {
      minEventFitScore: MIN_EVENT_FIT_SCORE,
      targetRoles: ["marketing", "eventos", "brand", "experience", "partnerships", "field marketing"],
      maxLeads: MAX_TOP_LEADS,
    },
    selectedLeads: leads,
  };

  const report = {
    createdAt: result.generatedAt,
    selectedCount: leads.length,
    criteria: result.criteria,
    outputFile: VALIDATED_PATH,
  };

  await writeFile(VALIDATED_PATH, JSON.stringify(result, null, 2), "utf8");
  await writeFile(resolve(REPORT_DIR, `lead-validation-worker-${Date.now()}.json`), JSON.stringify(report, null, 2), "utf8");
}

async function main() {
  const seed = await loadSeed();
  const validated = buildValidatedLeads(seed);
  if (validated.length === 0) {
    console.log("[lead-validation-worker] Nenhum lead válido encontrado. Verifique o seed ou as regras de filtragem.");
    process.exit(0);
  }

  const topLeads = pickTopLeads(validated);
  await saveResults(topLeads);
  console.log(`[lead-validation-worker] Salvo ${topLeads.length} leads em ${VALIDATED_PATH}`);
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
