/**
 * prospect_leads — busca + enriquecimento completo em uma chamada.
 * 1. Tavily web search (perfis LinkedIn + decisores B2B)
 * 2. Haiku extrai contatos estruturados dos resultados
 * 3. emailPatternResolver infere email corporativo localmente
 * Retorna: nome, cargo, empresa, email, LinkedIn, fonte, score.
 */
import Anthropic from "@anthropic-ai/sdk";
import { env } from "../config/env.js";
import type { ToolHandler } from "../agents/_base/types.js";
import { emailPatternResolver } from "../agents/lead-enrichment-agent/email-resolver.js";

interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score?: number;
}

interface RawContact {
  name: string | null;
  role: string | null;
  company: string | null;
  linkedin_url: string | null;
  source: string;
}

async function tavilySearch(query: string, max: number): Promise<TavilyResult[]> {
  if (!env.TAVILY_API_KEY) return [];
  const r = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: env.TAVILY_API_KEY,
      query,
      max_results: max,
      search_depth: "advanced",
    }),
  });
  if (!r.ok) return [];
  const data = (await r.json()) as { results?: TavilyResult[] };
  return data.results ?? [];
}

function stripFences(s: string): string {
  return s.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
}

async function extractContactsWithHaiku(
  results: TavilyResult[],
  segment: string,
  role_focus: string
): Promise<RawContact[]> {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  const snippets = results
    .map(
      (r, i) =>
        `[${i + 1}] URL: ${r.url}\nTítulo: ${r.title}\nTrecho: ${r.content.slice(0, 350)}`
    )
    .join("\n\n");

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    system: `Você é um extrator de leads B2B. Analise os resultados de busca e extraia contatos de decisores.
Retorne SOMENTE um JSON array puro (sem markdown), com objetos no formato:
{"name":"Nome Completo","role":"Cargo Exato","company":"Empresa","linkedin_url":"https://linkedin.com/in/...ou null","source":"URL da fonte"}
Regras:
- Inclua APENAS contatos com nome E empresa identificáveis
- Se linkedin_url não aparecer explicitamente no conteúdo, coloque null
- role: use o cargo mais sênior mencionado (Diretor, Gerente, Head, VP, CEO, etc.)
- Se encontrar múltiplos contatos por empresa, inclua todos
- Se nenhum contato real for identificável, retorne []`,
    messages: [
      {
        role: "user",
        content: `Segmento alvo: ${segment || "B2B"}\nCargo alvo: ${role_focus || "decisores"}\n\nResultados:\n\n${snippets}`,
      },
    ],
  });

  const raw = response.content[0].type === "text" ? response.content[0].text : "[]";
  try {
    const parsed = JSON.parse(stripFences(raw));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export const prospectLeadsTool: ToolHandler = {
  name: "prospect_leads",
  schema: {
    name: "prospect_leads",
    description:
      "Busca E enriquece leads B2B completos em uma única chamada. " +
      "Retorna contatos reais com nome, cargo, empresa, email inferido, LinkedIn e fonte. " +
      "Use quando o usuário pedir para 'buscar leads', 'encontrar decisores', 'prospectar' — " +
      "PREFIRA este tool a find_new_leads quando o usuário quiser o lead completo pronto para outreach.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description:
            "Busca livre: segmento, cargo, empresa, evento ou região. Ex: 'Diretor de Marketing telecom São Paulo'",
        },
        segment: {
          type: "string",
          description: "Segmento de mercado. Ex: 'telecom', 'tecnologia', 'varejo', 'saúde'",
        },
        location: {
          type: "string",
          description: "Localização. Ex: 'São Paulo', 'Brasil', 'Rio de Janeiro'",
        },
        role_focus: {
          type: "string",
          description:
            "Cargo ou área alvo. Ex: 'Diretor de Marketing', 'CMO', 'Head de Eventos', 'VP Comercial'",
        },
        max_leads: {
          type: "number",
          description: "Número máximo de leads a retornar (padrão 3, máx 8)",
        },
      },
      required: ["query"],
    },
  },

  execute: async (raw) => {
    const input = raw as {
      query: string;
      segment?: string;
      location?: string;
      role_focus?: string;
      max_leads?: number;
    };

    if (!env.TAVILY_API_KEY) {
      return {
        error: "TAVILY_API_KEY não configurado — necessário para busca de leads.",
      };
    }

    const maxLeads = Math.min(input.max_leads ?? 3, 8);

    // Build query targeting individual decision makers on LinkedIn
    const queryParts = [
      input.role_focus || "decisor diretor",
      input.segment || "",
      input.location || "Brasil",
      input.query,
      "LinkedIn perfil B2B empresa cargo",
    ]
      .filter(Boolean)
      .join(" ");

    // Run Tavily search (fetch more results to compensate for those without names)
    const results = await tavilySearch(queryParts, maxLeads * 3);

    if (results.length === 0) {
      return {
        found: 0,
        message: "Nenhum resultado encontrado. Tente outra consulta.",
        query: queryParts,
      };
    }

    // Extract structured contacts with Haiku
    const rawContacts = await extractContactsWithHaiku(
      results,
      input.segment ?? "",
      input.role_focus ?? ""
    );

    if (rawContacts.length === 0) {
      return {
        found: 0,
        message:
          "Leads encontrados mas sem dados de contato identificáveis. Tente query mais específico (ex: incluir nome da empresa ou cargo exato).",
        query: queryParts,
        rawResults: results.slice(0, 3).map((r) => ({ title: r.title, url: r.url })),
      };
    }

    // Enrich each contact with email inference
    const leads = rawContacts
      .filter((c) => c.name && c.company)
      .slice(0, maxLeads)
      .map((c) => {
        const emailResult = emailPatternResolver.resolve({
          name: c.name!,
          company: c.company!,
        });

        const bestEmail = emailResult.guessedEmails[0];

        return {
          name: c.name,
          role: c.role ?? "—",
          company: c.company,
          email: bestEmail?.email ?? null,
          email_confidence: bestEmail?.confidence ?? null,
          email_pattern: emailResult.patternUsed ?? null,
          domain: emailResult.domain ?? null,
          linkedin: c.linkedin_url ?? null,
          source: c.source,
        };
      });

    if (leads.length === 0) {
      return {
        found: 0,
        message: "Contatos detectados mas sem nome+empresa suficientes para enriquecimento.",
        rawContacts,
      };
    }

    return {
      found: leads.length,
      query: queryParts,
      leads,
      note: "Email inferido por padrão corporativo — valide antes do outreach.",
    };
  },
};
