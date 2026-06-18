---
name: enriquecimento-automatico-de-leads-lead-enrichment-agent
description: Usar o LeadEnrichmentAgent do VRAXIA para enriquecer automaticamente uma lista de empresas com decisores qualificados — descobrindo nome, cargo, LinkedIn e email corporativo via EmailPatternResolver — usando web search com Sonnet e filtros de senioridade por área de atuação.
tags: [enrichment, lead-enrichment-agent, decisores, email, linkedin, cargo, senioridade, emailpatternresolver, web search]
---

# Enriquecimento Automático de Leads (LeadEnrichmentAgent)

## Objetivo
Usar o `LeadEnrichmentAgent` do VRAXIA para transformar uma lista de empresas em contatos de decisores qualificados — descobrindo nome completo, cargo exato, URL do LinkedIn e email corporativo inferido via `EmailPatternResolver` — com filtros de senioridade mínima e limite por empresa. Usa Sonnet para pesquisa + Haiku em modo CHEAP_MODE.

## Quando usar
- Após o FuturecomResearcherAgent gerar a lista de empresas (skill 025)
- Para enriquecer uma lista manual de empresas com contatos humanos
- Para descobrir decisores em empresas-alvo sem comprar bancos de dados
- Quando o `seedToRawLeadFile()` não tem contatos mapeados para uma empresa nova

## Como usar
1. Passe a lista de empresas (nomes) para o `LeadEnrichmentAgent`
2. O agente usa `web_search` + `resolve_email_pattern` para cada empresa
3. Chama `save_contact` para cada decisor encontrado (deduplicado)
4. Filtra por senioridade mínima configurada (padrão: "manager")
5. Retorna `EnrichmentResult` com contatos ranqueados por `priorityScore`

## O Prompt
```
Você é o analista de inteligência de leads do VRAXIA. Seu trabalho é encontrar os decisores certos dentro de cada empresa-alvo.

**EXECUÇÃO VIA SCRIPT:**
```bash
tsx scripts/run-enrichment.ts
```

Ou como parte do pipeline completo:
```bash
tsx scripts/run-futurecom-pipeline.ts --max-contacts 3
```

**FERRAMENTAS DISPONÍVEIS NO AGENTE:**
1. `web_search(query)` — busca Google/Bing para encontrar perfis e dados
2. `resolve_email_pattern(name, company, website?, domain?)` — infere emails via EmailPatternResolver
3. `save_contact(...)` — salva o contato validado (deduplicado por nome+empresa)
4. `memory_read/write` — deduplicação cross-session (desabilitado em CHEAP_MODE)

**ESTRATÉGIA DE PESQUISA DO AGENTE (automática):**
Para cada empresa, o agente:
1. Busca `site:linkedin.com/in "[empresa]" "[cargo]" Marketing Events` 
2. Encontra 2-5 decisores com cargo relevante
3. Resolve email via `resolve_email_pattern` antes de salvar
4. Registra via `save_contact` com todos os campos

**ÁREAS DE FOCO (padrão para eventos B2B):**
marketing, events, brand, customer-experience, communications, sponsorship

**FILTROS DE SENIORIDADE:**
| Nível | Cargos incluídos |
|---|---|
| c-level | CEO, CFO, CTO, CMO, Diretor Geral, Presidente |
| director | Diretor, VP, Head of, Country Manager |
| manager | Gerente, Coordenador Sênior, Supervisor (PADRÃO) |
| analyst | Analista, Assistente (incluído apenas se explicitado) |

**ESTRUTURA DO CONTATO SALVO (EnrichedContact):**
```json
{
  "company": "Claro Brasil",
  "name": "Ana Lima",
  "role": "Gerente de Eventos Corporativos",
  "area": "events",
  "seniority": "manager",
  "linkedin": "linkedin.com/in/analima-claro",
  "guessedEmails": [
    { "email": "ana.lima@claro.com.br", "pattern": "firstname.lastname", "confidence": 0.85 },
    { "email": "a.lima@claro.com.br", "pattern": "f.lastname", "confidence": 0.45 }
  ],
  "emailConfidence": "high",
  "priority": "high",
  "priorityScore": 88,
  "strategicNotes": "Decisora de contratação de fornecedores de eventos para Claro Brasil",
  "sources": ["linkedin.com", "claro.com.br/imprensa"],
  "enrichedAt": "2026-06-12T14:00:00Z"
}
```

**AVALIAÇÃO DE COVERTURA (por empresa):**
- strong: 3+ contatos encontrados
- partial: 2 contatos
- weak: 1 contato
- none: nenhum contato encontrado (vai para `gaps[]`)

**CHEAP_MODE (sem web search):**
```
DEV_MODE=true CHEAP_MODE=true tsx scripts/run-enrichment.ts
```
→ Usa Haiku, máx 1 contato/empresa, sem web_search — apenas EmailPatternResolver
```

## Exemplo de uso

### Input
Empresas: ["Claro Brasil", "TOTVS", "Ericsson Brasil"]
Areas: marketing, events, sponsorship
Min seniority: manager | Max contacts: 3

### Output
```
Enrichment Summary:
- Claro Brasil: 3 contatos (strong) — Ana Lima (Gerente Eventos), Ricardo Santos (VP Marketing), Julia Dias (Head of Brand)
- TOTVS: 2 contatos (partial) — Marcos Costa (Gerente Marketing), Priya Gupta (Dir. Customer Experience)
- Ericsson Brasil: 1 contato (weak) — Carlos Freitas (Marketing Manager)
- Gaps: 0 empresas sem contatos

Emails inferidos: 17 (EmailPatternResolver)
Domínios conhecidos: claro.com.br (high confidence), totvs.com (high), ericsson.com (high)
```

---
**Tags:** Técnico | Automação | Comercial, Enrichment, Leads, Email, LinkedIn
