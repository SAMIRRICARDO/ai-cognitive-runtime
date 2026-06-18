/**
 * find_new_leads — Busca leads novos via web search (Tavily).
 * Encontra empresas e decisores para um segmento/evento/região.
 */
import { env } from "../config/env.js";
import type { ToolHandler } from "../agents/_base/types.js";

interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score?: number;
}

async function tavilySearch(query: string, maxResults: number): Promise<TavilyResult[]> {
  if (!env.TAVILY_API_KEY) return [];
  const resp = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: env.TAVILY_API_KEY,
      query,
      max_results: maxResults,
      search_depth: "advanced",
    }),
  });
  if (!resp.ok) return [];
  const data = await resp.json() as { results?: TavilyResult[] };
  return data.results ?? [];
}

function extractLeadsFromResults(results: TavilyResult[]): Array<{
  company: string;
  contact?: string;
  role?: string;
  linkedin?: string;
  source: string;
  snippet: string;
}> {
  const leads: ReturnType<typeof extractLeadsFromResults> = [];
  const seenCompanies = new Set<string>();

  const linkedinRe = /linkedin\.com\/in\/([a-zA-Z0-9-]+)/i;
  const nameRoleRe = /([A-ZÁÉÍÓÚÀÂÊÔÃÕÜ][a-záéíóúàâêôãõü]+ [A-ZÁÉÍÓÚÀÂÊÔÃÕÜ][a-záéíóúàâêôãõü]+)[,\s\|–-]+([A-Z][^.]{5,60}?(?:Diretor|Director|Gerente|Manager|Head|VP|CEO|CMO|CTO|CCO|Coordenador)[^.]{0,40})/;

  for (const r of results) {
    const text = `${r.title} ${r.content}`;

    // Try to extract a company name from the title
    const company = r.title
      .replace(/\s*[-|–]\s*LinkedIn.*$/i, "")
      .replace(/\s*[-|–]\s*(perfil|profile|página|page).*/i, "")
      .trim()
      .slice(0, 80);

    if (!company || seenCompanies.has(company.toLowerCase())) continue;
    seenCompanies.add(company.toLowerCase());

    const linkedinMatch = text.match(linkedinRe);
    const nameRoleMatch = text.match(nameRoleRe);

    leads.push({
      company,
      contact: nameRoleMatch?.[1],
      role: nameRoleMatch?.[2]?.trim(),
      linkedin: linkedinMatch ? `https://linkedin.com/in/${linkedinMatch[1]}` : undefined,
      source: r.url,
      snippet: r.content.slice(0, 200),
    });
  }
  return leads;
}

export const findNewLeadsTool: ToolHandler = {
  name: "find_new_leads",
  schema: {
    name: "find_new_leads",
    description:
      "Busca NOVOS leads via web search (Tavily). Descobre empresas e decisores que ainda não estão na base. " +
      "Use quando o usuário pedir para encontrar/prospectar/buscar novos leads em um segmento, mercado, evento ou região. " +
      "Exemplos: 'buscar leads de telecom SP', 'encontrar decisores de marketing em grandes empresas', 'prospectar para Futurecom'.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Termo de busca livre: segmento, cargo, empresa, evento, região. Ex: 'Diretor de Marketing empresas telecom São Paulo'",
        },
        segment: {
          type: "string",
          description: "Segmento de mercado foco (opcional). Ex: 'telecom', 'varejo', 'indústria', 'tecnologia'",
        },
        location: {
          type: "string",
          description: "Localização geográfica (opcional). Ex: 'São Paulo', 'Brasil', 'América Latina'",
        },
        role_focus: {
          type: "string",
          description: "Cargo ou área alvo (opcional). Ex: 'CMO', 'Diretor de Marketing', 'Head de Eventos'",
        },
        max_results: {
          type: "number",
          description: "Número máximo de leads a retornar (padrão 8, máx 15)",
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
      max_results?: number;
    };

    if (!env.TAVILY_API_KEY) {
      return {
        found: 0,
        error: "TAVILY_API_KEY não configurado. Configure no .env para ativar busca de novos leads.",
      };
    }

    const maxResults = Math.min(input.max_results ?? 8, 15);

    // Build an enriched query
    const parts = [input.query];
    if (input.role_focus) parts.push(input.role_focus);
    if (input.segment)    parts.push(input.segment);
    if (input.location)   parts.push(input.location);
    parts.push("LinkedIn decisor empresa B2B");

    const searchQuery = parts.join(" ");

    const results = await tavilySearch(searchQuery, maxResults + 3);

    if (results.length === 0) {
      return { found: 0, message: "Nenhum resultado encontrado para a busca.", query: searchQuery };
    }

    const leads = extractLeadsFromResults(results).slice(0, maxResults);

    return {
      found: leads.length,
      query: searchQuery,
      leads,
      note: "Leads descobertos via web search — valide e enriqueça antes de prospectar.",
    };
  },
};
