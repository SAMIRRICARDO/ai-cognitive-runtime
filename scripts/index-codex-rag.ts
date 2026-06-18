/**
 * Indexa as capacidades do Codex Lead Engine na RAG local (collection: "prompts")
 * para que o Comercial AI saiba quando e como ativar cada ferramenta.
 *
 * Run: tsx scripts/index-codex-rag.ts
 */
import { saveLocalMemory } from "../memory/local-rag.js";

const DOCS = [
  {
    id: "codex-find-new-leads",
    content: `CODEX — Busca de Novos Leads (find_new_leads)

Ferramenta: find_new_leads
Quando usar: usuário pede para encontrar, prospectar, buscar, descobrir novos leads que ainda não estão na base.
Palavras-chave: "buscar leads", "prospectar", "encontrar decisores", "novos contatos", "leads de [segmento]", "empresas de [mercado]"

Parâmetros principais:
- query: termo de busca livre (segmento, cargo, empresa, evento, região)
- segment: setor de mercado (telecom, varejo, tecnologia, indústria)
- location: localização (São Paulo, Brasil, América Latina)
- role_focus: cargo alvo (CMO, Diretor de Marketing, Head de Eventos)
- max_results: até 15 resultados

Retorna: lista de empresas/contatos descobertos via web search com LinkedIn, cargo e snippet de contexto.
AVISO: requer TAVILY_API_KEY configurado no .env

Exemplos de ativação:
- "buscar leads de telecom em SP" → find_new_leads(query="decisores marketing telecom São Paulo")
- "prospectar empresas de varejo" → find_new_leads(query="Diretor de Marketing varejo Brasil", segment="varejo")
- "encontrar contatos para Futurecom" → find_new_leads(query="patrocinadores Futurecom 2026 telecom eventos")
`,
    tags: ["codex", "find_new_leads", "prospecção", "novos leads", "busca", "web search", "descoberta"],
  },
  {
    id: "codex-enrich-company",
    content: `CODEX — Enriquecimento de Empresas (enrich_company)

Ferramenta: enrich_company
Quando usar: usuário quer saber quem contatar em uma empresa, pede enriquecimento, quer email ou LinkedIn de decisores.
Palavras-chave: "enriquecer", "quem é o CMO/Diretor de", "encontrar email de", "decisor da [empresa]", "contato da [empresa]"

Parâmetros principais:
- companies: lista de empresas (máx 3 por chamada) — Ex: ["Claro", "Vivo", "TIM"]
- min_seniority: "c-level" | "director" | "manager" | "analyst" (padrão: "director")
- max_per_company: máximo de contatos por empresa (padrão 3)
- focus_area: área de foco — "marketing", "eventos", "brand", "c-suite"

Retorna: contatos com nome, cargo, email inferido, LinkedIn, score de prioridade e notas estratégicas.
AVISO: pode levar 30-90 segundos por empresa. Informe o usuário que está processando.

Exemplos de ativação:
- "enriquecer leads da Claro e Vivo" → enrich_company(companies=["Claro", "Vivo"])
- "quem é o CMO da AWS Brasil?" → enrich_company(companies=["AWS"], min_seniority="c-level", focus_area="marketing")
- "encontrar decisores de eventos na Embraer" → enrich_company(companies=["Embraer"], focus_area="eventos")
`,
    tags: ["codex", "enrich_company", "enriquecimento", "decisores", "email", "linkedin", "contato"],
  },
  {
    id: "codex-validate-leads",
    content: `CODEX — Validação da Base de Leads (validate_leads)

Ferramenta: validate_leads
Quando usar: usuário quer analisar/validar a base, ver distribuição HOT/WARM, relatório de qualidade, leads prontos para prospectar.
Palavras-chave: "validar leads", "relatório da base", "quantos HOT", "cobertura de email", "análise de qualidade", "leads prontos"

Parâmetros principais:
- campaign: filtrar por campanha (Ex: "TOTVS", "Futurecom") — opcional
- status: filtrar por status (HOT, WARM, LOW_PRIORITY, INVALID, COLLECTED) — opcional
- min_score: score mínimo 0-100 — opcional
- top_n: quantos top leads detalhar (padrão 10)
- show_missing_email: se true, lista leads sem email

Retorna:
- total de leads, distribuição por status (HOT/WARM/etc) e por campanha
- cobertura de email e LinkedIn (%)
- quality score 0-100
- top N leads prontos para prospectar (com email, ordenados por HOT/score)
- lista de leads sem email (se solicitado)

Exemplos de ativação:
- "quantos leads HOT temos?" → validate_leads()
- "relatório da campanha TOTVS" → validate_leads(campaign="TOTVS")
- "listar todos HOT com email" → validate_leads(status="HOT", top_n=30)
- "leads sem email para enriquecer" → validate_leads(show_missing_email=true)
`,
    tags: ["codex", "validate_leads", "validação", "HOT", "WARM", "relatório", "qualidade", "análise"],
  },
  {
    id: "codex-pipeline-guide",
    content: `CODEX — Pipeline Completo de Lead Intelligence

O Comercial AI possui 5 ferramentas de lead intelligence:

1. search_leads_rag — busca livre na base de 363 leads indexados (nome, empresa, cargo, status)
2. query_leads — consulta estruturada com filtros exatos (status, campanha, empresa)
3. find_new_leads — descobre NOVOS leads via web search (Tavily) — segmento, evento, cargo
4. enrich_company — enriquece empresas com decisores, emails e LinkedIn via IA
5. validate_leads — analisa qualidade da base: HOT/WARM/INVALID, cobertura, top leads

FLUXO RECOMENDADO para prospecção:
1. validate_leads() → entender estado atual da base
2. find_new_leads(query=...) → descobrir novas empresas no segmento
3. enrich_company(companies=[...]) → obter contatos dos decisores
4. query_leads(status="HOT") → listar os melhores leads para abordar

IMPORTANTE:
- enrich_company pode levar 30-90s — sempre avise o usuário
- find_new_leads requer TAVILY_API_KEY
- search_leads_rag é sempre offline (sem custo extra)
- validate_leads é instantâneo (leitura de arquivo)
`,
    tags: ["codex", "pipeline", "fluxo", "prospecção", "lead intelligence", "guia"],
  },
];

async function main() {
  console.log("Indexando Codex Lead Engine na RAG (collection: prompts)...\n");

  for (const doc of DOCS) {
    await saveLocalMemory({
      id: doc.id,
      collection: "prompts",
      content: doc.content,
      tags: doc.tags,
      metadata: { source: "codex-lead-engine", type: "tool-guide", indexedAt: new Date().toISOString() },
    });
    console.log(`✓ ${doc.id}`);
  }

  console.log(`\n✅ ${DOCS.length} documentos Codex indexados na RAG de prompts.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
