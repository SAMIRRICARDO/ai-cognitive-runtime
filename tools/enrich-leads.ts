/**
 * enrich_company — Enriquecimento de empresas com decisores B2B.
 * Chama o LeadEnrichmentAgent para encontrar nome, cargo, email e LinkedIn
 * dos principais decisores nas empresas indicadas.
 */
import type { ToolHandler } from "../agents/_base/types.js";

export const enrichLeadsTool: ToolHandler = {
  name: "enrich_company",
  schema: {
    name: "enrich_company",
    description:
      "Enriquece empresas com perfis de decisores B2B: nome, cargo, email inferido, LinkedIn e score de prioridade. " +
      "Use quando o usuário pedir enriquecimento, quiser saber quem contatar em uma empresa, ou precisar de dados de contato. " +
      "Exemplos: 'enriquecer leads da Claro', 'quem é o decisor de marketing na Vivo?', 'encontrar CMO da AWS Brasil'. " +
      "ATENÇÃO: pode levar 30-90s por empresa — informe o usuário que está processando.",
    input_schema: {
      type: "object" as const,
      properties: {
        companies: {
          type: "array",
          items: { type: "string" },
          description: "Lista de empresas a enriquecer (máx 3 por chamada). Ex: ['Claro', 'Vivo', 'TIM']",
        },
        min_seniority: {
          type: "string",
          enum: ["c-level", "director", "manager", "analyst"],
          description: "Seniority mínima dos contatos (padrão: 'director')",
        },
        max_per_company: {
          type: "number",
          description: "Máximo de contatos por empresa (padrão 3, máx 5)",
        },
        focus_area: {
          type: "string",
          description: "Área de foco para os contatos. Ex: 'marketing', 'eventos', 'brand', 'c-suite'",
        },
      },
      required: ["companies"],
    },
  },
  execute: async (raw) => {
    const input = raw as {
      companies: string[];
      min_seniority?: string;
      max_per_company?: number;
      focus_area?: string;
    };

    // Cap at 3 companies per call to avoid timeout
    const companies = (input.companies ?? []).slice(0, 3);
    if (companies.length === 0) {
      return { error: "Informe ao menos uma empresa para enriquecer." };
    }

    const minSeniority = (input.min_seniority ?? "director") as "c-level" | "director" | "manager" | "analyst";
    const maxPerCompany = Math.min(input.max_per_company ?? 3, 5);

    try {
      // Dynamic import to avoid loading at module init time
      const { LeadEnrichmentAgent } = await import("../agents/lead-enrichment-agent/agent.js");

      const agent = await LeadEnrichmentAgent.create();
      const result = await agent.enrich(
        {
          companies,
          options: { minSeniority, maxContactsPerCompany: maxPerCompany },
        },
        { onStep: () => {} } // silent — SSE events are handled by the outer agent
      );

      const contacts = result.contacts.map((c) => ({
        company:       c.company,
        name:          c.name,
        role:          c.role,
        area:          c.area,
        seniority:     c.seniority,
        priority:      c.priority,
        score:         c.priorityScore,
        linkedin:      c.linkedin !== "unknown" ? c.linkedin : null,
        email:         c.possibleEmail !== "unknown" ? c.possibleEmail : null,
        emailInferred: c.emailInferred,
        confidence:    c.emailConfidence,
        notes:         c.strategicNotes,
      }));

      const byCompany = result.companies.map((co) => ({
        company:  co.company,
        contacts: co.totalContacts,
        coverage: co.coverageQuality,
        primary:  co.primaryContact
          ? `${co.primaryContact.name} (${co.primaryContact.role})`
          : null,
      }));

      return {
        companiesProcessed: result.companiesProcessed,
        totalContacts: contacts.length,
        byCompany,
        contacts,
        gaps: result.gaps,
      };
    } catch (err) {
      return {
        error: `Falha no enriquecimento: ${String(err)}`,
        companies,
      };
    }
  },
};
