---
name: enriquecimento-de-lead-enricher-agent
description: Enriquecer um lead com nome, cargo, email real (validado na web), LinkedIn e score de fit — usando prospect_leads (busca + enriquecimento web em uma chamada) ou enrich_company para empresas já conhecidas. Email é buscado na internet antes de ser inferido por padrão.
tags: [enricher, enriquecimento, lead, email, linkedin, cargo, web, prospect_leads, emailpatternresolver, icp, score]
---

# Enriquecimento de Lead (Enricher Agent)

## Objetivo
Obter dados completos de um lead — email real encontrado na web, LinkedIn, cargo exato e score de fit com o ICP — usando `prospect_leads` (pipeline unificado) ou `enrich_company` (para empresas conhecidas). O enriquecimento agora tem duas camadas: busca na internet por email real + fallback para padrão corporativo.

## Fluxo atual (v2.0)

```
prospect_leads(query) 
  → Tavily broad search (encontra decisores no segmento)
  → Haiku extrai contatos estruturados
  → deepEnrichContact(por pessoa):
      Tavily: "{Nome}" "{Empresa}" email contato linkedin
      → email_source: "web" (encontrado) ou "pattern" (inferido)
      → LinkedIn real encontrado na web
      → extra_info: contexto adicional sobre o lead
  → retorna lead completo pronto para outreach
```

## Quando usar
- Ao pedir "busque 1 lead de [segmento]" → `prospect_leads` direto
- Para enriquecer empresas da base com decisores → `enrich_company`
- Para completar campos faltantes (email, LinkedIn) de um lead parcial

## Ferramentas disponíveis

| Ferramenta | Quando usar |
|---|---|
| `prospect_leads` | Lead novo externo — busca + enriquece + email web em 1 chamada |
| `enrich_company` | Empresas já conhecidas — busca decisores com cargo, email, LinkedIn |
| `query_leads` | Leads já na nossa base — consulta por status, empresa, campanha |

## Campos retornados por prospect_leads

```json
{
  "name": "Ana Lima",
  "role": "Gerente de Eventos Corporativos",
  "company": "Claro Brasil",
  "email": "ana.lima@claro.com.br",
  "email_source": "web",
  "email_confidence": "high",
  "domain": "claro.com.br",
  "linkedin": "https://www.linkedin.com/in/ana-lima-claro",
  "extra_info": "Ana Lima coordena eventos de grande porte para Claro Brasil...",
  "source": "https://linkedin.com/in/..."
}
```

**`email_source`:**
- `"web"` — email encontrado diretamente na internet (alta confiança)
- `"pattern"` — inferido por padrão corporativo (valide antes do outreach)

## Campos retornados por enrich_company

```json
{
  "company": "Claro Brasil",
  "name": "Ricardo Santos",
  "role": "VP de Marketing",
  "area": "marketing",
  "seniority": "director",
  "linkedin": "linkedin.com/in/ricardosantos-claro",
  "email": "r.santos@claro.com.br",
  "emailInferred": true,
  "confidence": "high",
  "score": 92,
  "notes": "Decisor de contratação de fornecedores de eventos"
}
```

## Score de fit com ICP (0-100)

| Range | Classificação |
|---|---|
| > 75 | HOT — prioridade máxima |
| 50-75 | WARM — nurture ativo |
| < 50 | COLD — manter para nurture longo prazo |

## Exemplo de uso

**Input no chat:**
```
busque 1 lead de marketing de eventos enterprise em São Paulo
```

**O agente executa:** `prospect_leads` → retorna lead completo com email + LinkedIn

**Output:**
```
✅ Lead encontrado e enriquecido:

Nome: Ana Lima
Cargo: Gerente de Eventos Corporativos
Empresa: Claro Brasil
Email: ana.lima@claro.com.br (encontrado na web ✓)
LinkedIn: https://www.linkedin.com/in/ana-lima-claro
Contexto: Coordena eventos de grande porte para Claro Brasil, trabalha com fornecedores premium
Fonte: linkedin.com/in/...
```

---
**Tags:** Técnico | Operacional | Comercial, Enricher, Pipeline, Email Web, LinkedIn
