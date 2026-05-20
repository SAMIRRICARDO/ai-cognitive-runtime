#!/usr/bin/env tsx
/**
 * run-continuous-outbound.ts — VRASHOWS continuous enterprise outbound controller
 *
 * Loads ALL lead sources, determines per-tier cadence, identifies today's
 * batch (new cold outreach + due follow-ups), and either previews or executes.
 *
 * Tier rules (based on outreachPriority / eventFitScore / enterpriseScore):
 *   Tier A  score ≥ 90  → max 3/day  cold · D+3 · D+7 · D+15
 *   Tier B  80-89       → max 3/day  cold · D+3 · D+7 · D+15
 *   Tier C  < 80        → max 2/day  cold · D+3 · D+7 · D+15
 *
 * Usage:
 *   tsx scripts/run-continuous-outbound.ts              # status report (no sends)
 *   tsx scripts/run-continuous-outbound.ts --plan       # show today's batch plan
 *   tsx scripts/run-continuous-outbound.ts --execute    # generate queue files + run
 *   tsx scripts/run-continuous-outbound.ts --execute --live  # live send
 *   tsx scripts/run-continuous-outbound.ts --followups-only  # only process follow-ups
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const LOGS_DIR = resolve(ROOT, "logs");
const OUTREACH_DIR = resolve(LOGS_DIR, "outreach");
const OUTBOUND_LOG = resolve(LOGS_DIR, "outbound-log.json");
const FOLLOWUP_LOG = resolve(LOGS_DIR, "followup-log.json");
const RESEND_LOG = resolve(LOGS_DIR, "resend-log.json");
const REPLIES = resolve(LOGS_DIR, "replies.json");
const OUTPUT_DIR = resolve(ROOT, "data/outreach");

// ─── Lead source files ────────────────────────────────────────────────────────

const LEAD_SOURCES = [
  { path: "data/leads/validated/aws-leads-validated.json",     campaign: "aws-enterprise-v1",        event: "Futurecom 2026", format: "validated" },
  { path: "data/leads/validated/telecom-leads-validated.json", campaign: "telecom-enterprise-v1",     event: "Futurecom 2026", format: "validated" },
  { path: "data/leads/futurecom/validated-top5.json",          campaign: "futurecom-2026-enterprise-v1", event: "Futurecom 2026", format: "validated" },
  { path: "data/leads/futurecom/validated-remaining20.json",   campaign: "futurecom-2026-enterprise-v1", event: "Futurecom 2026", format: "validated" },
  { path: "data/leads/futurecom/validated-expansion-batch-01.json", campaign: "futurecom-2026-expansion", event: "Futurecom 2026", format: "validated" },
  { path: "data/leads/futurecom/futurecom-expansion-batch-01.json", campaign: "futurecom-2026-expansion", event: "Futurecom 2026", format: "expansion" },
];

// ─── CLI ───────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const val = (f: string) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : undefined; };

const PLAN = flag("--plan") || flag("--execute");
const EXECUTE = flag("--execute");
const LIVE = flag("--live");
const FOLLOWUPS_ONLY = flag("--followups-only");
const COLD_ONLY = flag("--cold-only");
const NOW_ARG = val("--now");
const NOW = NOW_ARG ? new Date(NOW_ARG) : new Date();
const DAILY_CAP_TOTAL = Number(val("--daily-cap") ?? "10");

// ─── Types ────────────────────────────────────────────────────────────────────

type Tier = "A" | "B" | "C";
type FollowupStage = "d3" | "d7" | "d15";
type ContactState = "not-contacted" | "pending" | "awaiting-d3" | "awaiting-d7" | "awaiting-d15" | "completed" | "blocked";
type Segment = "telecom" | "cloud" | "fintech" | "ai-sec" | "marketing" | "enterprise";

interface NormalizedLead {
  id: string;
  company: string;
  contactName: string;
  role: string;
  email: string;
  segment: Segment;
  tier: Tier;
  score: number;
  campaign: string;
  targetEvent: string;
  originalSubject?: string;
  hasEmail: boolean;
  needsEnrichment: boolean;
  source: string;
}

interface ContactStateInfo {
  lead: NormalizedLead;
  state: ContactState;
  initialSentAt?: string;
  daysSinceContact?: number;
  dueStage?: FollowupStage;
  completedFollowups: FollowupStage[];
  nextActionDate?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(readFileSync(path, "utf8")) as T; }
  catch { return fallback; }
}

function normalizeEmail(e?: string | null) { return (e ?? "").trim().toLowerCase(); }
function uid() { return crypto.randomBytes(5).toString("hex"); }

function daysBetween(fromIso: string, to: Date) {
  const from = new Date(fromIso);
  if (Number.isNaN(from.getTime())) return 0;
  return Math.floor((to.getTime() - from.getTime()) / 86400000);
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0]!;
}

const TELECOM_KW = ["claro", "vivo", "tim", "ericsson", "nokia", "huawei", "embratel", "v.tal", "vtal", "oi", "telefonica", "telefônica", "telecom", "ciena", "fiberhome", "telxius", "seaborn", "viasat", "eutelsat", "desktop", "vero", "ellalink", "datora", "telecall", "viavi"];
const CLOUD_KW   = ["aws", "amazon", "azure", "microsoft", "google", "oracle", "ibm", "vmware", "salesforce", "sap", "hcltech", "tech mahindra", "ifs", "manageengine", "datarev"];
const FINTECH_KW = ["banco", "bank", "finance", "credit", "btg", "xp", "inter", "pagbank", "nubank", "softswiss", "net2phone", "twilio"];
const AISEC_KW   = ["cisco", "fortinet", "palo alto", "security", "segurança", "cyber", "whitestack", "ihs towers"];

function detectSegment(company: string): Segment {
  const c = company.toLowerCase();
  if (TELECOM_KW.some((k) => c.includes(k))) return "telecom";
  if (CLOUD_KW.some((k) => c.includes(k)))   return "cloud";
  if (FINTECH_KW.some((k) => c.includes(k))) return "fintech";
  if (AISEC_KW.some((k) => c.includes(k)))   return "ai-sec";
  return "enterprise";
}

function scoreTier(score: number): Tier {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  return "C";
}

// ─── Load leads ───────────────────────────────────────────────────────────────

function loadAllLeads(): NormalizedLead[] {
  const leads: NormalizedLead[] = [];

  for (const source of LEAD_SOURCES) {
    const fullPath = resolve(ROOT, source.path);
    const data = readJson<any>(fullPath, null);
    if (!data) continue;

    if (source.format === "validated") {
      const items: any[] = Array.isArray(data.leads) ? data.leads : Array.isArray(data) ? data : [];
      for (const item of items) {
        const email = normalizeEmail(item.primaryEmail ?? item.email ?? "");
        const score = item.outreachPriority ?? item.relevanceScore ?? item.strategicFitScore ?? 75;
        leads.push({
          id: uid(),
          company: String(item.company ?? ""),
          contactName: String(item.contactName ?? ""),
          role: String(item.role ?? ""),
          email,
          segment: detectSegment(String(item.company ?? "")),
          tier: scoreTier(Number(score)),
          score: Number(score),
          campaign: source.campaign,
          targetEvent: source.event,
          hasEmail: email.length > 0 && email.includes("@"),
          needsEnrichment: false,
          source: source.path,
        });
      }
    } else if (source.format === "expansion") {
      const items: any[] = Array.isArray(data.leads) ? data.leads : [];
      for (const item of items) {
        const score = item.eventFitScore ?? item.enterpriseScore ?? 80;
        leads.push({
          id: uid(),
          company: String(item.company ?? ""),
          contactName: "",
          role: Array.isArray(item.suggestedRoles) ? String(item.suggestedRoles[0] ?? "") : "",
          email: "",
          segment: detectSegment(String(item.company ?? "")),
          tier: scoreTier(Number(score)),
          score: Number(score),
          campaign: source.campaign,
          targetEvent: source.event,
          hasEmail: false,
          needsEnrichment: true,
          source: source.path,
        });
      }
    }
  }

  const byEmail = new Map<string, NormalizedLead>();
  for (const lead of leads) {
    if (!lead.hasEmail) { leads; continue; }
    if (!byEmail.has(lead.email)) byEmail.set(lead.email, lead);
  }
  // rebuild: deduplicated validated + all expansion
  const result: NormalizedLead[] = [];
  const emailsSeen = new Set<string>();
  for (const lead of leads) {
    if (!lead.hasEmail) {
      result.push(lead);
    } else if (!emailsSeen.has(lead.email)) {
      emailsSeen.add(lead.email);
      result.push(lead);
    }
  }
  return result;
}

// ─── Load outbound state ──────────────────────────────────────────────────────

interface SentRecord {
  email: string;
  company: string;
  contactName?: string;
  subject?: string;
  sentAt: string;
}

function loadSentRecords(): Map<string, SentRecord> {
  const byEmail = new Map<string, SentRecord>();

  const outbound = readJson<any[]>(OUTBOUND_LOG, []);
  for (const item of outbound) {
    if (item?.status !== "sent") continue;
    const email = normalizeEmail(item.email ?? item.recipientEmail ?? item.to);
    const sentAt = item.sentAt ?? item.date;
    if (!email || !sentAt) continue;
    const existing = byEmail.get(email);
    if (!existing || new Date(sentAt) < new Date(existing.sentAt)) {
      byEmail.set(email, { email, company: String(item.company ?? ""), sentAt, contactName: item.contactName, subject: item.subject });
    }
  }

  if (existsSync(OUTREACH_DIR)) {
    for (const f of readdirSync(OUTREACH_DIR).filter((f) => f.endsWith(".json"))) {
      const session = readJson<any>(join(OUTREACH_DIR, f), null);
      const results: any[] = Array.isArray(session?.results) ? session.results : [];
      for (const item of results) {
        if (item?.status !== "sent") continue;
        const email = normalizeEmail(item.recipientEmail ?? item.email ?? item.to);
        const sentAt = item.sentAt ?? session.sessionStartedAt;
        if (!email || !sentAt) continue;
        const existing = byEmail.get(email);
        if (!existing || new Date(sentAt) < new Date(existing.sentAt)) {
          byEmail.set(email, { email, company: String(item.company ?? ""), sentAt, contactName: item.contactName, subject: item.subject });
        } else if (existing) {
          if (!existing.contactName && item.contactName) existing.contactName = item.contactName;
          if (!existing.subject && item.subject) existing.subject = item.subject;
        }
      }
    }
  }

  return byEmail;
}

function loadBlockedEmails(): Set<string> {
  const blocked = new Set<string>();
  for (const item of readJson<any[]>(REPLIES, [])) {
    const email = normalizeEmail(item?.from ?? item?.email);
    if (email) blocked.add(email);
  }
  for (const item of readJson<any[]>(RESEND_LOG, [])) {
    const email = normalizeEmail(item?.to ?? item?.email);
    const status = String(item?.status ?? "").toLowerCase();
    if (email && (status.includes("bounce") || status.includes("unsubscribe") || status.includes("complained"))) blocked.add(email);
  }
  for (const item of readJson<any[]>(OUTBOUND_LOG, [])) {
    const email = normalizeEmail(item?.email ?? item?.recipientEmail);
    const status = String(item?.status ?? "").toLowerCase();
    if (email && (status.includes("bounce") || status.includes("unsubscribe"))) blocked.add(email);
  }
  return blocked;
}

function loadCompletedFollowups(): Map<string, Set<FollowupStage>> {
  const completed = new Map<string, Set<FollowupStage>>();
  const log = readJson<any>(FOLLOWUP_LOG, { runs: [] });
  for (const run of log.runs ?? []) {
    for (const result of run.results ?? []) {
      if (result.status !== "sent") continue;
      const email = normalizeEmail(result.email);
      if (!email) continue;
      const raw = String(result.stage ?? "");
      const stage: FollowupStage | null = raw.startsWith("d3") ? "d3" : raw.startsWith("d7") ? "d7" : raw.startsWith("d15") ? "d15" : null;
      if (!stage) continue;
      const set = completed.get(email) ?? new Set<FollowupStage>();
      set.add(stage);
      completed.set(email, set);
    }
  }
  return completed;
}

// ─── State computation ────────────────────────────────────────────────────────

function computeState(
  leads: NormalizedLead[],
  sentRecords: Map<string, SentRecord>,
  blocked: Set<string>,
  completedFollowups: Map<string, Set<FollowupStage>>,
  now: Date
): ContactStateInfo[] {
  return leads.map((lead) => {
    if (!lead.hasEmail) {
      return { lead, state: "not-contacted" as ContactState, completedFollowups: [], nextActionDate: "needs-enrichment" };
    }

    if (blocked.has(lead.email)) {
      return { lead, state: "blocked" as ContactState, completedFollowups: [] };
    }

    const sent = sentRecords.get(lead.email);
    if (!sent) {
      return { lead, state: "not-contacted" as ContactState, completedFollowups: [], nextActionDate: "ready-now" };
    }

    const days = daysBetween(sent.sentAt, now);
    const done = completedFollowups.get(lead.email) ?? new Set<FollowupStage>();

    let state: ContactState;
    let dueStage: FollowupStage | undefined;

    if (days >= 15 && !done.has("d15")) { state = "awaiting-d15"; dueStage = "d15"; }
    else if (days >= 7 && !done.has("d7")) { state = "awaiting-d7"; dueStage = "d7"; }
    else if (days >= 3 && !done.has("d3")) { state = "awaiting-d3"; dueStage = "d3"; }
    else if (done.has("d3") && done.has("d7") && done.has("d15")) { state = "completed"; }
    else { state = "pending"; } // cold sent, D+3 not yet due

    const nextDate =
      !done.has("d3") ? addDays(sent.sentAt, 3) :
      !done.has("d7") ? addDays(sent.sentAt, 7) :
      !done.has("d15") ? addDays(sent.sentAt, 15) : undefined;

    return {
      lead,
      state,
      initialSentAt: sent.sentAt,
      daysSinceContact: days,
      dueStage,
      completedFollowups: [...done] as FollowupStage[],
      nextActionDate: nextDate,
    };
  });
}

// ─── Batch planning ───────────────────────────────────────────────────────────

interface DailyBatch {
  cold: ContactStateInfo[];
  followups: ContactStateInfo[];
  expansion: NormalizedLead[];
}

const TIER_DAILY_LIMITS: Record<Tier, number> = { A: 3, B: 3, C: 2 };

function planDailyBatch(states: ContactStateInfo[], totalCap: number): DailyBatch {
  const cold: ContactStateInfo[] = [];
  const followups: ContactStateInfo[] = [];
  const expansion: NormalizedLead[] = [];

  // Separate: needs enrichment, cold ready, follow-up due
  const enrichmentNeeded = states.filter((s) => s.lead.needsEnrichment);
  const coldReady = states.filter((s) => s.state === "not-contacted" && s.lead.hasEmail && !s.lead.needsEnrichment);
  const followupDue = states.filter((s) => ["awaiting-d3", "awaiting-d7", "awaiting-d15"].includes(s.state));

  // Priority: follow-ups first (keep relationships warm), then cold
  // Sort by tier (A > B > C) and score within tier
  const sortedFollowups = followupDue.sort((a, b) => {
    if (a.lead.tier !== b.lead.tier) return a.lead.tier < b.lead.tier ? -1 : 1;
    return b.lead.score - a.lead.score;
  });

  const sortedCold = coldReady.sort((a, b) => {
    if (a.lead.tier !== b.lead.tier) return a.lead.tier < b.lead.tier ? -1 : 1;
    return b.lead.score - a.lead.score;
  });

  let remaining = totalCap;

  // Add follow-ups
  for (const item of sortedFollowups) {
    if (remaining <= 0) break;
    const tierLimit = TIER_DAILY_LIMITS[item.lead.tier];
    const tierUsed = followups.filter((f) => f.lead.tier === item.lead.tier).length;
    if (tierUsed < tierLimit) {
      followups.push(item);
      remaining--;
    }
  }

  // Add cold outreach
  for (const item of sortedCold) {
    if (remaining <= 0) break;
    const tierLimit = TIER_DAILY_LIMITS[item.lead.tier];
    const tierUsed = cold.filter((c) => c.lead.tier === item.lead.tier).length;
    if (tierUsed < tierLimit) {
      cold.push(item);
      remaining--;
    }
  }

  // Flag expansion batch
  for (const s of enrichmentNeeded) expansion.push(s.lead);

  return { cold, followups, expansion };
}

// ─── Console output ───────────────────────────────────────────────────────────

const USE_COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const c = {
  bold:   (s: string) => USE_COLOR ? `\x1b[1m${s}\x1b[0m` : s,
  dim:    (s: string) => USE_COLOR ? `\x1b[2m${s}\x1b[0m` : s,
  green:  (s: string) => USE_COLOR ? `\x1b[32m${s}\x1b[0m` : s,
  yellow: (s: string) => USE_COLOR ? `\x1b[33m${s}\x1b[0m` : s,
  red:    (s: string) => USE_COLOR ? `\x1b[31m${s}\x1b[0m` : s,
  blue:   (s: string) => USE_COLOR ? `\x1b[34m${s}\x1b[0m` : s,
  cyan:   (s: string) => USE_COLOR ? `\x1b[36m${s}\x1b[0m` : s,
  magenta:(s: string) => USE_COLOR ? `\x1b[35m${s}\x1b[0m` : s,
};
const hr = "═".repeat(68);
const hr2 = "─".repeat(68);

function tierColor(tier: Tier) {
  return tier === "A" ? c.green(tier) : tier === "B" ? c.yellow(tier) : c.dim(tier);
}

function stateEmoji(state: ContactState) {
  if (state === "not-contacted") return c.cyan("○");
  if (state === "pending")       return c.dim("◌");
  if (state === "awaiting-d3")   return c.yellow("◐");
  if (state === "awaiting-d7")   return c.yellow("◑");
  if (state === "awaiting-d15")  return c.yellow("◕");
  if (state === "completed")     return c.green("●");
  if (state === "blocked")       return c.red("✕");
  return "?";
}

// ─── Main ─────────────────────────────────────────────────────────────────────

console.log(`\n${c.bold("VRASHOWS — Continuous Outbound Controller")}`);
console.log(c.dim(`Date: ${NOW.toISOString().split("T")[0]} · Daily cap: ${DAILY_CAP_TOTAL}`));
console.log(hr);

const allLeads = loadAllLeads();
const sentRecords = loadSentRecords();
const blocked = loadBlockedEmails();
const completedFollowups = loadCompletedFollowups();
const states = computeState(allLeads, sentRecords, blocked, completedFollowups, NOW);

// ─── Status overview ──────────────────────────────────────────────────────────

const total = states.length;
const withEmail = states.filter((s) => s.lead.hasEmail).length;
const needsEnrichment = states.filter((s) => s.lead.needsEnrichment).length;
const notContacted = states.filter((s) => s.state === "not-contacted" && !s.lead.needsEnrichment).length;
const pending = states.filter((s) => s.state === "pending").length;
const awaitingD3 = states.filter((s) => s.state === "awaiting-d3").length;
const awaitingD7 = states.filter((s) => s.state === "awaiting-d7").length;
const awaitingD15 = states.filter((s) => s.state === "awaiting-d15").length;
const completed = states.filter((s) => s.state === "completed").length;
const blockedCount = states.filter((s) => s.state === "blocked").length;

const tierA = states.filter((s) => s.lead.tier === "A").length;
const tierB = states.filter((s) => s.lead.tier === "B").length;
const tierC = states.filter((s) => s.lead.tier === "C").length;

console.log(`\n${c.bold("LEAD POOL OVERVIEW")}\n`);
console.log(`  Total leads loaded:     ${c.bold(String(total))}`);
console.log(`  With resolved email:    ${c.green(String(withEmail))}`);
console.log(`  Needs enrichment:       ${c.yellow(String(needsEnrichment))} (expansion batch — contacts not yet resolved)`);
console.log(`  Blocked / bounced:      ${c.red(String(blockedCount))}`);
console.log();
console.log(`  ${c.bold("Tiers:")}  A (≥90): ${c.green(String(tierA))}   B (80-89): ${c.yellow(String(tierB))}   C (<80): ${c.dim(String(tierC))}`);
console.log();
console.log(`  ${c.bold("Pipeline:")}`);
console.log(`    ${stateEmoji("not-contacted")} Not yet contacted:   ${notContacted}`);
console.log(`    ${stateEmoji("pending")}       Sent, D+3 pending:   ${pending}`);
console.log(`    ${stateEmoji("awaiting-d3")}   Awaiting D+3:        ${awaitingD3}  ${awaitingD3 > 0 ? c.yellow("← ready to send") : ""}`);
console.log(`    ${stateEmoji("awaiting-d7")}   Awaiting D+7:        ${awaitingD7}  ${awaitingD7 > 0 ? c.yellow("← ready to send") : ""}`);
console.log(`    ${stateEmoji("awaiting-d15")}  Awaiting D+15:       ${awaitingD15}  ${awaitingD15 > 0 ? c.yellow("← ready to send") : ""}`);
console.log(`    ${stateEmoji("completed")}    Sequence complete:   ${completed}`);

// ─── Per-contact detail ───────────────────────────────────────────────────────

console.log(`\n${hr2}`);
console.log(`${c.bold("FULL PIPELINE STATE")}\n`);

const grouped = new Map<ContactState, ContactStateInfo[]>();
const stateOrder: ContactState[] = ["awaiting-d3", "awaiting-d7", "awaiting-d15", "not-contacted", "pending", "completed", "blocked"];
for (const state of stateOrder) grouped.set(state, []);
for (const s of states) {
  if (s.lead.needsEnrichment) continue;
  grouped.get(s.state)?.push(s);
}

for (const state of stateOrder) {
  const items = grouped.get(state) ?? [];
  if (items.length === 0) continue;
  console.log(`  ${stateEmoji(state)} ${c.bold(state.toUpperCase())} (${items.length})`);
  for (const item of items.slice(0, 8)) {
    const daysLabel = item.daysSinceContact !== undefined ? `D+${item.daysSinceContact}` : "";
    const dueLabel = item.dueStage ? c.yellow(` → ${item.dueStage.toUpperCase()} due`) : "";
    const nextLabel = item.nextActionDate && item.nextActionDate !== "ready-now" && item.nextActionDate !== "needs-enrichment"
      ? c.dim(` [next: ${item.nextActionDate}]`) : "";
    console.log(`    Tier ${tierColor(item.lead.tier)} ${c.bold((item.lead.contactName || item.lead.company).padEnd(26))} ${item.lead.email.padEnd(38)} ${c.dim(daysLabel)}${dueLabel}${nextLabel}`);
  }
  if (items.length > 8) console.log(`    ${c.dim(`... and ${items.length - 8} more`)}`);
  console.log();
}

// ─── Expansion batch ──────────────────────────────────────────────────────────

if (needsEnrichment > 0) {
  const expansion = states.filter((s) => s.lead.needsEnrichment).map((s) => s.lead);
  console.log(`${hr2}`);
  console.log(`${c.bold("EXPANSION BATCH — NEEDS ENRICHMENT")} (${needsEnrichment} companies)\n`);
  console.log(`  These companies are queued but need contact name + email resolution`);
  console.log(`  before cold outreach can be sent.\n`);
  console.log(`  ${c.cyan("Action:")} Run the enrichment script:\n`);
  console.log(`    ${c.dim("npx tsx scripts/enrich-expansion-leads.ts --source data/leads/futurecom/futurecom-expansion-batch-01.json")}\n`);

  for (const lead of expansion.slice(0, 10)) {
    console.log(`    Tier ${tierColor(lead.tier)} ${c.bold(lead.company.padEnd(24))} score: ${lead.score}  role hint: ${lead.role.slice(0, 45)}`);
  }
  if (expansion.length > 10) console.log(`    ${c.dim(`... and ${expansion.length - 10} more`)}`);
  console.log();
}

// ─── Today's plan ─────────────────────────────────────────────────────────────

if (PLAN || EXECUTE) {
  const batch = planDailyBatch(states, DAILY_CAP_TOTAL);

  console.log(hr);
  console.log(`\n${c.bold(`TODAY'S BATCH — ${NOW.toISOString().split("T")[0]}`)}\n`);

  if (!FOLLOWUPS_ONLY && batch.cold.length > 0) {
    console.log(`${c.bold("Cold outreach")} (${batch.cold.length})`);
    for (const item of batch.cold) {
      console.log(`  Tier ${tierColor(item.lead.tier)} ${c.bold((item.lead.contactName || item.lead.company).padEnd(26))} → ${item.lead.email}`);
    }
    console.log();
  }

  if (!COLD_ONLY && batch.followups.length > 0) {
    console.log(`${c.bold("Follow-ups due")} (${batch.followups.length})`);
    for (const item of batch.followups) {
      const stageTag = item.dueStage ? c.yellow(`[${item.dueStage.toUpperCase()}]`) : "";
      console.log(`  Tier ${tierColor(item.lead.tier)} ${stageTag} ${c.bold((item.lead.contactName || item.lead.company).padEnd(24))} → ${item.lead.email}  ${c.dim(`D+${item.daysSinceContact}`)}`);
    }
    console.log();
  }

  if (batch.cold.length === 0 && batch.followups.length === 0) {
    console.log(`  ${c.green("All caught up!")} No actions due for ${NOW.toISOString().split("T")[0]}.`);
    console.log(c.dim(`  (${notContacted} not-contacted leads will be scheduled as the cadence advances)`));
    console.log();
  }

  if (EXECUTE) {
    const datestamp = NOW.toISOString().split("T")[0];
    mkdirSync(OUTPUT_DIR, { recursive: true });

    const generatedFiles: string[] = [];

    // Generate follow-up queue if any follow-ups due
    if (!COLD_ONLY && batch.followups.length > 0) {
      const { default: { execSync } } = await import("child_process");
      const stageGroups = new Map<FollowupStage, typeof batch.followups>([["d3", []], ["d7", []], ["d15", []]]);
      for (const item of batch.followups) {
        if (item.dueStage) stageGroups.get(item.dueStage)?.push(item);
      }
      for (const [stage, items] of stageGroups) {
        if (items.length === 0) continue;
        const queueFile = resolve(OUTPUT_DIR, `follow-up-${stage}-${datestamp}.json`);
        const genCmd = `npx tsx scripts/generate-followup-queue.ts --stage ${stage} --now ${NOW.toISOString()} 2>&1`;
        console.log(c.dim(`Generating ${stage.toUpperCase()} follow-up queue...`));
        execSync(genCmd, { cwd: ROOT, stdio: "inherit" });
        if (existsSync(queueFile)) generatedFiles.push(queueFile);
      }
    }

    // Execute queues
    for (const queueFile of generatedFiles) {
      const relative = queueFile.replace(ROOT + "/", "").replace(ROOT + "\\", "");
      const liveFlag = LIVE ? "--live" : "--dry-run";
      const runCmd = `npx tsx scripts/run-outbound-batch.ts --queue ${relative} ${liveFlag} --limit 5`;
      console.log(`\n${c.bold("Executing:")} ${runCmd}\n`);
      const { execSync } = await import("child_process");
      execSync(runCmd, { cwd: ROOT, stdio: "inherit" });
    }

    if (generatedFiles.length === 0) {
      console.log(c.yellow("No queues generated. Check eligible states for this date."));
    }
  }
}

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(hr);
console.log(`\n${c.bold("NEXT ACTIONS")}\n`);

if (awaitingD3 + awaitingD7 + awaitingD15 > 0) {
  console.log(`  ${c.yellow("→")} ${awaitingD3 + awaitingD7 + awaitingD15} follow-ups are due:`);
  console.log(`    ${c.cyan("npx tsx scripts/run-continuous-outbound.ts --plan --followups-only")}`);
  console.log(`    ${c.cyan("npx tsx scripts/run-continuous-outbound.ts --execute --live")}`);
  console.log();
}

if (notContacted > 0) {
  console.log(`  ${c.blue("→")} ${notContacted} leads not yet contacted:`);
  console.log(`    ${c.cyan("npx tsx scripts/run-continuous-outbound.ts --plan --cold-only")}`);
  console.log();
}

if (needsEnrichment > 0) {
  console.log(`  ${c.magenta("→")} ${needsEnrichment} expansion companies need contact enrichment:`);
  console.log(`    ${c.cyan("npx tsx scripts/enrich-expansion-leads.ts")}`);
  console.log();
}

console.log(c.dim(`  Tip: Add --now YYYY-MM-DDT10:00:00Z to simulate a future date`));
console.log(hr + "\n");
