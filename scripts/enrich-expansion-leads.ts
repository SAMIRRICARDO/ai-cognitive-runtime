#!/usr/bin/env tsx
/**
 * enrich-expansion-leads.ts — AI-powered contact enrichment for expansion batch
 *
 * Uses Claude Haiku (cheap mode) to generate a plausible decision-maker contact
 * for each company, then resolves email patterns via EmailPatternResolver.
 * Outputs a ValidatedLead file compatible with run-continuous-outbound.ts.
 *
 * Usage:
 *   tsx scripts/enrich-expansion-leads.ts
 *   tsx scripts/enrich-expansion-leads.ts --source data/leads/futurecom/futurecom-expansion-batch-01.json
 *   tsx scripts/enrich-expansion-leads.ts --dry-run   # show plan, no AI call
 */

import "dotenv/config";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import Anthropic from "@anthropic-ai/sdk";
import { emailPatternResolver } from "../agents/lead-enrichment-agent/email-resolver.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ─── CLI ───────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const val = (f: string) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : undefined; };

const SOURCE = val("--source") ?? "data/leads/futurecom/futurecom-expansion-batch-01.json";
const DRY_RUN = flag("--dry-run") || flag("--preview");
const BATCH_SIZE = Number(val("--batch") ?? "5"); // companies per AI call

// ─── Types ────────────────────────────────────────────────────────────────────

interface ExpansionCompany {
  company: string;
  website: string;
  segment: string;
  probableEventFit: string;
  probableBudgetLevel: string;
  strategicNotes: string;
  possibleEvents: string[];
  probableDepartments: string[];
  suggestedRoles: string[];
  eventFitScore: number;
  marketingMaturity: string;
  enterpriseScore: number;
}

interface AIContact {
  company: string;
  contactName: string;
  role: string;
  area: string;
  seniority: "c-level" | "director" | "manager";
  linkedin: string;
  rationale: string;
  recommendedApproach: string;
  recommendedCTA: string;
}

// ─── AI enrichment ────────────────────────────────────────────────────────────

const client = new Anthropic();
const MODEL = process.env.CHEAP_MODE === "true" || process.env.DEV_MODE === "true"
  ? "claude-haiku-4-5-20251001"
  : "claude-haiku-4-5-20251001"; // always Haiku for this task

async function generateContacts(companies: ExpansionCompany[]): Promise<AIContact[]> {
  const companiesJson = JSON.stringify(
    companies.map((c) => ({
      company: c.company,
      website: c.website,
      segment: c.segment,
      eventFit: c.probableEventFit,
      departments: c.probableDepartments,
      suggestedRoles: c.suggestedRoles,
      strategicNotes: c.strategicNotes.slice(0, 200),
    })),
    null, 2
  );

  const prompt = `You are a B2B lead enrichment specialist. Given these enterprise companies that are likely sponsors or participants of Futurecom 2026 (Brazil's largest telecom/tech event), generate ONE decision-maker contact per company.

COMPANIES:
${companiesJson}

RULES:
- Generate realistic Brazilian or LATAM professional names
- Use accented characters correctly (e.g., João, María, André, Fernanda)
- Pick the most relevant role from suggestedRoles for event/brand/marketing decisions
- LinkedIn URLs: use pattern linkedin.com/in/firstname-lastname (lowercase, hyphen-separated)
- rationale: 1 short sentence in PT-BR (max 20 words) — why this person for VRASHOWS event ops
- recommendedApproach: 1 short sentence in PT-BR — personalization angle
- recommendedCTA: max 8 words in PT-BR

RESPOND WITH ONLY A JSON ARRAY — no markdown, no explanation:
[
  {
    "company": "...",
    "contactName": "...",
    "role": "...",
    "area": "marketing" | "events" | "brand" | "partnerships",
    "seniority": "c-level" | "director" | "manager",
    "linkedin": "linkedin.com/in/...",
    "rationale": "...",
    "recommendedApproach": "...",
    "recommendedCTA": "..."
  }
]`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 3000,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content[0]?.type === "text" ? response.content[0].text : "";

  // Extract JSON array from response (handles markdown fences and leading text)
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (!arrayMatch) {
    console.error("[enrich] No JSON array found. Raw response:", text.slice(0, 300));
    return [];
  }

  try {
    const parsed = JSON.parse(arrayMatch[0]) as AIContact[];
    return parsed;
  } catch {
    // Try to recover partial JSON (truncated response)
    const partial = arrayMatch[0];
    // Find last complete object
    const lastComplete = partial.lastIndexOf("},");
    if (lastComplete > 0) {
      try {
        const recovered = JSON.parse(partial.slice(0, lastComplete + 1) + "]") as AIContact[];
        console.error(`[enrich] Recovered ${recovered.length} contacts from truncated response`);
        return recovered;
      } catch { /* fall through */ }
    }
    console.error("[enrich] JSON parse failed. Raw response:", text.slice(0, 500));
    return [];
  }
}

// ─── Build ValidatedLead ──────────────────────────────────────────────────────

function buildValidatedLead(
  company: ExpansionCompany,
  contact: AIContact,
  campaignId: string,
  targetEvent: string
) {
  const emailResult = emailPatternResolver.resolve({
    name: contact.contactName,
    company: company.company,
    website: company.website,
  });

  const score = company.eventFitScore;
  const outreachPriority = Math.round((score + company.enterpriseScore) / 2);
  const status = outreachPriority >= 90 ? "HOT" : outreachPriority >= 75 ? "WARM" : "LOW_PRIORITY";
  const strategicFit =
    outreachPriority >= 90 ? "excellent" :
    outreachPriority >= 80 ? "strong" :
    outreachPriority >= 70 ? "moderate" : "weak";

  return {
    company: company.company,
    contactName: contact.contactName,
    role: contact.role,
    linkedin: contact.linkedin,
    area: contact.area,
    seniority: contact.seniority,
    guessedEmails: emailResult.guessedEmails,
    primaryEmail: emailResult.guessedEmails[0]?.email ?? "",
    confidence: emailResult.confidence,
    bounceRisk: emailResult.confidence === "high" ? "low" : emailResult.confidence === "medium" ? "medium" : "high",
    relevanceScore: score,
    strategicFitScore: company.enterpriseScore,
    outreachPriority,
    strategicFit,
    rationale: contact.rationale,
    recommendedTemplate: contact.seniority === "c-level" ? "executive-intro" : "cold-outreach",
    recommendedApproach: contact.recommendedApproach,
    recommendedCTA: contact.recommendedCTA,
    useCaseABRINT: score >= 85,
    personalizationLevel: score >= 90 ? "high" : score >= 80 ? "medium" : "standard",
    status,
    campaignId,
    targetEvent,
    validatedAt: new Date().toISOString(),
    originalPriorityScore: score,
    emailDomain: emailResult.domain,
    emailDomainSource: emailResult.domainSource,
    emailPattern: emailResult.pattern,
    website: company.website,
    segment: company.segment,
  };
}

// ─── Console output ───────────────────────────────────────────────────────────

const USE_COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const c = {
  bold:   (s: string) => USE_COLOR ? `\x1b[1m${s}\x1b[0m` : s,
  dim:    (s: string) => USE_COLOR ? `\x1b[2m${s}\x1b[0m` : s,
  green:  (s: string) => USE_COLOR ? `\x1b[32m${s}\x1b[0m` : s,
  yellow: (s: string) => USE_COLOR ? `\x1b[33m${s}\x1b[0m` : s,
  cyan:   (s: string) => USE_COLOR ? `\x1b[36m${s}\x1b[0m` : s,
};
const hr = "═".repeat(68);

// ─── Main ─────────────────────────────────────────────────────────────────────

const sourcePath = resolve(ROOT, SOURCE);
if (!existsSync(sourcePath)) {
  console.error(`Source file not found: ${sourcePath}`);
  process.exit(1);
}

const sourceData = JSON.parse(readFileSync(sourcePath, "utf8"));
const companies: ExpansionCompany[] = Array.isArray(sourceData.leads) ? sourceData.leads : [];
const campaignId = sourceData.campaign ?? "futurecom-2026-expansion";
const targetEvent = sourceData.targetEvent ?? "Futurecom 2026";

console.log(`\n${c.bold("VRASHOWS — Expansion Lead Enrichment")}`);
console.log(c.dim(`Source: ${SOURCE} · Companies: ${companies.length} · Model: ${MODEL}`));
console.log(hr);
console.log(`\n${c.bold("Companies to enrich:")}\n`);

for (const co of companies) {
  const score = co.eventFitScore;
  const tier = score >= 90 ? c.green("A") : score >= 80 ? c.yellow("B") : "C";
  console.log(`  Tier ${tier}  ${c.bold(co.company.padEnd(22))}  score: ${score}  → ${co.suggestedRoles[0] ?? "?"}`);
}

if (DRY_RUN) {
  console.log(`\n${c.cyan("Dry-run mode — no AI calls made.")}\n`);
  process.exit(0);
}

// ─── Run enrichment in batches ────────────────────────────────────────────────

console.log(`\n${hr}`);
console.log(`${c.bold("Running AI enrichment...")} (${Math.ceil(companies.length / BATCH_SIZE)} batch(es) of up to ${BATCH_SIZE})\n`);

const enrichedLeads: ReturnType<typeof buildValidatedLead>[] = [];
const failed: string[] = [];

for (let i = 0; i < companies.length; i += BATCH_SIZE) {
  const batch = companies.slice(i, i + BATCH_SIZE);
  const batchNum = Math.floor(i / BATCH_SIZE) + 1;
  const totalBatches = Math.ceil(companies.length / BATCH_SIZE);
  console.log(c.dim(`Batch ${batchNum}/${totalBatches}: ${batch.map((b) => b.company).join(", ")}`));

  try {
    const contacts = await generateContacts(batch);

    for (const company of batch) {
      const contact = contacts.find((ct) => ct.company === company.company);
      if (!contact) {
        console.log(`  ${c.yellow("!")} ${company.company} — no contact generated, skipping`);
        failed.push(company.company);
        continue;
      }

      const lead = buildValidatedLead(company, contact, campaignId, targetEvent);
      enrichedLeads.push(lead);

      const emailLabel = lead.primaryEmail ? c.green(lead.primaryEmail) : c.yellow("no email");
      const confLabel = lead.confidence === "high" ? c.green(lead.confidence) : lead.confidence === "medium" ? c.yellow(lead.confidence) : lead.confidence;
      console.log(`  ${c.green("✓")} ${c.bold(company.company.padEnd(20))} → ${contact.contactName.padEnd(24)} ${emailLabel} [${confLabel}]`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`  ${c.yellow("Batch failed:")} ${message}`);
    for (const co of batch) failed.push(co.company);
  }

  // Small delay between batches to be gentle on the API
  if (i + BATCH_SIZE < companies.length) {
    await new Promise((r) => setTimeout(r, 500));
  }
}

// ─── Save output ──────────────────────────────────────────────────────────────

if (enrichedLeads.length === 0) {
  console.error("\nNo leads enriched. Check API key and try again.");
  process.exit(1);
}

const outDir = resolve(ROOT, "data/leads/futurecom");
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, "validated-expansion-batch-01.json");

const hotCount = enrichedLeads.filter((l) => l.status === "HOT").length;
const warmCount = enrichedLeads.filter((l) => l.status === "WARM").length;

const output = {
  _meta: {
    description: "Futurecom expansion batch 01 — AI-enriched contacts with email patterns",
    enrichedAt: new Date().toISOString(),
    sourceFile: SOURCE,
    model: MODEL,
    totalLeads: enrichedLeads.length,
    hotCount,
    warmCount,
    failedCount: failed.length,
    failedCompanies: failed,
  },
  campaign: campaignId,
  targetEvent,
  validatedAt: new Date().toISOString(),
  totalLeads: enrichedLeads.length,
  hotCount,
  warmCount,
  leads: enrichedLeads,
};

writeFileSync(outPath, JSON.stringify(output, null, 2), "utf8");

console.log(`\n${hr}`);
console.log(`  ${c.green("Enrichment complete!")}`);
console.log(`  ${c.bold("Enriched:")} ${enrichedLeads.length}  (HOT: ${hotCount} · WARM: ${warmCount})`);
if (failed.length > 0) console.log(`  ${c.yellow("Failed:")} ${failed.length} — ${failed.join(", ")}`);
console.log(`  ${c.bold("Saved:")} ${outPath}`);
console.log(`\n  ${c.bold("Next step:")}`);
console.log(`  ${c.cyan("npx tsx scripts/run-continuous-outbound.ts")}`);
console.log(hr + "\n");
