/**
 * EmailPatternResolver — heuristic corporate email inference.
 *
 * No external API calls. Pure pattern matching + name normalization.
 * Strategies: known company registry → website domain parsing → company name inference.
 */
import type { GuessedEmail, EmailPatternResult } from "./types.js";

// ─── Accent normalization ─────────────────────────────────────────────────────

const ACCENT_MAP: Record<string, string> = {
  á: "a", à: "a", â: "a", ã: "a", ä: "a",
  é: "e", è: "e", ê: "e", ë: "e",
  í: "i", ì: "i", î: "i", ï: "i",
  ó: "o", ò: "o", ô: "o", õ: "o", ö: "o",
  ú: "u", ù: "u", û: "u", ü: "u",
  ç: "c", ñ: "n",
};

// Portuguese articles/prepositions to strip from compound surnames
const PT_ARTICLES = new Set(["da", "de", "do", "das", "dos", "di", "e", "del"]);

// ─── Known company domain registry ───────────────────────────────────────────

type EmailPattern =
  | "firstname.lastname"
  | "flastname"
  | "f.lastname"
  | "firstname"
  | "firstname_lastname"
  | "firstnamelastname";

interface DomainEntry {
  domain: string;
  primaryPattern: EmailPattern;
  patternConfidence: "high" | "medium";
}

const KNOWN_DOMAINS: Record<string, DomainEntry> = {
  // Global hyperscalers / cloud
  "aws":                    { domain: "amazon.com",           primaryPattern: "firstname.lastname", patternConfidence: "high" },
  "amazon web services":    { domain: "amazon.com",           primaryPattern: "firstname.lastname", patternConfidence: "high" },
  "amazon":                 { domain: "amazon.com",           primaryPattern: "firstname.lastname", patternConfidence: "high" },
  "google":                 { domain: "google.com",           primaryPattern: "firstname",          patternConfidence: "medium" },
  "google cloud":           { domain: "google.com",           primaryPattern: "firstname.lastname", patternConfidence: "medium" },
  "microsoft":              { domain: "microsoft.com",        primaryPattern: "firstname.lastname", patternConfidence: "medium" },
  "azure":                  { domain: "microsoft.com",        primaryPattern: "firstname.lastname", patternConfidence: "medium" },
  "meta":                   { domain: "meta.com",             primaryPattern: "firstname.lastname", patternConfidence: "medium" },
  "facebook":               { domain: "fb.com",              primaryPattern: "firstnamelastname",  patternConfidence: "medium" },
  "oracle":                 { domain: "oracle.com",           primaryPattern: "firstname.lastname", patternConfidence: "high" },
  "sap":                    { domain: "sap.com",              primaryPattern: "firstname.lastname", patternConfidence: "high" },
  "salesforce":             { domain: "salesforce.com",       primaryPattern: "firstname.lastname", patternConfidence: "high" },
  "cisco":                  { domain: "cisco.com",            primaryPattern: "flastname",          patternConfidence: "medium" },
  "ibm":                    { domain: "ibm.com",              primaryPattern: "firstname.lastname", patternConfidence: "medium" },
  "dell":                   { domain: "dell.com",             primaryPattern: "firstname.lastname", patternConfidence: "medium" },
  "hp":                     { domain: "hp.com",               primaryPattern: "firstname.lastname", patternConfidence: "medium" },
  "intel":                  { domain: "intel.com",            primaryPattern: "firstname.lastname", patternConfidence: "medium" },
  "qualcomm":               { domain: "qualcomm.com",         primaryPattern: "firstname.lastname", patternConfidence: "medium" },
  "ericsson":               { domain: "ericsson.com",         primaryPattern: "firstname.lastname", patternConfidence: "high" },
  "nokia":                  { domain: "nokia.com",            primaryPattern: "firstname.lastname", patternConfidence: "high" },
  "huawei":                 { domain: "huawei.com",           primaryPattern: "firstname.lastname", patternConfidence: "high" },
  "lenovo":                 { domain: "lenovo.com",           primaryPattern: "firstname.lastname", patternConfidence: "medium" },
  "samsung":                { domain: "samsung.com",          primaryPattern: "firstname.lastname", patternConfidence: "medium" },
  // Brazilian telco
  "claro":                  { domain: "claro.com.br",         primaryPattern: "firstname.lastname", patternConfidence: "high" },
  "vivo":                   { domain: "vivo.com.br",          primaryPattern: "firstname.lastname", patternConfidence: "high" },
  "telefonica":             { domain: "telefonica.com.br",    primaryPattern: "firstname.lastname", patternConfidence: "high" },
  "telefônica":             { domain: "telefonica.com.br",    primaryPattern: "firstname.lastname", patternConfidence: "high" },
  "tim":                    { domain: "tim.com.br",           primaryPattern: "firstname.lastname", patternConfidence: "high" },
  "oi":                     { domain: "oi.com.br",            primaryPattern: "firstname.lastname", patternConfidence: "medium" },
  "embratel":               { domain: "embratel.com.br",      primaryPattern: "firstname.lastname", patternConfidence: "high" },
  "net":                    { domain: "net.com.br",           primaryPattern: "firstname.lastname", patternConfidence: "medium" },
  "algar telecom":          { domain: "algartelecom.com.br",  primaryPattern: "firstname.lastname", patternConfidence: "medium" },
  "algar":                  { domain: "algartelecom.com.br",  primaryPattern: "firstname.lastname", patternConfidence: "medium" },
  "sercomtel":              { domain: "sercomtel.com.br",     primaryPattern: "firstname.lastname", patternConfidence: "medium" },
  // Brazilian enterprise / tech
  "totvs":                  { domain: "totvs.com",            primaryPattern: "firstname.lastname", patternConfidence: "high" },
  "stefanini":              { domain: "stefanini.com",        primaryPattern: "firstname.lastname", patternConfidence: "high" },
  "ci&t":                   { domain: "ciandt.com",           primaryPattern: "firstname.lastname", patternConfidence: "high" },
  "ci and t":               { domain: "ciandt.com",           primaryPattern: "firstname.lastname", patternConfidence: "high" },
  "totvs rafael":           { domain: "totvs.com",            primaryPattern: "firstname.lastname", patternConfidence: "high" },
  "senior sistemas":        { domain: "senior.com.br",        primaryPattern: "firstname.lastname", patternConfidence: "medium" },
  "linx":                   { domain: "linx.com.br",          primaryPattern: "firstname.lastname", patternConfidence: "medium" },
  "nec":                    { domain: "br.nec.com",           primaryPattern: "firstname.lastname", patternConfidence: "medium" },
  "positivo":               { domain: "positivo.com.br",      primaryPattern: "firstname.lastname", patternConfidence: "medium" },
  // Brazilian finance
  "itau":                   { domain: "itau-unibanco.com.br", primaryPattern: "firstname.lastname", patternConfidence: "medium" },
  "itaú":                   { domain: "itau-unibanco.com.br", primaryPattern: "firstname.lastname", patternConfidence: "medium" },
  "bradesco":               { domain: "bradesco.com.br",      primaryPattern: "flastname",          patternConfidence: "medium" },
  "nubank":                 { domain: "nubank.com.br",        primaryPattern: "firstname.lastname", patternConfidence: "high" },
  "mercado livre":          { domain: "mercadolivre.com",     primaryPattern: "firstname.lastname", patternConfidence: "high" },
  "magazine luiza":         { domain: "magazineluiza.com.br", primaryPattern: "firstname.lastname", patternConfidence: "medium" },
  "magalu":                 { domain: "magazineluiza.com.br", primaryPattern: "firstname.lastname", patternConfidence: "medium" },
  // Cybersecurity
  "fortinet":               { domain: "fortinet.com",         primaryPattern: "firstname.lastname", patternConfidence: "high" },
  "check point":            { domain: "checkpoint.com",       primaryPattern: "firstname.lastname", patternConfidence: "high" },
  "checkpoint":             { domain: "checkpoint.com",       primaryPattern: "firstname.lastname", patternConfidence: "high" },
  "palo alto networks":     { domain: "paloaltonetworks.com", primaryPattern: "firstname.lastname", patternConfidence: "high" },
  "palo alto":              { domain: "paloaltonetworks.com", primaryPattern: "firstname.lastname", patternConfidence: "high" },
  "crowdstrike":            { domain: "crowdstrike.com",      primaryPattern: "firstname.lastname", patternConfidence: "high" },
  "sentinelone":            { domain: "sentinelone.com",      primaryPattern: "firstname.lastname", patternConfidence: "high" },
  "trend micro":            { domain: "trendmicro.com",       primaryPattern: "firstname.lastname", patternConfidence: "medium" },
  "kaspersky":              { domain: "kaspersky.com",        primaryPattern: "firstname.lastname", patternConfidence: "medium" },
  // Infrastructure / hardware
  "hpe":                    { domain: "hpe.com",              primaryPattern: "firstname.lastname", patternConfidence: "high" },
  "hewlett packard enterprise": { domain: "hpe.com",          primaryPattern: "firstname.lastname", patternConfidence: "high" },
  "hpe aruba":              { domain: "hpe.com",              primaryPattern: "firstname.lastname", patternConfidence: "high" },
  "juniper":                { domain: "juniper.net",          primaryPattern: "firstname.lastname", patternConfidence: "medium" },
  "juniper networks":       { domain: "juniper.net",          primaryPattern: "firstname.lastname", patternConfidence: "medium" },
  "netgear":                { domain: "netgear.com",          primaryPattern: "firstname.lastname", patternConfidence: "medium" },
  "extreme networks":       { domain: "extremenetworks.com",  primaryPattern: "firstname.lastname", patternConfidence: "medium" },
  "commscope":              { domain: "commscope.com",        primaryPattern: "firstname.lastname", patternConfidence: "medium" },
  "zte":                    { domain: "zte.com.cn",           primaryPattern: "firstname.lastname", patternConfidence: "medium" },
  "zte brasil":             { domain: "zte.com.cn",           primaryPattern: "firstname.lastname", patternConfidence: "medium" },
  // Data centers / colocation
  "equinix":                { domain: "equinix.com",          primaryPattern: "firstname.lastname", patternConfidence: "high" },
  "ascenty":                { domain: "ascenty.com",          primaryPattern: "firstname.lastname", patternConfidence: "high" },
  "odata":                  { domain: "odata.com.br",         primaryPattern: "firstname.lastname", patternConfidence: "medium" },
  "lumen":                  { domain: "lumen.com",            primaryPattern: "firstname.lastname", patternConfidence: "medium" },
  "century link":           { domain: "lumen.com",            primaryPattern: "firstname.lastname", patternConfidence: "medium" },
  // SaaS / enterprise software
  "servicenow":             { domain: "servicenow.com",       primaryPattern: "firstname.lastname", patternConfidence: "high" },
  "vmware":                 { domain: "vmware.com",           primaryPattern: "firstname.lastname", patternConfidence: "high" },
  "nutanix":                { domain: "nutanix.com",          primaryPattern: "firstname.lastname", patternConfidence: "high" },
  "workday":                { domain: "workday.com",          primaryPattern: "firstname.lastname", patternConfidence: "high" },
  "zendesk":                { domain: "zendesk.com",          primaryPattern: "firstname.lastname", patternConfidence: "high" },
  // Brazilian connectivity / ISP
  "v.tal":                  { domain: "vtal.com.br",          primaryPattern: "firstname.lastname", patternConfidence: "medium" },
  "vtal":                   { domain: "vtal.com.br",          primaryPattern: "firstname.lastname", patternConfidence: "medium" },
  "intelbras":              { domain: "intelbras.com.br",     primaryPattern: "firstname.lastname", patternConfidence: "high" },
  "brisanet":               { domain: "brisanet.com.br",      primaryPattern: "firstname.lastname", patternConfidence: "medium" },
  "desktop":                { domain: "desktop.com.br",       primaryPattern: "firstname.lastname", patternConfidence: "medium" },
  "vogel":                  { domain: "vogeltelecom.com.br",  primaryPattern: "firstname.lastname", patternConfidence: "medium" },
  "winity":                 { domain: "winity.com.br",        primaryPattern: "firstname.lastname", patternConfidence: "medium" },
  // Brazilian enterprise IT services
  "wipro":                  { domain: "wipro.com",            primaryPattern: "firstname.lastname", patternConfidence: "medium" },
  "accenture":              { domain: "accenture.com",        primaryPattern: "firstname.lastname", patternConfidence: "medium" },
  "capgemini":              { domain: "capgemini.com",        primaryPattern: "firstname.lastname", patternConfidence: "high" },
  "nttdata":                { domain: "nttdata.com",          primaryPattern: "firstname.lastname", patternConfidence: "medium" },
  "ntt data":               { domain: "nttdata.com",          primaryPattern: "firstname.lastname", patternConfidence: "medium" },
  "cognizant":              { domain: "cognizant.com",        primaryPattern: "firstname.lastname", patternConfidence: "medium" },
  "tcs":                    { domain: "tcs.com",              primaryPattern: "firstname.lastname", patternConfidence: "medium" },
  "tata consultancy":       { domain: "tcs.com",              primaryPattern: "firstname.lastname", patternConfidence: "medium" },
  // IoT / Industry
  "siemens":                { domain: "siemens.com",          primaryPattern: "firstname.lastname", patternConfidence: "medium" },
  "schneider electric":     { domain: "se.com",               primaryPattern: "firstname.lastname", patternConfidence: "medium" },
  "honeywell":              { domain: "honeywell.com",        primaryPattern: "firstname.lastname", patternConfidence: "medium" },
  // Events / media
  "globo":                  { domain: "globo.com",            primaryPattern: "firstname.lastname", patternConfidence: "medium" },
  "record":                 { domain: "rederecord.com.br",    primaryPattern: "firstname.lastname", patternConfidence: "medium" },
  "band":                   { domain: "band.com.br",          primaryPattern: "firstname.lastname", patternConfidence: "medium" },
};

// ─── Name normalization ───────────────────────────────────────────────────────

function normalizeChar(ch: string): string {
  return ACCENT_MAP[ch.toLowerCase()] ?? ch.toLowerCase();
}

function normalizeWord(word: string): string {
  return word.split("").map(normalizeChar).join("").replace(/[^a-z]/g, "");
}

interface NameParts {
  first: string;
  firstInitial: string;
  last: string;
  all: string[];
}

function splitName(fullName: string): NameParts {
  const raw = fullName.trim().split(/[\s-]+/).map(normalizeWord).filter(Boolean);

  if (raw.length === 0) return { first: "unknown", firstInitial: "x", last: "unknown", all: [] };

  const first = raw[0];
  const firstInitial = first[0] ?? "x";

  // Strip Portuguese articles from tail parts to isolate actual surname
  const meaningful = raw.slice(1).filter((w) => !PT_ARTICLES.has(w));
  const last = meaningful[meaningful.length - 1] ?? first;

  return { first, firstInitial, last, all: [first, ...meaningful] };
}

// ─── Domain resolution ────────────────────────────────────────────────────────

interface ResolvedDomain {
  domain: string;
  source: "known" | "website" | "inferred";
  confidence: "high" | "medium" | "low";
  primaryPattern: EmailPattern;
  patternConfidence: "high" | "medium" | "low";
}

function extractDomainFromUrl(url: string): string | null {
  try {
    const cleaned = url.startsWith("http") ? url : `https://${url}`;
    const host = new URL(cleaned).hostname.replace(/^www\./, "");
    if (host === "linkedin.com" || host === "instagram.com" || host === "twitter.com") return null;
    return host || null;
  } catch {
    const m = url.match(/(?:https?:\/\/)?(?:www\.)?([^/\s?#]+)/);
    if (!m) return null;
    const h = m[1].replace(/^www\./, "");
    if (["linkedin.com", "instagram.com"].includes(h)) return null;
    return h;
  }
}

function resolveDomain(
  company: string,
  website?: string,
  domainOverride?: string
): ResolvedDomain {
  if (domainOverride?.includes(".")) {
    return { domain: domainOverride, source: "known", confidence: "high", primaryPattern: "firstname.lastname", patternConfidence: "medium" };
  }

  const key = company.toLowerCase().trim();
  const entry = KNOWN_DOMAINS[key];
  if (entry) {
    return { domain: entry.domain, source: "known", confidence: "high", primaryPattern: entry.primaryPattern, patternConfidence: entry.patternConfidence };
  }

  if (website) {
    const d = extractDomainFromUrl(website);
    if (d) {
      return { domain: d, source: "website", confidence: "medium", primaryPattern: "firstname.lastname", patternConfidence: "medium" };
    }
  }

  // Infer slug-based domain
  const slug = company.toLowerCase().split("").map(normalizeChar).join("").replace(/[^a-z0-9]/g, "").slice(0, 20);
  return { domain: `${slug}.com.br`, source: "inferred", confidence: "low", primaryPattern: "firstname.lastname", patternConfidence: "low" };
}

// ─── Email variant generation ─────────────────────────────────────────────────

function buildEmail(p: EmailPattern, first: string, initial: string, last: string, domain: string): string {
  switch (p) {
    case "firstname.lastname":  return `${first}.${last}@${domain}`;
    case "flastname":           return `${initial}${last}@${domain}`;
    case "f.lastname":          return `${initial}.${last}@${domain}`;
    case "firstname":           return `${first}@${domain}`;
    case "firstname_lastname":  return `${first}_${last}@${domain}`;
    case "firstnamelastname":   return `${first}${last}@${domain}`;
  }
}

function downgrade(c: "high" | "medium" | "low"): "high" | "medium" | "low" {
  return c === "high" ? "medium" : "low";
}

function generateVariants(name: NameParts, domain: ResolvedDomain): GuessedEmail[] {
  const { first, firstInitial, last } = name;
  const d = domain.domain;

  const baseConf = (domain.source === "known" && domain.patternConfidence === "high")
    ? "high"
    : domain.source === "website" ? "medium" : "low";

  const seen = new Set<string>();
  const results: GuessedEmail[] = [];

  const add = (pattern: string, email: string, confidence: "high" | "medium" | "low") => {
    if (!seen.has(email)) {
      seen.add(email);
      results.push({ email, pattern, confidence });
    }
  };

  // Primary pattern first (highest confidence)
  const primaryEmail = buildEmail(domain.primaryPattern, first, firstInitial, last, d);
  add(domain.primaryPattern, primaryEmail, baseConf);

  // All other standard patterns
  const allPatterns: EmailPattern[] = [
    "firstname.lastname", "flastname", "f.lastname",
    "firstname", "firstname_lastname", "firstnamelastname",
  ];
  for (const p of allPatterns) {
    if (p === domain.primaryPattern) continue;
    add(p, buildEmail(p, first, firstInitial, last, d), downgrade(baseConf));
  }

  return results;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface ResolveInput {
  name: string;
  company: string;
  website?: string;
  domain?: string;
}

export class EmailPatternResolver {
  resolve(input: ResolveInput): EmailPatternResult {
    const nameParts = splitName(input.name);
    const resolvedDomain = resolveDomain(input.company, input.website, input.domain);
    const guessedEmails = generateVariants(nameParts, resolvedDomain);

    const confidence =
      nameParts.first === "unknown" ? "low" :
      resolvedDomain.source === "known" && resolvedDomain.patternConfidence === "high" ? "high" :
      resolvedDomain.source === "website" || resolvedDomain.source === "known" ? "medium" :
      "low";

    const reasoning = [
      resolvedDomain.source === "known"
        ? `Domain ${resolvedDomain.domain} verified in company registry (pattern: ${resolvedDomain.primaryPattern}, pattern confidence: ${resolvedDomain.patternConfidence}).`
        : resolvedDomain.source === "website"
        ? `Domain ${resolvedDomain.domain} extracted from company website.`
        : `Domain ${resolvedDomain.domain} inferred from company name slug — not verified.`,
      `Name parts: first="${nameParts.first}", last="${nameParts.last}".`,
      `Generated ${guessedEmails.length} email variants. Top candidate: ${guessedEmails[0]?.email ?? "none"}.`,
      `Overall confidence: ${confidence}.`,
    ].join(" ");

    return {
      domain: resolvedDomain.domain,
      domainSource: resolvedDomain.source,
      pattern: resolvedDomain.primaryPattern,
      guessedEmails,
      confidence,
      reasoning,
    };
  }
}

export const emailPatternResolver = new EmailPatternResolver();
