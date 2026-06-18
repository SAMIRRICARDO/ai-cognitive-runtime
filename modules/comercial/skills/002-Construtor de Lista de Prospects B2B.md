---
name: construtor-de-lista-de-prospects-b2b
description: Montar uma lista de prospecção B2B qualificada com critérios de ICP, fontes de dados e instruções para o Enricher Agent do VRAXIA — gerando leads com email corporativo validado, cargo e contexto pronto para o outbound personalizado.
tags: [lista, prospecção, leads, b2b, enricher, outbound, qualificação]
---

# Construtor de Lista de Prospects B2B

## Objetivo
Montar uma lista de prospecção B2B qualificada aplicando filtros do ICP — setor, porte, cargo, localização — com instruções para o Enricher Agent do VRAXIA encontrar e validar emails corporativos, gerando uma lista pronta para o dispatcher de outbound.

## Quando usar
- Antes de disparar uma campanha de outbound no VRAXIA
- Quando precisa escalar a prospecção para um novo segmento
- Ao criar uma lista para o `outbound-log.json` do pipeline
- Para alimentar o `EmailPatternResolver` com novos domínios

## Como usar
1. Execute no agente Comercial AI passando o ICP definido
2. O agente gera os critérios de busca para cada fonte
3. Passe os critérios para o Enricher Agent (`agents/enricher`)
4. O Enricher resolve emails via `EmailPatternResolver` e valida com DMARC
5. A lista validada vai para o `outbound-log.json`

## O Prompt
```
Você é um especialista em construção de listas de prospecção B2B para sistemas de outbound automatizado. Uma lista boa tem: (1) fit perfeito com o ICP, (2) email corporativo verificado, (3) contexto personalizado para o copy, (4) zero spam traps.

Monte a estratégia de construção de lista para o seguinte ICP:

**ICP definido:**
- Setor: [ex: SaaS B2B, Fintech, Agência Digital]
- Porte: [faturamento ou nº funcionários]
- Cargo do decisor: [CTO, CEO, VP de Ops...]
- Localização: [Brasil/LATAM/específico]
- Sinais de momento: [se houver]

**Volume desejado:** [quantos leads na lista]
**Prazo:** [quando precisa estar pronto]

Entregue:

**1. FONTES DE DADOS (ordenadas por qualidade)**
Para cada fonte: como usar, filtros a aplicar, custo estimado

**2. BOOLEAN STRINGS — LinkedIn Sales Navigator**
Strings de busca prontas para copiar e usar

**3. BOOLEAN STRINGS — Google / Apollo / Hunter**
Variações de busca por fonte

**4. CRITÉRIOS PARA O ENRICHER AGENT (VRAXIA)**
- Campos obrigatórios a coletar por lead
- Padrões de email a testar (EmailPatternResolver)
- Domínios prioritários
- Score mínimo de confiança aceitável

**5. CRITÉRIOS DE EXCLUSÃO DA LISTA**
- O que desqualifica automaticamente um lead

**6. ESTRUTURA DO PAYLOAD**
JSON schema com os campos esperados pelo dispatcher do VRAXIA:
{
  "nome": "",
  "email": "",
  "cargo": "",
  "empresa": "",
  "setor": "",
  "linkedin": "",
  "contexto": "",
  "score": 0,
  "fonte": ""
}

**7. META DE QUALIDADE**
- Percentual mínimo de emails válidos esperado
- Taxa de bounce aceitável (<3% para manter reputação)
- Estratégia se a lista ficar abaixo da meta
```

## Exemplo de uso

### Input
ICP: SaaS B2B 50-200 funcionários, CTO ou VP de Produto, Brasil, sinal: job posting para engenheiros
Volume: 200 leads qualificados

### Output
**Fontes:** LinkedIn Sales Navigator (1ª escolha, filtro: cargo+empresa+setor), Apollo.io (2ª — exporta email direto), RocketReach (fallback)

**LinkedIn Boolean:**
`(CTO OR "VP de Produto" OR "Head of Product") AND (SaaS OR "software B2B") AND (Brasil OR Brazil) NOT (estagiário OR analista)`

**Enricher Agent Config:**
```json
{
  "emailPatterns": ["nome.sobrenome", "n.sobrenome", "nome", "nomesobrenome"],
  "minConfidence": 0.7,
  "validateMx": true,
  "validateDmarc": true,
  "collectFields": ["linkedin", "cargo", "empresa", "setor", "tamanho"]
}
```

---
**Tags:** Fundacional | Geração | Comercial, Outbound, Enricher
