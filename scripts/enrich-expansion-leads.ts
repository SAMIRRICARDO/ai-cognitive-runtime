#!/usr/bin/env tsx
/**
 * enrich-expansion-leads.ts — AI-powered contact enrichment for expansion batch
 *
 * Uses gpt-4o-mini (cheap mode) to generate a plausible decision-maker contact
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
import OpenAI from "openai";
import { emailPatternResolver } from "../agents/lead-enrichment-agent/email-resolver.js";
import { getIALeadsCache } from "../memory/sqlite-cache.js";
import { recordAnalytics, estimateOpenAICost } from "../memory/analytics.js";
import { saveLocalMemory } from "../memory/local-rag.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ─── CLI ───────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const val = (f: string) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : undefined; };

const SOURCE = val("--source") ?? "data/leads/futurecom/futurecom-expansion-batch-01.json";
const OUTPUT = val("--output");
const BLOCKLIST = val("--blocklist") ?? "data/leads/blocklist/do-not-contact-latest.json";
const DRY_RUN = flag("--dry-run") || flag("--preview");
const BATCH_SIZE = Math.min(Number(val("--batch") ?? "3"), 5); // companies per AI call
const MAX_OUTPUT_TOKENS = Number(process.env.MAX_OUTPUT_TOKENS ?? "700");

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

interface RawSourcingCompany {
  company: string;
  website: string;
  linkedin?: string;
  segment: string;
  eventFit?: string;
  targetRoles?: string[];
  status?: string;
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

const openAiApiKey = process.env.OPENAI_API_KEY?.replace(/\s+/g, "");
const client = new OpenAI({ apiKey: openAiApiKey });
const MODEL = process.env.ACQUISITION_MODEL ?? "gpt-4o-mini";
const localCache = getIALeadsCache();

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

  const prompt = `Return JSON only. No markdown. No reasoning.
Generate ONE likely marketing/events decision-maker per company for Futurecom 2026.

COMPANIES:
${companiesJson}

RULES:
- Realistic Brazilian/LATAM name
- Role from suggestedRoles
- LinkedIn pattern: linkedin.com/in/firstname-lastname
- rationale max 12 words
- recommendedApproach max 12 words
- recommendedCTA max 6 words

JSON array schema:
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

  const cachedPrompt = localCache.getPrompt("enrichment", prompt);
  if (cachedPrompt) {
    recordAnalytics({
      provider: "cache",
      source: "enrich-expansion-leads",
      cacheHits: 1,
      estimatedSavingsUsd: 0.01,
      metadata: { kind: "prompt", companies: companies.map((c) => c.company) },
    });
    return cachedPrompt.response as AIContact[];
  }

  const response = await client.responses.create({
    model: MODEL,
    input: prompt,
    max_output_tokens: MAX_OUTPUT_TOKENS,
    temperature: 0,
  });

  const text = response.output_text ?? "";
  const usage = response.usage as
    | { input_tokens?: number; output_tokens?: number; total_tokens?: number }
    | undefined;
  const inputTokens = usage?.input_tokens ?? 0;
  const outputTokens = usage?.output_tokens ?? 0;
  recordAnalytics({
    provider: "openai",
    source: "enrich-expansion-leads",
    model: MODEL,
    inputTokens,
    outputTokens,
    totalTokens: usage?.total_tokens,
    estimatedCostUsd: estimateOpenAICost(MODEL, inputTokens, outputTokens),
    requests: 1,
    metadata: { companies: companies.map((c) => c.company) },
  });

  // Extract JSON array from response (handles markdown fences and leading text)
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (!arrayMatch) {
    console.error("[enrich] No JSON array found. Raw response:", text.slice(0, 300));
    return [];
  }

  try {
    const parsed = JSON.parse(arrayMatch[0]) as AIContact[];
    localCache.savePrompt({
      kind: "enrichment",
      prompt,
      response: parsed,
      metadata: { model: MODEL, companies: companies.map((c) => c.company) },
    });
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

function readJsonFile<T = unknown>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, "")) as T;
}

const sourceData = readJsonFile<any>(sourcePath);
const blocklistPath = resolve(ROOT, BLOCKLIST);
const blocklist = existsSync(blocklistPath)
  ? readJsonFile<{ emails?: string[]; companies?: string[] }>(blocklistPath)
  : {};
const blockedEmails = new Set((blocklist.emails ?? []).map((email) => email.toLowerCase()));
const blockedCompanies = new Set((blocklist.companies ?? []).map((company) => company.toLowerCase()));

function normalizeCompany(raw: RawSourcingCompany | ExpansionCompany): ExpansionCompany {
  const existing = raw as ExpansionCompany;
  if (Array.isArray(existing.suggestedRoles)) return existing;

  const seed = raw as RawSourcingCompany;
  return {
    company: seed.company,
    website: seed.website,
    segment: seed.segment,
    probableEventFit: seed.eventFit ?? "enterprise event participation and brand activation",
    probableBudgetLevel: "high",
    strategicNotes: seed.eventFit ?? `${seed.company} fits IALEADS event-led B2B outreach.`,
    possibleEvents: ["Web Summit Rio", "Futurecom", "Febraban Tech", "IT Forum"],
    probableDepartments: ["marketing", "events", "brand", "growth"],
    suggestedRoles: seed.targetRoles ?? ["Marketing Manager", "Events Manager", "Brand Manager", "Growth Marketing Manager"],
    eventFitScore: 82,
    marketingMaturity: "high",
    enterpriseScore: 82,
  };
}

const rawCompanies: Array<RawSourcingCompany | ExpansionCompany> = Array.isArray(sourceData.leads) ? sourceData.leads : [];
const companies: ExpansionCompany[] = rawCompanies
  .map(normalizeCompany)
  .filter((company) => !blockedCompanies.has(company.company.toLowerCase()));
const campaignId = sourceData.campaign ?? "futurecom-2026-expansion";
const targetEvent = sourceData.targetEvent ?? "Futurecom 2026";
localCache.upsertCampaign({
  campaignId,
  name: targetEvent,
  metadata: { source: SOURCE, model: MODEL },
});
saveLocalMemory({
  collection: "campaigns",
  content: `${campaignId}: ${targetEvent}`,
  tags: ["campaign", campaignId],
  metadata: { source: SOURCE },
  id: `campaign:${campaignId}`,
});

console.log(`\n${c.bold("VRASHOWS — Expansion Lead Enrichment")}`);
console.log(c.dim(`Source: ${SOURCE} · Companies: ${companies.length} · Model: ${MODEL}`));
console.log(c.dim(`Blocklist: ${BLOCKLIST} · blocked emails: ${blockedEmails.size} · blocked companies: ${blockedCompanies.size}`));
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

const enrichedLeads: ReturnType<typeof buildValidatedLead>[] = [];
const failed: string[] = [];
const pendingCompanies: ExpansionCompany[] = [];
let cachedLeadCount = 0;

for (const company of companies) {
  const cached = localCache.getLeadByCompany(company.company);
  if (cached?.enrichment && Object.keys(cached.enrichment).length > 0) {
    const cachedLead = cached.enrichment as ReturnType<typeof buildValidatedLead>;
    if (!cachedLead.primaryEmail || !cachedLead.contactName) {
      pendingCompanies.push(company);
      continue;
    }
    if (cachedLead.primaryEmail && blockedEmails.has(String(cachedLead.primaryEmail).toLowerCase())) {
      failed.push(`${company.company}: blocked cached email`);
      continue;
    }
    enrichedLeads.push(cachedLead);
    cachedLeadCount += 1;
    recordAnalytics({
      provider: "cache",
      source: "enrich-expansion-leads",
      cacheHits: 1,
      estimatedSavingsUsd: 0.01,
      metadata: { company: company.company, kind: "lead-enrichment" },
    });
    console.log(`  ${c.cyan("cache")} ${c.bold(company.company)} — enrichment reused`);
  } else {
    pendingCompanies.push(company);
  }
}

console.log(`${c.bold("Running AI enrichment...")} (${Math.ceil(pendingCompanies.length / BATCH_SIZE)} batch(es) of up to ${BATCH_SIZE}; cache hits: ${enrichedLeads.length})\n`);

for (let i = 0; i < pendingCompanies.length; i += BATCH_SIZE) {
  const batch = pendingCompanies.slice(i, i + BATCH_SIZE);
  const batchNum = Math.floor(i / BATCH_SIZE) + 1;
  const totalBatches = Math.ceil(pendingCompanies.length / BATCH_SIZE);
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
      if (!lead.primaryEmail || blockedEmails.has(lead.primaryEmail.toLowerCase())) {
        console.log(`  ${c.yellow("blocked")} ${company.company} — email already in do-not-contact`);
        failed.push(`${company.company}: blocked email`);
        continue;
      }
      enrichedLeads.push(lead);
      localCache.upsertCompany({
        company: company.company,
        website: company.website,
        segment: company.segment,
        status: "enriched",
        metadata: { campaignId, targetEvent },
      });
      localCache.upsertLead({
        company: company.company,
        contactName: contact.contactName,
        email: lead.primaryEmail,
        enrichment: lead,
      });
      saveLocalMemory({
        collection: "companies",
        content: `${company.company}: ${company.segment}, score ${company.eventFitScore}`,
        tags: ["company", company.segment, campaignId],
        metadata: { website: company.website, eventFitScore: company.eventFitScore },
        id: `company:${company.company.toLowerCase()}`,
      });

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
  if (i + BATCH_SIZE < pendingCompanies.length) {
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
const defaultOutput = SOURCE.includes("data/leads/new/")
  ? resolve(ROOT, "data/leads/new", `enriched-${SOURCE.split(/[\\/]/).pop()}`)
  : resolve(outDir, "validated-expansion-batch-01.json");
const outPath = OUTPUT ? resolve(ROOT, OUTPUT) : defaultOutput;
mkdirSync(dirname(outPath), { recursive: true });

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
recordAnalytics({
  provider: "runtime",
  source: "enrich-expansion-leads",
  leadsGenerated: enrichedLeads.length - cachedLeadCount,
  metadata: { totalLeads: enrichedLeads.length, cachedLeads: cachedLeadCount },
});

console.log(`\n${hr}`);
console.log(`  ${c.green("Enrichment complete!")}`);
console.log(`  ${c.bold("Enriched:")} ${enrichedLeads.length}  (HOT: ${hotCount} · WARM: ${warmCount})`);
if (failed.length > 0) console.log(`  ${c.yellow("Failed:")} ${failed.length} — ${failed.join(", ")}`);
console.log(`  ${c.bold("Saved:")} ${outPath}`);
console.log(`\n  ${c.bold("Next step:")}`);
console.log(`  ${c.cyan("npx tsx scripts/run-continuous-outbound.ts")}`);
console.log(hr + "\n");
