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

interface WebEnrichResult {
  realEmail: string | null;
  emailSource: "web" | "pattern";
  linkedin: string | null;
  extraInfo: string | null;
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

function normalizeStr(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Prevents wrong-area leads: returns false if "Head de Vendas" when user asked for "Marketing".
function roleMatchesTarget(role: string, roleFocus: string): boolean {
  if (!roleFocus) return true;
  const roleN = normalizeStr(role);
  const focusN = normalizeStr(roleFocus);

  const AREA_MAP: Record<string, string[]> = {
    marketing: ["marketing", "brand", "comunicacao", "propaganda", "publicidade", "eventos", "content", "conteudo", "social media", "growth", "crm", "cmo"],
    tecnologia: ["tecnologia", "tech", "ti", "it", "engenharia", "engineering", "produto", "product", "cto", "cio", "devops", "software", "dados", "data", "analytics", "digital", "inovacao", "sistemas"],
    vendas: ["vendas", "sales", "comercial", "revenue", "business development", "parceria", "account"],
    financeiro: ["financeiro", "finance", "cfo", "contabilidade", "controladoria", "tesouraria"],
    operacoes: ["operacoes", "operations", "supply chain", "logistica", "coo"],
    rh: ["rh", "hr", "recursos humanos", "human resources", "people", "talent", "cultura"],
  };
  const SENIORITY_MAP: Record<string, string[]> = {
    diretoria: ["diretor", "director", "vp", "vice presidente", "vice-presidente", "ceo", "cto", "cmo", "cfo", "coo", "ciso", "presidente", "head of", "head de", "country manager"],
    gerencia: ["gerente", "manager", "coordenador", "supervisor"],
    "c-level": ["ceo", "cto", "cmo", "cfo", "coo", "ciso", "presidente"],
  };

  const targetKws: string[] = [];
  for (const [key, kws] of Object.entries(AREA_MAP)) {
    if (focusN.includes(key)) targetKws.push(...kws);
  }
  for (const [key, kws] of Object.entries(SENIORITY_MAP)) {
    if (focusN.includes(key)) targetKws.push(...kws);
  }
  if (targetKws.length === 0) {
    targetKws.push(...focusN.split(/\s+/).filter((w) => w.length > 3));
  }
  return targetKws.some((kw) => roleN.includes(kw));
}

const EMAIL_REGEX = /[\w.+-]+@[\w-]+\.[a-z]{2,}/gi;
const LINKEDIN_REGEX = /linkedin\.com\/in\/([\w-]+)/i;
const SKIP_EMAILS = /noreply|no-reply|example|test@|info@|contact@|suporte@|contato@|admin@/i;

async function deepEnrichContact(contact: RawContact, domain: string | null): Promise<WebEnrichResult> {
  const query = `"${contact.name}" "${contact.company}" email contato linkedin`;
  const results = await tavilySearch(query, 4);

  let realEmail: string | null = null;
  let linkedin: string | null = contact.linkedin_url;
  const infoSnippets: string[] = [];

  for (const r of results) {
    const text = `${r.title} ${r.content} ${r.url}`;

    if (!realEmail) {
      const emails = text.match(EMAIL_REGEX) ?? [];
      for (const e of emails) {
        if (SKIP_EMAILS.test(e)) continue;
        if (domain && e.toLowerCase().includes(domain.replace(/^www\./, "").split(".")[0]!)) {
          realEmail = e.toLowerCase();
          break;
        }
        if (!realEmail) realEmail = e.toLowerCase();
      }
    }

    if (!linkedin) {
      const m = text.match(LINKEDIN_REGEX);
      if (m) linkedin = `https://www.linkedin.com/in/${m[1]}`;
    }

    if (r.content.length > 60) {
      infoSnippets.push(r.content.slice(0, 120));
    }
  }

  return {
    realEmail,
    emailSource: realEmail ? "web" : "pattern",
    linkedin,
    extraInfo: infoSnippets.slice(0, 2).join(" | ") || null,
  };
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

  const roleFilter = role_focus
    ? `\nFILTRO OBRIGATÓRIO DE CARGO: Inclua SOMENTE contatos cujo cargo seja compatível com "${role_focus}".` +
      ` Exemplos de compatível: se alvo é "Marketing" → aceita CMO/Diretor Marketing/Head Marketing/VP Marketing.` +
      ` Exemplos de EXCLUÍDO: se alvo é "Marketing" → rejeita Vendas/Sales/Comercial/Financeiro/Engenharia.` +
      ` Se alvo é "Tecnologia" → rejeita Marketing/Comercial/RH.` +
      ` Se alvo é "diretoria" → aceita qualquer Diretor/VP/Head/CEO/C-Level.` +
      ` Se não houver nenhum contato compatível com o cargo alvo, retorne [].`
    : "";

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
- Se nenhum contato real for identificável, retorne []${roleFilter}`,
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
    const roleFocus = input.role_focus ?? "";

    // role_focus goes first with quotes to anchor the search on the requested position
    const roleQuery = roleFocus
      ? `"${roleFocus}"`
      : "Diretor decisor";

    const queryParts = [
      roleQuery,
      input.segment ? `setor ${input.segment}` : "",
      input.location || "Brasil",
      input.query || "",
      "LinkedIn perfil B2B empresa decisor",
    ]
      .filter(Boolean)
      .join(" ");

    // Run Tavily search (fetch more to compensate after role filtering)
    const results = await tavilySearch(queryParts, maxLeads * 4);

    if (results.length === 0) {
      return {
        found: 0,
        message: "Nenhum resultado encontrado. Tente outra consulta.",
        query: queryParts,
      };
    }

    // Extract structured contacts with Haiku (prompt enforces role_focus filter)
    const rawContacts = await extractContactsWithHaiku(
      results,
      input.segment ?? "",
      roleFocus
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

    // Post-filter: discard contacts whose extracted role doesn't match the requested focus
    const roleFiltered = roleFocus
      ? rawContacts.filter((c) => !c.role || roleMatchesTarget(c.role, roleFocus))
      : rawContacts;

    if (roleFiltered.length === 0) {
      return {
        found: 0,
        message: `Nenhum contato com cargo compatível com "${roleFocus}" encontrado. Tente ampliar o cargo alvo ou mudar o segmento.`,
        query: queryParts,
        rawContacts: rawContacts.map((c) => ({ name: c.name, role: c.role, company: c.company })),
      };
    }

    // Enrich each contact: pattern inference + deep web search per lead
    const candidates = roleFiltered.filter((c) => c.name && c.company).slice(0, maxLeads);

    const leads = await Promise.all(
      candidates.map(async (c) => {
        const emailResult = emailPatternResolver.resolve({
          name: c.name!,
          company: c.company!,
        });
        const patternEmail = emailResult.guessedEmails[0];
        const domain = emailResult.domain ?? null;

        // Deep web search for real email + LinkedIn + extra context
        const web = await deepEnrichContact(c, domain);

        // Prefer web-found email over pattern; fallback to pattern
        const finalEmail = web.realEmail ?? patternEmail?.email ?? null;
        const emailSource = web.realEmail ? "web" : (patternEmail ? "pattern" : null);

        return {
          name: c.name,
          role: c.role ?? "—",
          company: c.company,
          email: finalEmail,
          email_source: emailSource,
          email_confidence: web.realEmail ? "high" : (patternEmail?.confidence ?? null),
          domain,
          linkedin: web.linkedin ?? c.linkedin_url ?? null,
          extra_info: web.extraInfo,
          source: c.source,
        };
      })
    );

    const validLeads = leads.filter((l) => l.name && l.company);

    if (validLeads.length === 0) {
      return {
        found: 0,
        message: "Contatos detectados mas sem nome+empresa suficientes para enriquecimento.",
        rawContacts,
      };
    }

    return {
      found: validLeads.length,
      query: queryParts,
      leads: validLeads,
      note: validLeads.some((l) => l.email_source === "web")
        ? "Email encontrado via busca web."
        : "Email inferido por padrão corporativo — valide antes do outreach.",
    };
  },
};
