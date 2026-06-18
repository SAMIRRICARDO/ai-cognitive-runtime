#!/usr/bin/env tsx
/**
 * lead-acquisition-scheduler.ts - recurring VRASHOWS enterprise lead acquisition.
 *
 * Cheap-mode scheduler:
 *   - runs Monday-Friday at/after 07:30
 *   - blocks weekends
 *   - prevents duplicate execution for the same local date
 *   - generates up to 25 enterprise account leads per run
 *   - validates schema and deduplicates against previous local lead files
 *   - writes minimal JSON only and exits after one batch
 *
 * Usage:
 *   npx tsx scheduler/lead-acquisition-scheduler.ts
 *   npx tsx scheduler/lead-acquisition-scheduler.ts --force
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, appendFileSync } from "fs";
import { dirname, extname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";
import { emailPatternResolver } from "../agents/lead-enrichment-agent/email-resolver.js";
import { getIALeadsCache } from "../memory/sqlite-cache.js";
import { recordAnalytics } from "../memory/analytics.js";
import { saveLocalMemory } from "../memory/local-rag.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const FUTURECOM_DIR = resolve(ROOT, "data/leads/futurecom");
const LEADS_ROOT = resolve(ROOT, "data/leads");
const LOG_FILE = resolve(ROOT, "logs/lead-acquisition.log");
const STATE_FILE = resolve(ROOT, "data/leads/futurecom/.lead-acquisition-state.json");

const RUN_HOUR = 7;
const RUN_MINUTE = 30;
const MAX_DAILY_LEADS = 25;
const SHORT_NOTES_MAX_CHARS = 180;

type BudgetLevel = "medium" | "high" | "enterprise";
type MarketingMaturity = "medium" | "high" | "enterprise";
type BounceRisk = "low" | "medium" | "high";
type LeadStatus = "HOT" | "WARM" | "LOW_PRIORITY" | "INVALID";

interface GuessedEmail {
  email: string;
  pattern: string;
  confidence: "high" | "medium" | "low";
}

interface EnterpriseLead {
  company: string;
  website: string;
  segment: string;
  probableEventFit: string;
  probableBudgetLevel: BudgetLevel;
  eventFitScore: number;
  enterpriseScore: number;
  marketingMaturity: MarketingMaturity;
  strategicNotes: string;
  possibleEvents: string[];
  probableDepartments: string[];
  suggestedRoles: string[];
}

interface DailyValidatedLead extends EnterpriseLead {
  contactName: string;
  role: string;
  area: string;
  seniority: "manager" | "director" | "c-level";
  linkedin: string;
  guessedEmails: GuessedEmail[];
  primaryEmail: string;
  confidence: "high" | "medium" | "low";
  bounceRisk: BounceRisk;
  deliverabilityStatus: "heuristic_valid" | "needs_external_verification" | "invalid";
  emailDomain: string;
  emailDomainSource: string;
  emailPattern: string;
  relevanceScore: number;
  strategicFitScore: number;
  outreachPriority: number;
  strategicFit: "excellent" | "strong" | "moderate" | "weak";
  recommendedTemplate: "executive-intro" | "cold-outreach" | "linkedin-message";
  recommendedApproach: string;
  recommendedCTA: string;
  status: LeadStatus;
  validatedAt: string;
}

interface MinimalAcquisitionLead {
  company: string;
  website: string;
  segment: string;
  eventFitScore: number;
  strategicNotes: string;
}

interface AcquisitionFile {
  _meta: {
    description: string;
    generatedAt: string;
    mode: string;
    date: string;
    duplicatesRemoved: number;
    contactsEnriched: number;
    emailValidation: string;
    schemaValidated: boolean;
    maxDailyLeads: number;
    cheapMode: true;
  };
  campaign: string;
  targetEvent: string;
  generatedAt: string;
  totalLeads: number;
  leads: MinimalAcquisitionLead[];
}

interface SchedulerState {
  lastRunDate?: string;
  lastOutputFile?: string;
  updatedAt?: string;
  processedCompanyHashes?: string[];
}

interface LogEvent {
  timestamp: string;
  date: string;
  status: "success" | "skipped" | "error";
  leads: number;
  duplicatesRemoved: number;
  errors: string[];
  executionTimeMs: number;
  outputFile?: string;
  reason?: string;
}

const candidatePool: EnterpriseLead[] = [
  {
    company: "Google Cloud",
    website: "cloud.google.com",
    segment: "cloud / AI / data analytics",
    probableEventFit: "AI and cloud transformation demos, executive meetings, partner ecosystem activation",
    probableBudgetLevel: "enterprise",
    eventFitScore: 93,
    enterpriseScore: 98,
    marketingMaturity: "enterprise",
    strategicNotes: "Global cloud provider with strong enterprise field marketing and AI/data narratives for telecom, finance, retail, and digital transformation.",
    possibleEvents: ["Futurecom", "Febraban Tech", "Google Cloud Summit", "Web Summit Rio", "CIO forums"],
    probableDepartments: ["marketing", "brand", "eventos", "partnerships", "field marketing", "corporate events", "experience"],
    suggestedRoles: ["Field Marketing Manager Brazil", "Head of Cloud Marketing", "Partner Marketing Manager", "Brand Experience Manager", "Events Marketing Lead"],
  },
  {
    company: "Amazon Web Services",
    website: "aws.amazon.com",
    segment: "cloud / AI / infrastructure",
    probableEventFit: "large cloud booth, AI demos, partner activations, executive hospitality",
    probableBudgetLevel: "enterprise",
    eventFitScore: 92,
    enterpriseScore: 98,
    marketingMaturity: "enterprise",
    strategicNotes: "Enterprise cloud anchor with high event investment, technical demos, partner theater formats, and ABM programs.",
    possibleEvents: ["Futurecom", "AWS Summit Sao Paulo", "Febraban Tech", "Web Summit Rio", "industry roadshows"],
    probableDepartments: ["field marketing", "events", "brand", "partnerships", "corporate events", "experience"],
    suggestedRoles: ["Field Marketing Manager Brazil", "Events Program Manager", "Partner Marketing Lead", "Enterprise Marketing Manager", "Brand Experience Lead"],
  },
  {
    company: "Google",
    website: "google.com.br",
    segment: "technology / AI / digital platforms",
    probableEventFit: "premium content sponsorship, AI showcase, executive relationship program",
    probableBudgetLevel: "enterprise",
    eventFitScore: 89,
    enterpriseScore: 98,
    marketingMaturity: "enterprise",
    strategicNotes: "Strong fit for AI, advertising technology, cloud, and ecosystem activations where brand experience and premium execution matter.",
    possibleEvents: ["Futurecom", "Web Summit Rio", "Febraban Tech", "VTEX DAY", "brand roadshows"],
    probableDepartments: ["marketing", "brand", "events", "partnerships", "field marketing", "experience"],
    suggestedRoles: ["Brand Marketing Manager", "Events Marketing Manager", "Partnerships Lead", "B2B Marketing Manager", "Experience Marketing Manager"],
  },
  {
    company: "Huawei",
    website: "huawei.com/br",
    segment: "telecom / cloud / digital infrastructure",
    probableEventFit: "mega stand, 5G demos, cloud and infrastructure showcases, executive lounge",
    probableBudgetLevel: "enterprise",
    eventFitScore: 94,
    enterpriseScore: 96,
    marketingMaturity: "enterprise",
    strategicNotes: "Large telecom and infrastructure player with high need for technical demo operations, hospitality, and coordinated partner experiences.",
    possibleEvents: ["Futurecom", "MWC", "ABRINT", "Smart City Expo Curitiba", "cloud and telecom forums"],
    probableDepartments: ["marketing", "brand", "eventos", "partnerships", "field marketing", "experience"],
    suggestedRoles: ["Marketing Director Brazil", "Events Manager", "Brand Experience Manager", "Partner Marketing Manager", "Enterprise Marketing Lead"],
  },
  {
    company: "Lenovo",
    website: "lenovo.com/br",
    segment: "enterprise hardware / infrastructure / AI PCs",
    probableEventFit: "enterprise product demos, partner activation, executive showcase",
    probableBudgetLevel: "enterprise",
    eventFitScore: 84,
    enterpriseScore: 93,
    marketingMaturity: "enterprise",
    strategicNotes: "Enterprise technology brand with strong event usage for devices, infrastructure, AI PC, and channel programs.",
    possibleEvents: ["Futurecom", "Febraban Tech", "IT Forum", "partner roadshows", "industry innovation events"],
    probableDepartments: ["field marketing", "brand", "events", "partnerships", "channel marketing"],
    suggestedRoles: ["Field Marketing Manager", "Channel Marketing Manager", "Events Manager", "Brand Manager", "Enterprise Marketing Lead"],
  },
  {
    company: "VMware by Broadcom",
    website: "broadcom.com",
    segment: "cloud infrastructure / virtualization / enterprise software",
    probableEventFit: "technical demos, partner ecosystem activation, executive meetings",
    probableBudgetLevel: "enterprise",
    eventFitScore: 83,
    enterpriseScore: 95,
    marketingMaturity: "enterprise",
    strategicNotes: "Enterprise infrastructure stack relevant to telecom cloud, private cloud, hybrid cloud, and partner-led events.",
    possibleEvents: ["Futurecom", "VMware Explore", "Febraban Tech", "IT Forum", "CIO forums"],
    probableDepartments: ["field marketing", "events", "partner marketing", "brand", "alliances"],
    suggestedRoles: ["Field Marketing Manager LATAM", "Partner Marketing Manager", "Events Manager", "Cloud Marketing Lead", "Alliance Marketing Manager"],
  },
  {
    company: "Red Hat",
    website: "redhat.com/pt-br",
    segment: "open source / hybrid cloud / enterprise software",
    probableEventFit: "hybrid cloud demos, partner sessions, developer and enterprise audience",
    probableBudgetLevel: "enterprise",
    eventFitScore: 84,
    enterpriseScore: 91,
    marketingMaturity: "enterprise",
    strategicNotes: "Strong B2B event profile with hybrid cloud, automation, OpenShift, and telecom cloud use cases.",
    possibleEvents: ["Futurecom", "Red Hat Summit Connect", "Febraban Tech", "OpenInfra events", "IT Forum"],
    probableDepartments: ["field marketing", "events", "partner marketing", "community", "brand"],
    suggestedRoles: ["Field Marketing Manager Brazil", "Events Marketing Manager", "Partner Marketing Lead", "Brand Manager", "Developer Marketing Lead"],
  },
  {
    company: "Trend Micro",
    website: "trendmicro.com",
    segment: "cybersecurity / cloud security",
    probableEventFit: "cybersecurity demos, channel meetings, enterprise lead generation booth",
    probableBudgetLevel: "high",
    eventFitScore: 80,
    enterpriseScore: 87,
    marketingMaturity: "high",
    strategicNotes: "Cybersecurity vendor with enterprise and channel focus, suitable for technical demos and premium lead qualification at B2B fairs.",
    possibleEvents: ["Futurecom", "Febraban Tech", "Mind The Sec", "Gartner Security", "partner roadshows"],
    probableDepartments: ["field marketing", "events", "channel marketing", "brand", "partnerships"],
    suggestedRoles: ["Field Marketing Manager Brazil", "Channel Marketing Manager", "Events Manager", "Cybersecurity Marketing Lead", "Partner Marketing Manager"],
  },
  {
    company: "CrowdStrike",
    website: "crowdstrike.com",
    segment: "cybersecurity / endpoint / cloud security",
    probableEventFit: "premium security activation, executive meetings, partner ecosystem program",
    probableBudgetLevel: "enterprise",
    eventFitScore: 82,
    enterpriseScore: 91,
    marketingMaturity: "enterprise",
    strategicNotes: "High-growth enterprise security brand with strong field marketing and executive buyer focus.",
    possibleEvents: ["Futurecom", "Mind The Sec", "Febraban Tech", "Gartner Security", "security roadshows"],
    probableDepartments: ["field marketing", "events", "brand", "partnerships", "demand generation"],
    suggestedRoles: ["Field Marketing Manager LATAM", "Events Marketing Manager", "Partner Marketing Manager", "Demand Generation Manager", "Regional Marketing Director"],
  },
  {
    company: "Okta",
    website: "okta.com",
    segment: "identity security / enterprise software",
    probableEventFit: "identity security demos, CISO meetings, partner activation",
    probableBudgetLevel: "high",
    eventFitScore: 76,
    enterpriseScore: 88,
    marketingMaturity: "high",
    strategicNotes: "Enterprise identity brand with relevance for cybersecurity, cloud migration, and regulated industries.",
    possibleEvents: ["Futurecom", "Mind The Sec", "Febraban Tech", "Gartner Security", "CIO events"],
    probableDepartments: ["field marketing", "events", "partner marketing", "brand", "demand generation"],
    suggestedRoles: ["Field Marketing Manager", "Partner Marketing Manager", "Events Manager", "Security Marketing Lead", "Enterprise Marketing Manager"],
  },
  {
    company: "Mandiant",
    website: "mandiant.com",
    segment: "cybersecurity / threat intelligence",
    probableEventFit: "security thought leadership, executive briefings, premium CISO meetings",
    probableBudgetLevel: "enterprise",
    eventFitScore: 78,
    enterpriseScore: 90,
    marketingMaturity: "enterprise",
    strategicNotes: "High-value cybersecurity narrative for executive roundtables, threat briefings, and enterprise security events.",
    possibleEvents: ["Futurecom", "Mind The Sec", "Febraban Tech", "security executive forums", "CISO roundtables"],
    probableDepartments: ["field marketing", "events", "brand", "partnerships", "corporate events"],
    suggestedRoles: ["Field Marketing Manager LATAM", "Events Manager", "Security Marketing Lead", "Brand Manager", "Partnerships Manager"],
  },
  {
    company: "Akamai",
    website: "akamai.com",
    segment: "edge cloud / cybersecurity / CDN",
    probableEventFit: "edge security demos, enterprise networking content, partner meetings",
    probableBudgetLevel: "enterprise",
    eventFitScore: 81,
    enterpriseScore: 89,
    marketingMaturity: "enterprise",
    strategicNotes: "Relevant for cloud, security, connectivity, and edge narratives with B2B buyers.",
    possibleEvents: ["Futurecom", "Febraban Tech", "Mind The Sec", "IT Forum", "cloud roadshows"],
    probableDepartments: ["field marketing", "events", "partner marketing", "brand", "demand generation"],
    suggestedRoles: ["Field Marketing Manager Brazil", "Partner Marketing Manager", "Events Marketing Manager", "Enterprise Marketing Manager", "Regional Marketing Lead"],
  },
  {
    company: "Cloudflare",
    website: "cloudflare.com",
    segment: "connectivity cloud / cybersecurity / edge",
    probableEventFit: "network and security demos, developer and enterprise activation, partner meetings",
    probableBudgetLevel: "enterprise",
    eventFitScore: 82,
    enterpriseScore: 90,
    marketingMaturity: "enterprise",
    strategicNotes: "Strong fit for connectivity, security, zero trust, edge, and enterprise internet infrastructure narratives.",
    possibleEvents: ["Futurecom", "Web Summit Rio", "Febraban Tech", "Mind The Sec", "developer events"],
    probableDepartments: ["field marketing", "events", "brand", "partnerships", "developer relations"],
    suggestedRoles: ["Field Marketing Manager LATAM", "Events Marketing Manager", "Partner Marketing Manager", "Developer Relations Lead", "Enterprise Marketing Lead"],
  },
  {
    company: "Datadog",
    website: "datadoghq.com",
    segment: "observability / cloud monitoring / data analytics",
    probableEventFit: "technical demos, developer and enterprise lead generation, cloud operations content",
    probableBudgetLevel: "high",
    eventFitScore: 75,
    enterpriseScore: 87,
    marketingMaturity: "high",
    strategicNotes: "Enterprise software vendor with a strong demo-led event motion around cloud operations and observability.",
    possibleEvents: ["Futurecom", "AWS Summit Sao Paulo", "Febraban Tech", "developer events", "CIO forums"],
    probableDepartments: ["field marketing", "events", "demand generation", "partnerships", "developer relations"],
    suggestedRoles: ["Field Marketing Manager LATAM", "Demand Generation Manager", "Events Marketing Manager", "Partner Marketing Manager", "Developer Marketing Lead"],
  },
  {
    company: "Snowflake",
    website: "snowflake.com",
    segment: "data cloud / analytics / AI",
    probableEventFit: "data and AI demos, enterprise roundtables, partner ecosystem activation",
    probableBudgetLevel: "enterprise",
    eventFitScore: 81,
    enterpriseScore: 91,
    marketingMaturity: "enterprise",
    strategicNotes: "Enterprise data cloud vendor with strong executive event potential around data sharing, AI, analytics, and partner use cases.",
    possibleEvents: ["Futurecom", "Febraban Tech", "Data Driven Experience", "AWS Summit Sao Paulo", "CIO forums"],
    probableDepartments: ["field marketing", "events", "partner marketing", "brand", "demand generation"],
    suggestedRoles: ["Field Marketing Manager Brazil", "Partner Marketing Manager", "Events Marketing Manager", "Data Cloud Marketing Lead", "Regional Marketing Director"],
  },
  {
    company: "Databricks",
    website: "databricks.com",
    segment: "data / AI / analytics platform",
    probableEventFit: "AI and data lakehouse demos, executive content, technical workshops",
    probableBudgetLevel: "enterprise",
    eventFitScore: 82,
    enterpriseScore: 91,
    marketingMaturity: "enterprise",
    strategicNotes: "Strong enterprise AI and data platform narrative, relevant for technology, telecom, finance, and digital transformation audiences.",
    possibleEvents: ["Futurecom", "Data + AI World Tour", "Febraban Tech", "AWS Summit Sao Paulo", "CIO forums"],
    probableDepartments: ["field marketing", "events", "brand", "partnerships", "demand generation"],
    suggestedRoles: ["Field Marketing Manager LATAM", "Events Marketing Manager", "Partner Marketing Manager", "AI Marketing Lead", "Regional Marketing Director"],
  },
  {
    company: "SAS",
    website: "sas.com/pt_br",
    segment: "analytics / AI / enterprise software",
    probableEventFit: "analytics demos, executive meetings, industry-specific use cases",
    probableBudgetLevel: "enterprise",
    eventFitScore: 78,
    enterpriseScore: 89,
    marketingMaturity: "enterprise",
    strategicNotes: "Established enterprise analytics player with strong presence in regulated industries and executive buyer programs.",
    possibleEvents: ["Futurecom", "Febraban Tech", "analytics forums", "CIO events", "industry roadshows"],
    probableDepartments: ["field marketing", "events", "brand", "partnerships", "corporate events"],
    suggestedRoles: ["Marketing Director Brazil", "Field Marketing Manager", "Events Manager", "Analytics Marketing Lead", "Partner Marketing Manager"],
  },
  {
    company: "SAS Institute",
    website: "sas.com",
    segment: "data analytics / AI / decision intelligence",
    probableEventFit: "enterprise analytics showcase, executive roundtables, partner activation",
    probableBudgetLevel: "enterprise",
    eventFitScore: 77,
    enterpriseScore: 89,
    marketingMaturity: "enterprise",
    strategicNotes: "Enterprise analytics vendor with premium buyer audiences in banking, government, telecom, and industry.",
    possibleEvents: ["Futurecom", "Febraban Tech", "analytics summits", "CIO forums", "AI events"],
    probableDepartments: ["marketing", "events", "brand", "partnerships", "field marketing"],
    suggestedRoles: ["Field Marketing Manager", "Events Manager", "Brand Manager", "Partner Marketing Manager", "Enterprise Marketing Director"],
  },
  {
    company: "NVIDIA",
    website: "nvidia.com/pt-br",
    segment: "AI infrastructure / accelerated computing",
    probableEventFit: "AI infrastructure showcase, partner demos, executive innovation content",
    probableBudgetLevel: "enterprise",
    eventFitScore: 88,
    enterpriseScore: 96,
    marketingMaturity: "enterprise",
    strategicNotes: "High-demand AI infrastructure brand with strong partner ecosystem and major event relevance across telecom, cloud, enterprise, and industry.",
    possibleEvents: ["Futurecom", "Web Summit Rio", "Febraban Tech", "AI events", "partner roadshows"],
    probableDepartments: ["field marketing", "events", "brand", "partnerships", "developer relations"],
    suggestedRoles: ["Field Marketing Manager LATAM", "Partner Marketing Manager", "Events Marketing Manager", "Developer Relations Lead", "AI Marketing Lead"],
  },
  {
    company: "AMD",
    website: "amd.com/pt",
    segment: "semiconductors / AI infrastructure / enterprise computing",
    probableEventFit: "AI compute demos, partner ecosystem activation, executive showcase",
    probableBudgetLevel: "enterprise",
    eventFitScore: 80,
    enterpriseScore: 94,
    marketingMaturity: "enterprise",
    strategicNotes: "Enterprise computing and AI infrastructure brand with strong partner-led event potential.",
    possibleEvents: ["Futurecom", "Febraban Tech", "partner roadshows", "AI infrastructure events", "CIO forums"],
    probableDepartments: ["field marketing", "events", "partner marketing", "brand", "channel marketing"],
    suggestedRoles: ["Field Marketing Manager LATAM", "Partner Marketing Manager", "Channel Marketing Manager", "Events Manager", "Enterprise Marketing Lead"],
  },
  {
    company: "Qualcomm",
    website: "qualcomm.com",
    segment: "semiconductors / 5G / IoT / edge AI",
    probableEventFit: "5G and edge AI showcase, partner demos, innovation content",
    probableBudgetLevel: "enterprise",
    eventFitScore: 86,
    enterpriseScore: 94,
    marketingMaturity: "enterprise",
    strategicNotes: "Strong Futurecom fit via 5G, IoT, edge AI, devices, and ecosystem partnerships.",
    possibleEvents: ["Futurecom", "MWC", "Web Summit Rio", "Smart City Expo Curitiba", "IoT events"],
    probableDepartments: ["field marketing", "events", "brand", "partnerships", "corporate events"],
    suggestedRoles: ["Marketing Director LATAM", "Events Manager", "Partner Marketing Manager", "Brand Experience Manager", "IoT Marketing Lead"],
  },
  {
    company: "Juniper Networks",
    website: "juniper.net",
    segment: "networking / telecom infrastructure / cybersecurity",
    probableEventFit: "networking demos, telecom cloud and enterprise connectivity showcase",
    probableBudgetLevel: "enterprise",
    eventFitScore: 85,
    enterpriseScore: 90,
    marketingMaturity: "enterprise",
    strategicNotes: "High-fit vendor for carrier networking, enterprise networking, security, and technical demos.",
    possibleEvents: ["Futurecom", "MWC", "ABRINT", "Febraban Tech", "networking forums"],
    probableDepartments: ["field marketing", "events", "partner marketing", "channel marketing", "brand"],
    suggestedRoles: ["Field Marketing Manager Brazil", "Channel Marketing Manager", "Partner Marketing Manager", "Events Manager", "Enterprise Networking Marketing Lead"],
  },
  {
    company: "Arista Networks",
    website: "arista.com",
    segment: "cloud networking / data center infrastructure",
    probableEventFit: "data center networking demos, enterprise and cloud meetings",
    probableBudgetLevel: "enterprise",
    eventFitScore: 79,
    enterpriseScore: 88,
    marketingMaturity: "high",
    strategicNotes: "Relevant for cloud networking, data center, AI infrastructure, and enterprise connectivity audiences.",
    possibleEvents: ["Futurecom", "Data Center Dynamics Brasil", "Febraban Tech", "cloud infrastructure forums", "CIO events"],
    probableDepartments: ["field marketing", "events", "partner marketing", "channel marketing", "brand"],
    suggestedRoles: ["Field Marketing Manager LATAM", "Channel Marketing Manager", "Events Manager", "Partner Marketing Manager", "Data Center Marketing Lead"],
  },
  {
    company: "Extreme Networks",
    website: "extremenetworks.com",
    segment: "enterprise networking / cloud networking",
    probableEventFit: "networking demos, channel activation, enterprise connectivity booth",
    probableBudgetLevel: "high",
    eventFitScore: 77,
    enterpriseScore: 84,
    marketingMaturity: "high",
    strategicNotes: "Good fit for events focused on enterprise connectivity, Wi-Fi, cloud networking, and partner channels.",
    possibleEvents: ["Futurecom", "ABRINT", "Febraban Tech", "networking events", "partner roadshows"],
    probableDepartments: ["field marketing", "events", "channel marketing", "partnerships", "brand"],
    suggestedRoles: ["Field Marketing Manager", "Channel Marketing Manager", "Events Manager", "Partner Marketing Manager", "Enterprise Marketing Lead"],
  },
  {
    company: "Lumen Technologies",
    website: "lumen.com",
    segment: "connectivity / edge cloud / enterprise network services",
    probableEventFit: "enterprise connectivity showcase, executive meetings, network services positioning",
    probableBudgetLevel: "enterprise",
    eventFitScore: 83,
    enterpriseScore: 91,
    marketingMaturity: "enterprise",
    strategicNotes: "Enterprise network services provider with strong fit for connectivity, edge, cloud, and managed services conversations.",
    possibleEvents: ["Futurecom", "Capacity LATAM", "Febraban Tech", "IT Forum", "CIO events"],
    probableDepartments: ["marketing", "events", "brand", "partnerships", "field marketing"],
    suggestedRoles: ["Marketing Manager Brazil", "Events Manager", "Field Marketing Manager", "Partnerships Manager", "Enterprise Marketing Director"],
  },
  {
    company: "Cirion Technologies",
    website: "ciriontechnologies.com",
    segment: "data center / connectivity / cloud infrastructure",
    probableEventFit: "connectivity and data center showcase, executive meetings, enterprise hospitality",
    probableBudgetLevel: "enterprise",
    eventFitScore: 86,
    enterpriseScore: 90,
    marketingMaturity: "enterprise",
    strategicNotes: "Strong LATAM infrastructure brand with connectivity, cloud, security, and data center narratives relevant to Futurecom.",
    possibleEvents: ["Futurecom", "Data Center Dynamics Brasil", "Capacity LATAM", "Febraban Tech", "CIO forums"],
    probableDepartments: ["marketing", "events", "brand", "partnerships", "field marketing"],
    suggestedRoles: ["Marketing Director Brazil", "Field Marketing Manager", "Events Manager", "Brand Manager", "Partnerships Manager"],
  },
  {
    company: "Scala Data Centers",
    website: "scaladatacenters.com",
    segment: "data centers / digital infrastructure",
    probableEventFit: "infrastructure positioning, executive meetings, sustainability and hyperscale content",
    probableBudgetLevel: "enterprise",
    eventFitScore: 82,
    enterpriseScore: 89,
    marketingMaturity: "high",
    strategicNotes: "Large data center operator with enterprise and hyperscale audience, strong fit for premium meeting environments.",
    possibleEvents: ["Futurecom", "Data Center Dynamics Brasil", "Capacity LATAM", "cloud infrastructure forums", "CIO events"],
    probableDepartments: ["marketing", "events", "brand", "partnerships", "corporate communications"],
    suggestedRoles: ["Marketing Manager", "Events Manager", "Brand Manager", "Corporate Communications Manager", "Partnerships Director"],
  },
  {
    company: "ODATA",
    website: "odatacolocation.com",
    segment: "data centers / colocation / digital infrastructure",
    probableEventFit: "data center showcase, executive meetings, cloud connectivity positioning",
    probableBudgetLevel: "enterprise",
    eventFitScore: 79,
    enterpriseScore: 87,
    marketingMaturity: "high",
    strategicNotes: "Data center and colocation provider relevant to cloud, interconnection, and enterprise infrastructure buyers.",
    possibleEvents: ["Futurecom", "Data Center Dynamics Brasil", "Capacity LATAM", "cloud forums", "CIO events"],
    probableDepartments: ["marketing", "events", "brand", "partnerships", "business development"],
    suggestedRoles: ["Marketing Manager", "Events Manager", "Business Development Director", "Brand Manager", "Partnerships Manager"],
  },
  {
    company: "TIVIT",
    website: "tivit.com",
    segment: "IT services / cloud / cybersecurity / digital transformation",
    probableEventFit: "enterprise services booth, transformation content, account meetings",
    probableBudgetLevel: "enterprise",
    eventFitScore: 80,
    enterpriseScore: 88,
    marketingMaturity: "high",
    strategicNotes: "Brazilian enterprise IT services player with event potential across cloud, cybersecurity, managed services, and digital transformation.",
    possibleEvents: ["Futurecom", "Febraban Tech", "IT Forum", "CIO forums", "cloud roadshows"],
    probableDepartments: ["marketing", "events", "brand", "partnerships", "field marketing"],
    suggestedRoles: ["Marketing Director", "Field Marketing Manager", "Events Manager", "Brand Manager", "Partner Marketing Manager"],
  },
  {
    company: "CI&T",
    website: "ciandt.com",
    segment: "digital transformation / software engineering / data",
    probableEventFit: "enterprise transformation showcase, executive content, client experience activation",
    probableBudgetLevel: "enterprise",
    eventFitScore: 77,
    enterpriseScore: 88,
    marketingMaturity: "enterprise",
    strategicNotes: "Enterprise digital services company with strong positioning for transformation, AI, data, and customer experience.",
    possibleEvents: ["Futurecom", "Febraban Tech", "Web Summit Rio", "IT Forum", "digital transformation events"],
    probableDepartments: ["marketing", "brand", "events", "partnerships", "corporate events"],
    suggestedRoles: ["Marketing Director Brazil", "Brand Experience Manager", "Events Manager", "Partnerships Manager", "Enterprise Marketing Lead"],
  },
  {
    company: "Globant",
    website: "globant.com",
    segment: "digital transformation / AI / software engineering",
    probableEventFit: "innovation showcase, executive experience, transformation content",
    probableBudgetLevel: "enterprise",
    eventFitScore: 78,
    enterpriseScore: 90,
    marketingMaturity: "enterprise",
    strategicNotes: "Global digital services brand with enterprise event profile and strong narratives around AI, software, and transformation.",
    possibleEvents: ["Futurecom", "Web Summit Rio", "Febraban Tech", "IT Forum", "innovation roadshows"],
    probableDepartments: ["marketing", "brand", "events", "partnerships", "experience"],
    suggestedRoles: ["Marketing Director LATAM", "Brand Experience Manager", "Events Manager", "Partnerships Manager", "Field Marketing Manager"],
  },
  {
    company: "Accenture",
    website: "accenture.com/br-pt",
    segment: "consulting / cloud / AI / digital transformation",
    probableEventFit: "premium sponsorship, executive content, enterprise transformation showcase",
    probableBudgetLevel: "enterprise",
    eventFitScore: 86,
    enterpriseScore: 98,
    marketingMaturity: "enterprise",
    strategicNotes: "Large consulting and technology services buyer with high event maturity, executive hospitality needs, and cross-industry transformation narratives.",
    possibleEvents: ["Futurecom", "Febraban Tech", "Web Summit Rio", "IT Forum", "C-level roundtables"],
    probableDepartments: ["marketing", "brand", "events", "partnerships", "corporate events", "experience"],
    suggestedRoles: ["Marketing Director Brazil", "Brand Experience Lead", "Events Manager", "Field Marketing Manager", "Partnerships Director"],
  },
  {
    company: "Deloitte",
    website: "deloitte.com/br",
    segment: "consulting / cybersecurity / data / digital transformation",
    probableEventFit: "executive content, thought leadership, hospitality and client meetings",
    probableBudgetLevel: "enterprise",
    eventFitScore: 80,
    enterpriseScore: 96,
    marketingMaturity: "enterprise",
    strategicNotes: "High event maturity and enterprise buyer audience, with relevant themes in cyber, AI, analytics, cloud, and transformation.",
    possibleEvents: ["Futurecom", "Febraban Tech", "IT Forum", "CIO forums", "industry roundtables"],
    probableDepartments: ["marketing", "brand", "events", "partnerships", "corporate events"],
    suggestedRoles: ["Marketing Director", "Events Manager", "Brand Experience Manager", "Partnerships Manager", "Client Experience Lead"],
  },
  {
    company: "KPMG",
    website: "kpmg.com/br",
    segment: "consulting / cybersecurity / data / transformation",
    probableEventFit: "thought leadership, executive meetings, enterprise transformation content",
    probableBudgetLevel: "enterprise",
    eventFitScore: 77,
    enterpriseScore: 95,
    marketingMaturity: "enterprise",
    strategicNotes: "Large professional services firm with event programs around digital transformation, risk, cyber, and data.",
    possibleEvents: ["Futurecom", "Febraban Tech", "IT Forum", "C-level forums", "industry roundtables"],
    probableDepartments: ["marketing", "events", "brand", "partnerships", "corporate events"],
    suggestedRoles: ["Marketing Director Brazil", "Events Manager", "Brand Manager", "Client Experience Manager", "Partnerships Lead"],
  },
  {
    company: "EY",
    website: "ey.com/pt_br",
    segment: "consulting / technology transformation / data",
    probableEventFit: "executive content, client meetings, transformation showcases",
    probableBudgetLevel: "enterprise",
    eventFitScore: 77,
    enterpriseScore: 95,
    marketingMaturity: "enterprise",
    strategicNotes: "Strong enterprise brand with technology consulting, cybersecurity, data, and transformation event themes.",
    possibleEvents: ["Futurecom", "Febraban Tech", "IT Forum", "C-level forums", "industry roundtables"],
    probableDepartments: ["marketing", "events", "brand", "partnerships", "corporate events"],
    suggestedRoles: ["Marketing Director Brazil", "Events Manager", "Brand Experience Manager", "Partnerships Manager", "Client Experience Lead"],
  },
  {
    company: "PwC Brasil",
    website: "pwc.com.br",
    segment: "consulting / digital transformation / cybersecurity / data",
    probableEventFit: "thought leadership, executive hospitality, enterprise client meetings",
    probableBudgetLevel: "enterprise",
    eventFitScore: 76,
    enterpriseScore: 95,
    marketingMaturity: "enterprise",
    strategicNotes: "Enterprise services brand with relevant themes around AI, cyber, data, risk, and digital transformation.",
    possibleEvents: ["Futurecom", "Febraban Tech", "IT Forum", "C-level forums", "industry roundtables"],
    probableDepartments: ["marketing", "events", "brand", "partnerships", "corporate events"],
    suggestedRoles: ["Marketing Director", "Events Manager", "Brand Manager", "Partnerships Lead", "Client Experience Manager"],
  },
];

function ensureDir(path: string) {
  mkdirSync(path, { recursive: true });
}

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function localDateKey(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function localTimeMinutes(date: Date) {
  return date.getHours() * 60 + date.getMinutes();
}

function isWeekday(date: Date) {
  const day = date.getDay();
  return day >= 1 && day <= 5;
}

function scheduledTimeReached(date: Date) {
  return localTimeMinutes(date) >= RUN_HOUR * 60 + RUN_MINUTE;
}

function normalizeCompany(company: string) {
  return company
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(brasil|brazil|technologies|technology|networks|solutions|inc|ltda|sa|s a)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function companyHash(company: string) {
  return createHash("sha256").update(normalizeCompany(company)).digest("hex");
}

function collectJsonFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) files.push(...collectJsonFiles(path));
    if (stats.isFile() && extname(entry).toLowerCase() === ".json") files.push(path);
  }
  return files;
}

function collectCompanyNames(value: unknown, output: Set<string>) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectCompanyNames(item, output);
    return;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.company === "string" && record.company.trim()) {
    output.add(normalizeCompany(record.company));
  }

  for (const key of ["leads", "companies", "entries"]) {
    collectCompanyNames(record[key], output);
  }
}

function loadKnownCompanies() {
  const known = new Set<string>();
  for (const file of collectJsonFiles(LEADS_ROOT)) {
    const json = readJson<unknown>(file, null);
    collectCompanyNames(json, known);
  }
  return known;
}

function validateLead(lead: EnterpriseLead) {
  const errors: string[] = [];
  const requiredText: Array<keyof EnterpriseLead> = [
    "company",
    "website",
    "segment",
    "probableEventFit",
    "probableBudgetLevel",
    "marketingMaturity",
    "strategicNotes",
  ];

  for (const field of requiredText) {
    if (typeof lead[field] !== "string" || String(lead[field]).trim().length === 0) {
      errors.push(`${lead.company || "unknown"} missing ${field}`);
    }
  }

  for (const field of ["eventFitScore", "enterpriseScore"] as const) {
    const value = lead[field];
    if (!Number.isInteger(value) || value < 0 || value > 100) {
      errors.push(`${lead.company || "unknown"} invalid ${field}`);
    }
  }

  for (const field of ["possibleEvents", "probableDepartments", "suggestedRoles"] as const) {
    if (!Array.isArray(lead[field]) || lead[field].length === 0 || lead[field].some((item) => typeof item !== "string" || !item.trim())) {
      errors.push(`${lead.company || "unknown"} invalid ${field}`);
    }
  }

  if (lead.enterpriseScore < 75 || lead.eventFitScore < 70) {
    errors.push(`${lead.company || "unknown"} below enterprise/event threshold`);
  }

  return errors;
}

function inferArea(lead: EnterpriseLead) {
  const departments = lead.probableDepartments.map((department) => department.toLowerCase());
  if (departments.some((department) => department.includes("field"))) return "field marketing";
  if (departments.some((department) => department.includes("brand"))) return "brand";
  if (departments.some((department) => department.includes("event"))) return "events";
  if (departments.some((department) => department.includes("partnership"))) return "partnerships";
  return "marketing";
}

function inferRole(lead: EnterpriseLead) {
  return lead.suggestedRoles[0] ?? "Marketing Events Lead";
}

function inferSeniority(role: string, lead: EnterpriseLead): DailyValidatedLead["seniority"] {
  const normalized = role.toLowerCase();
  if (normalized.includes("head") || normalized.includes("director") || normalized.includes("diretor")) return "director";
  if (lead.enterpriseScore >= 96 && lead.eventFitScore >= 88) return "director";
  return "manager";
}

function contactAliasForArea(area: string) {
  if (area.includes("field")) return "Field Marketing";
  if (area.includes("brand")) return "Brand Experience";
  if (area.includes("partnership")) return "Partner Marketing";
  if (area.includes("event")) return "Corporate Events";
  return "Marketing Events";
}

function bounceRiskFromConfidence(confidence: "high" | "medium" | "low"): BounceRisk {
  if (confidence === "high") return "low";
  if (confidence === "medium") return "medium";
  return "high";
}

function fitLabel(score: number): DailyValidatedLead["strategicFit"] {
  if (score >= 90) return "excellent";
  if (score >= 82) return "strong";
  if (score >= 74) return "moderate";
  return "weak";
}

function statusFromScores(outreachPriority: number, bounceRisk: BounceRisk): LeadStatus {
  if (bounceRisk === "high") return "LOW_PRIORITY";
  if (outreachPriority >= 90) return "HOT";
  if (outreachPriority >= 76) return "WARM";
  return "LOW_PRIORITY";
}

function enrichLead(lead: EnterpriseLead): DailyValidatedLead {
  const area = inferArea(lead);
  const role = inferRole(lead);
  const seniority = inferSeniority(role, lead);
  const contactName = contactAliasForArea(area);
  const emailResult = emailPatternResolver.resolve({
    name: contactName,
    company: lead.company,
    website: lead.website,
  });
  const guessedEmails = emailResult.guessedEmails;
  const primaryEmail = guessedEmails[0]?.email ?? "";
  const confidence = emailResult.confidence;
  const bounceRisk = bounceRiskFromConfidence(confidence);
  const outreachPriority = Math.round((lead.eventFitScore + lead.enterpriseScore) / 2);
  const status = statusFromScores(outreachPriority, bounceRisk);

  return {
    ...lead,
    contactName,
    role,
    area,
    seniority,
    linkedin: "not_enriched",
    guessedEmails,
    primaryEmail,
    confidence,
    bounceRisk,
    deliverabilityStatus: primaryEmail ? "heuristic_valid" : "invalid",
    emailDomain: emailResult.domain,
    emailDomainSource: emailResult.domainSource,
    emailPattern: emailResult.pattern,
    relevanceScore: lead.eventFitScore,
    strategicFitScore: lead.enterpriseScore,
    outreachPriority,
    strategicFit: fitLabel(outreachPriority),
    recommendedTemplate: seniority === "director" ? "executive-intro" : "cold-outreach",
    recommendedApproach: `Abordar ${lead.company} pelo contexto de ${lead.probableEventFit}, conectando VRASHOWS a operação premium de eventos B2B.`,
    recommendedCTA: "Podemos conversar por 15 minutos?",
    status,
    validatedAt: new Date().toISOString(),
  };
}

function buildDailyLeads(poolRotated = false) {
  const localCache = getIALeadsCache();
  const state = loadState();
  const knownCompanies = loadKnownCompanies();
  const processedHashes = new Set(state.processedCompanyHashes ?? []);
  const selected: DailyValidatedLead[] = [];
  const selectedHashes: string[] = [];
  let duplicatesRemoved = 0;
  const errors: string[] = [];
  const seenToday = new Set<string>();

  const sorted = [...candidatePool].sort((a, b) => {
    const scoreA = a.eventFitScore + a.enterpriseScore;
    const scoreB = b.eventFitScore + b.enterpriseScore;
    return scoreB - scoreA;
  });

  for (const candidate of sorted) {
    const normalized = normalizeCompany(candidate.company);
    const hash = companyHash(candidate.company);
    if (
      knownCompanies.has(normalized) ||
      processedHashes.has(hash) ||
      seenToday.has(normalized) ||
      localCache.companyExists(candidate.company)
    ) {
      duplicatesRemoved += 1;
      continue;
    }

    const validationErrors = validateLead(candidate);
    if (validationErrors.length > 0) {
      errors.push(...validationErrors);
      continue;
    }

    selected.push(enrichLead(candidate));
    localCache.upsertCompany({
      company: candidate.company,
      website: candidate.website,
      segment: candidate.segment,
      status: "acquired",
      metadata: {
        eventFitScore: candidate.eventFitScore,
        enterpriseScore: candidate.enterpriseScore,
      },
    });
    selectedHashes.push(hash);
    seenToday.add(normalized);
    if (selected.length >= MAX_DAILY_LEADS) break;
  }

  // Pool exausto: todos os candidatos já foram processados → rotacionar
  if (selected.length === 0 && duplicatesRemoved >= candidatePool.length && !poolRotated) {
    const cleared = localCache.clearAcquiredCompanies();
    saveState({ ...state, processedCompanyHashes: [] });
    appendLog({
      timestamp: new Date().toISOString(),
      date: localDateKey(new Date()),
      status: "skipped",
      leads: 0,
      duplicatesRemoved,
      errors: [],
      executionTimeMs: 0,
      reason: `pool_rotated: cleared ${cleared} entries from cache, restarting cycle`,
    });
    return buildDailyLeads(true);
  }

  return { leads: selected, selectedHashes, duplicatesRemoved, errors };
}

function appendLog(event: LogEvent) {
  ensureDir(dirname(LOG_FILE));
  appendFileSync(LOG_FILE, `${JSON.stringify(event)}\n`, "utf8");
}

function loadState(): SchedulerState {
  return readJson<SchedulerState>(STATE_FILE, {});
}

function saveState(state: SchedulerState) {
  ensureDir(dirname(STATE_FILE));
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

function outputPathFor(dateKey: string) {
  return resolve(FUTURECOM_DIR, `futurecom-expansion-${dateKey}.json`);
}

function shortStrategicNotes(notes: string) {
  const firstSentence = notes.split(/(?<=[.!?])\s+/)[0]?.trim() || notes.trim();
  return firstSentence.length <= SHORT_NOTES_MAX_CHARS
    ? firstSentence
    : `${firstSentence.slice(0, SHORT_NOTES_MAX_CHARS - 1).trim()}.`;
}

function toMinimalLead(lead: DailyValidatedLead): MinimalAcquisitionLead {
  return {
    company: lead.company,
    website: lead.website,
    segment: lead.segment,
    eventFitScore: lead.eventFitScore,
    strategicNotes: shortStrategicNotes(lead.strategicNotes),
  };
}

function shouldRun(now: Date, force: boolean) {
  const dateKey = localDateKey(now);
  const state = loadState();
  const outPath = outputPathFor(dateKey);

  if (!force && !isWeekday(now)) {
    return { ok: false, reason: "weekend_block", dateKey, outPath };
  }
  if (!force && !scheduledTimeReached(now)) {
    return { ok: false, reason: "before_07:30", dateKey, outPath };
  }
  if (!force && (state.lastRunDate === dateKey || existsSync(outPath))) {
    return { ok: false, reason: "already_executed_today", dateKey, outPath };
  }

  return { ok: true, dateKey, outPath };
}

function writeAcquisitionFile(dateKey: string, outPath: string, leads: DailyValidatedLead[], duplicatesRemoved: number) {
  const generatedAt = new Date().toISOString();
  const minimalLeads = leads.map(toMinimalLead);
  const payload: AcquisitionFile = {
    _meta: {
      description: "Daily Futurecom enterprise expansion leads - VRASHOWS premium outbound acquisition",
      generatedAt,
      mode: "cheap/minimal-json/manual-curated",
      date: dateKey,
      duplicatesRemoved,
      contactsEnriched: minimalLeads.length,
      emailValidation: "disabled in acquisition cheap mode",
      schemaValidated: true,
      maxDailyLeads: MAX_DAILY_LEADS,
      cheapMode: true,
    },
    campaign: "futurecom-2026-enterprise-daily-acquisition",
    targetEvent: "Futurecom 2026",
    generatedAt,
    totalLeads: minimalLeads.length,
    leads: minimalLeads,
  };

  ensureDir(FUTURECOM_DIR);
  writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");
}

async function runOnce(opts: { force?: boolean; now?: Date } = {}) {
  const start = Date.now();
  const now = opts.now ?? new Date();
  const gate = shouldRun(now, opts.force ?? false);

  if (!gate.ok) {
    const event: LogEvent = {
      timestamp: new Date().toISOString(),
      date: gate.dateKey,
      status: "skipped",
      leads: 0,
      duplicatesRemoved: 0,
      errors: [],
      executionTimeMs: Date.now() - start,
      reason: gate.reason,
    };
    appendLog(event);
    getIALeadsCache().log("lead-acquisition", "run_skipped", { ...event });
    recordAnalytics({
      provider: "runtime",
      source: "lead-acquisition",
      requests: 1,
      metadata: { reason: gate.reason },
    });
    console.log(JSON.stringify(event));
    return event;
  }

  try {
    const { leads, selectedHashes, duplicatesRemoved, errors } = buildDailyLeads();
    if (errors.length > 0) {
      throw new Error(errors.join("; "));
    }

    const previousState = loadState();
    const processedCompanyHashes = Array.from(new Set([
      ...(previousState.processedCompanyHashes ?? []),
      ...selectedHashes,
    ]));

    writeAcquisitionFile(gate.dateKey, gate.outPath, leads, duplicatesRemoved);
    const localCache = getIALeadsCache();
    for (const lead of leads) {
      localCache.upsertLead({
        company: lead.company,
        contactName: lead.contactName,
        email: lead.primaryEmail,
        enrichment: toMinimalLead(lead) as unknown as Record<string, unknown>,
        status: "acquired",
      });
      saveLocalMemory({
        collection: "companies",
        content: `${lead.company}: ${lead.segment}, eventFitScore ${lead.eventFitScore}`,
        tags: ["company", lead.segment, "acquisition"],
        metadata: { website: lead.website, date: gate.dateKey },
        id: `company:${lead.company.toLowerCase()}`,
      });
    }
    saveState({
      lastRunDate: gate.dateKey,
      lastOutputFile: gate.outPath,
      updatedAt: new Date().toISOString(),
      processedCompanyHashes,
    });

    const event: LogEvent = {
      timestamp: new Date().toISOString(),
      date: gate.dateKey,
      status: "success",
      leads: leads.length,
      duplicatesRemoved,
      errors: [],
      executionTimeMs: Date.now() - start,
      outputFile: gate.outPath,
    };
    appendLog(event);
    localCache.log("lead-acquisition", "run_success", { ...event });
    recordAnalytics({
      provider: "runtime",
      source: "lead-acquisition",
      requests: 1,
      leadsGenerated: leads.length,
      cacheHits: duplicatesRemoved,
      estimatedSavingsUsd: duplicatesRemoved * 0.005,
      metadata: { outputFile: gate.outPath },
    });
    console.log(JSON.stringify(event));
    return event;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const event: LogEvent = {
      timestamp: new Date().toISOString(),
      date: gate.dateKey,
      status: "error",
      leads: 0,
      duplicatesRemoved: 0,
      errors: [message],
      executionTimeMs: Date.now() - start,
    };
    appendLog(event);
    getIALeadsCache().log("lead-acquisition", "run_error", { ...event });
    recordAnalytics({
      provider: "runtime",
      source: "lead-acquisition",
      requests: 1,
      metadata: { errors: event.errors },
    });
    console.error(JSON.stringify(event));
    return event;
  }
}

function getFlagValue(name: string, args: string[]) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function parseNow(args: string[]) {
  const value = getFlagValue("--now", args);
  if (!value) return new Date();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid --now value: ${value}`);
  }
  return parsed;
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const daemon = args.includes("--daemon");
  const now = parseNow(args);

  if (daemon) {
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      date: localDateKey(now),
      status: "skipped",
      leads: 0,
      duplicatesRemoved: 0,
      errors: [],
      executionTimeMs: 0,
      reason: "daemon_disabled_use_scheduled_task",
    }));
    await runOnce({ force, now });
    return;
  }

  await runOnce({ force, now });
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? "")) {
  await main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    const event: LogEvent = {
      timestamp: new Date().toISOString(),
      date: localDateKey(new Date()),
      status: "error",
      leads: 0,
      duplicatesRemoved: 0,
      errors: [message],
      executionTimeMs: 0,
    };
    appendLog(event);
    console.error(JSON.stringify(event));
    process.exit(1);
  });
}

export { runOnce as runLeadAcquisitionScheduler };
