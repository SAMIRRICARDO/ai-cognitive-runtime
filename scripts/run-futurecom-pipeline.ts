#!/usr/bin/env tsx
/**
 * Futurecom Pipeline — VRASHOWS enterprise lead acquisition and validation.
 *
 * Produces:
 *   - data/leads/futurecom/futurecom_leads.csv
 *   - data/leads/futurecom/futurecom_leads.json
 *   - data/leads/futurecom/futurecom_validated_leads.json
 *
 * Usage:
 *   tsx scripts/run-futurecom-pipeline.ts
 *   tsx scripts/run-futurecom-pipeline.ts --min-score 50 --max-leads 12
 *   tsx scripts/run-futurecom-pipeline.ts --json
 */
import { mkdirSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

import { FuturecomResearcherAgent } from "../agents/futurecom-researcher/agent.js";
import { LeadEnrichmentAgent } from "../agents/lead-enrichment-agent/agent.js";
import { scoreLeads } from "../agents/lead-validation/scorer.js";
import { isCheapMode } from "../config/env.js";
import { runLeadAcquisitionScheduler } from "../scheduler/lead-acquisition-scheduler.js";
import type { LeadProfile } from "../agents/futurecom-researcher/types.js";
import type { AgentStep } from "../agents/_base/types.js";
import type { EnrichedContact } from "../agents/lead-enrichment-agent/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUT_DIR = resolve(ROOT, "data/leads/futurecom");

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const idx = args.indexOf(name);
  return idx === -1 ? undefined : args[idx + 1];
};
const hasFlag = (name: string): boolean => args.includes(name);

const minScore = parseInt(flag("--min-score") ?? "50", 10);
const maxLeads = Math.min(parseInt(flag("--max-leads") ?? "12", 10), 25);
const maxContacts = isCheapMode ? 1 : parseInt(flag("--max-contacts") ?? "3", 10);
const rawSegments = flag("--segments") ?? "telecom,cloud,ai,cybersecurity,connectivity,infrastructure,enterprise-software";
const jsonOutput = hasFlag("--json");

const SEGMENT_SYNONYMS: Record<string, string> = {
  "telecom": "telecom",
  "cloud": "cloud",
  "saas": "saas",
  "ai": "ai",
  "cybersecurity": "cybersecurity",
  "security": "cybersecurity",
  "networking": "connectivity",
  "connectivity": "connectivity",
  "infraestrutura": "infrastructure",
  "infrastructure": "infrastructure",
  "enterprise": "enterprise-software",
  "enterprise tech": "enterprise-software",
  "enterprise-software": "enterprise-software",
  "iot": "iot",
  "fintech": "fintech",
};

const segments = Array.from(new Set(
  rawSegments
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .map((s) => SEGMENT_SYNONYMS[s] ?? s)
    .filter(Boolean)
));

function toCsvRow(values: Array<string | number | boolean>) {
  return values
    .map((value) => {
      const text = String(value ?? "");
      return text.includes(",") || text.includes("\n") || text.includes('"')
        ? `"${text.replace(/"/g, '""')}"`
        : text;
    })
    .join(",");
}

const stepHandler = (phase: string) => (step: AgentStep) => {
  if (jsonOutput) return;
  if (step.type === "thinking") {
    process.stderr.write(`\x1b[2m[${phase}] ${step.content}\x1b[0m\n`);
  } else if (step.type === "tool_call") {
    if (step.tool === "save_lead") {
      const input = step.input as Record<string, unknown>;
      process.stderr.write(`\x1b[32m[lead]\x1b[0m ${input.company} · score=${input.initialScore}\n`);
    } else if (step.tool === "save_contact") {
      const input = step.input as Record<string, unknown>;
      process.stderr.write(`\x1b[36m[contact]\x1b[0m ${input.company} — ${input.name} (${input.role})\n`);
    } else {
      process.stderr.write(`\x1b[33m[tool]\x1b[0m ${step.tool}\n`);
    }
  }
};

function buildRawLeadFile(contacts: EnrichedContact[]) {
  return {
    campaign: "VRASHOWS Futurecom 2026",
    targetEvent: "Futurecom 2026",
    enrichedAt: new Date().toISOString(),
    leads: contacts.map((contact) => ({
      company: contact.company,
      contactName: contact.name,
      role: contact.role,
      area: contact.area,
      seniority: contact.seniority,
      linkedin: contact.linkedin,
      guessedEmails: contact.guessedEmails ?? [],
      confidence: contact.emailConfidence ?? "low",
      priority: contact.priority,
      priorityScore: contact.priorityScore,
      outreachStatus: "pending",
      rationale: contact.strategicNotes,
      notes: contact.sources.join("; "),
    })),
  };
}

function mapLeadToCsvRow(lead: LeadProfile) {
  return toCsvRow([
    lead.company,
    lead.website,
    lead.segment,
    lead.eventRelevance,
    lead.budgetPotential,
    lead.boothComplexity,
    lead.initialScore,
    lead.strategicNotes,
    lead.sources.join("; "),
  ]);
}

const main = async () => {
  if (isCheapMode && !hasFlag("--full-agent")) {
    await runLeadAcquisitionScheduler({ force: hasFlag("--force") });
    return;
  }

  if (!jsonOutput) {
    console.log("\nVRASHOWS Futurecom Pipeline — research → enrich → validate\n");
  }

  const researcher = await FuturecomResearcherAgent.create();
  const research = await researcher.research(
    "Identify companies exhibiting or sponsoring Futurecom 2026 with high potential for 360° event operations partnership with VRASHOWS",
    {
      minScore,
      maxLeads,
      segments: segments as unknown as LeadProfile["segment"][],
    },
    { onStep: stepHandler("research") }
  );

  mkdirSync(OUT_DIR, { recursive: true });

  const rawJsonPath = resolve(OUT_DIR, "futurecom_leads.json");
  const csvPath = resolve(OUT_DIR, "futurecom_leads.csv");

  writeFileSync(rawJsonPath, JSON.stringify(research, null, 2), "utf8");
  writeFileSync(
    csvPath,
    [
      toCsvRow(["company", "website", "category", "probableEventFit", "probableActivationFit", "standPotential", "enterpriseScore", "strategicNotes", "sources"]),
      ...research.leads.map(mapLeadToCsvRow),
    ].join("\n"),
    "utf8"
  );

  if (!jsonOutput) {
    console.log(`Saved raw lead exports:\n  - ${rawJsonPath}\n  - ${csvPath}\n`);
  }

  const enrichmentAgent = await LeadEnrichmentAgent.create();
  const enrichment = await enrichmentAgent.enrich(
    {
      companies: research.leads.map((l) => l.company),
      leadContext: research.leads,
      options: {
        minSeniority: "manager",
        maxContactsPerCompany: maxContacts,
        event: "Futurecom 2026",
        areas: ["marketing", "events", "brand", "customer-experience", "communications", "sponsorship"],
      },
    },
    { onStep: stepHandler("enrichment") }
  );

  const rawLeadFile = buildRawLeadFile(enrichment.contacts);
  const validated = scoreLeads(rawLeadFile.leads, rawLeadFile.campaign, rawLeadFile.targetEvent);
  const validatedPath = resolve(OUT_DIR, "futurecom_validated_leads.json");

  writeFileSync(
    validatedPath,
    JSON.stringify(
      {
        campaignId: rawLeadFile.campaign,
        targetEvent: rawLeadFile.targetEvent,
        totalLeads: validated.length,
        hot: validated.filter((l) => l.status === "HOT").length,
        warm: validated.filter((l) => l.status === "WARM").length,
        lowPriority: validated.filter((l) => l.status === "LOW_PRIORITY").length,
        invalid: validated.filter((l) => l.status === "INVALID").length,
        leads: validated,
        validatedAt: new Date().toISOString(),
      },
      null,
      2
    ),
    "utf8"
  );

  if (!jsonOutput) {
    console.log(`Saved validated output:\n  - ${validatedPath}\n`);
    console.log(`\nSummary: ${validated.length} contacts validated (${validated.filter((l) => l.status === "HOT").length} HOT, ${validated.filter((l) => l.status === "WARM").length} WARM, ${validated.filter((l) => l.status === "LOW_PRIORITY").length} LOW_PRIORITY, ${validated.filter((l) => l.status === "INVALID").length} INVALID)\n`);
  } else {
    process.stdout.write(JSON.stringify({
      research,
      enrichment,
      validation: {
        campaignId: rawLeadFile.campaign,
        targetEvent: rawLeadFile.targetEvent,
        totalLeads: validated.length,
        hot: validated.filter((l) => l.status === "HOT").length,
        warm: validated.filter((l) => l.status === "WARM").length,
        lowPriority: validated.filter((l) => l.status === "LOW_PRIORITY").length,
        invalid: validated.filter((l) => l.status === "INVALID").length,
        leads: validated,
      },
    }, null, 2));
  }
};

await main();
