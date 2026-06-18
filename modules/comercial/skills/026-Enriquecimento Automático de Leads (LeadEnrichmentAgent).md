---
name: enriquecimento-automatico-de-leads-lead-enrichment-agent
description: Enriquecer leads com email real encontrado na web, LinkedIn confirmado e contexto extra — usando prospect_leads (pipeline unificado com deepEnrichContact por pessoa) ou enrich_company para empresas já conhecidas. O enrichment agora acontece automaticamente dentro do prospect_leads sem chamada separada.
tags: [enrichment, prospect_leads, deep-enrich, email-web, linkedin, decisores, emailpatternresolver, web search, haiku]
---

# Enriquecimento Automático de Leads (LeadEnrichmentAgent)

## Objetivo
Transformar uma busca genérica em contatos de decisores com dados reais — email encontrado na internet, LinkedIn verificado, cargo exato e contexto de abordagem — tudo em uma única chamada ao `prospect_leads`.

## Fluxo de enriquecimento (v2.0 — integrado em prospect_leads)

```
1. Tavily broad search
   query: "Diretor Marketing Claro Brasil LinkedIn perfil B2B"
   → encontra candidatos no segmento

2. Haiku extrai contatos
   → [{ name, role, company, linkedin_url, source }]

3. deepEnrichContact() — por pessoa:
   Tavily: '"Ana Lima" "Claro Brasil" email contato linkedin'
   → extrai email real do texto das páginas (regex)
   → confirma/encontra URL do LinkedIn
   → coleta extra_info (snippets de contexto)

4. EmailPatternResolver (fallback)
   → se email não encontrado na web → infere por padrão corporativo
   → email_source: "pattern"

5. Retorno final
   → email_source: "web" | "pattern"
   → email_confidence: "high" | "medium" | "low"
```

## Comparação: pipeline antigo vs novo

| Aspecto | Antigo (scripts CLI) | Novo (prospect_leads) |
|---|---|---|
| Chamadas necessárias | researcher → enricher → validator | 1 chamada ao prospect_leads |
| Fonte do email | Padrão corporativo (local) | Web primeiro → padrão (fallback) |
| LinkedIn | Inferido | Buscado e confirmado na web |
| Contexto extra | Não | extra_info com snippets reais |
| Latência | 30-90s por empresa | ~12s por lead |
| Custo | Sonnet (pesado) | Haiku (barato) |

## Como usar via chat

```
# Buscar e enriquecer em uma chamada:
"busque 1 lead de VP de Marketing em telecom enterprise"
"encontre decisores de eventos na Claro Brasil"
"prospecte 3 leads de cloud infrastructure enterprise São Paulo"

# Enriquecer empresas já conhecidas (sem busca):
"enriqueça os decisores da Claro, Vivo e TIM"
"quem é o Head de Marketing da AWS Brasil?"
```

## Output de prospect_leads com enriquecimento web

```json
{
  "found": 1,
  "leads": [
    {
      "name": "Ricardo Santos",
      "role": "VP de Marketing",
      "company": "Claro Brasil",
      "email": "r.santos@claro.com.br",
      "email_source": "web",
      "email_confidence": "high",
      "domain": "claro.com.br",
      "linkedin": "https://www.linkedin.com/in/ricardosantos-claro",
      "extra_info": "Ricardo Santos lidera marketing corporativo na Claro, focado em eventos e patrocínios B2B...",
      "source": "https://linkedin.com/in/ricardosantos-claro"
    }
  ],
  "note": "Email encontrado via busca web."
}
```

## Output de enrich_company (empresas conhecidas)

```json
{
  "companiesProcessed": 1,
  "totalContacts": 3,
  "contacts": [
    {
      "company": "Claro Brasil",
      "name": "Ana Lima",
      "role": "Gerente de Eventos Corporativos",
      "area": "events",
      "seniority": "manager",
      "linkedin": "linkedin.com/in/analima-claro",
      "email": "ana.lima@claro.com.br",
      "emailInferred": true,
      "confidence": "high",
      "score": 88,
      "notes": "Decisora de contratação de fornecedores de eventos para Claro Brasil"
    }
  ]
}
```

## Senioridade

| Nível | Cargos |
|---|---|
| c-level | CEO, CFO, CTO, CMO, Diretor Geral, Presidente |
| director | Diretor, VP, Head of, Country Manager |
| manager | Gerente, Coordenador Sênior (PADRÃO) |

## Cobertura de enriquecimento

| Resultado | Situação |
|---|---|
| email_source: "web" | Email encontrado diretamente nas páginas — alta confiança |
| email_source: "pattern" | Padrão inferido — validar antes do envio |
| linkedin: URL | Perfil encontrado e confirmado na web |
| extra_info | Contexto real coletado da busca individual |

---
**Tags:** Técnico | Automação | Comercial, Enrichment, Email Web, LinkedIn, prospect_leads
