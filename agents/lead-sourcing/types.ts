import type { LeadSegment } from "../futurecom-researcher/types.js";

export type BoothComplexity = "standard" | "custom" | "large" | "mega";
export type BudgetPotential = "medium" | "high" | "enterprise";

export interface SeedContact {
  name: string;
  role: string;
  area: string;
  seniority: string;
  linkedin?: string;
}

export interface SeedCompany {
  company: string;
  segment: LeadSegment;
  website: string;
  boothComplexity: BoothComplexity;
  budgetPotential: BudgetPotential;
  eventFitScore: number;
  events: string[];
  strategicNotes: string;
  contacts: SeedContact[];
}

export interface SeedFile {
  _meta: { description: string; updatedAt: string; version: string };
  companies: SeedCompany[];
}

export interface SourcingReport {
  runAt: string;
  companiesProcessed: number;
  contactsResolved: number;
  hot: number;
  warm: number;
  lowPriority: number;
  invalid: number;
  queueFile: string;
  validatedFile: string;
  avgQualityScore: number;
}
