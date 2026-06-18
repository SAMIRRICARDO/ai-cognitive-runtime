---
name: enriquecimento-de-lead-enricher-agent
description: Enriquecer um lead básico (nome + empresa) com todos os campos necessários para o outbound — email corporativo via EmailPatternResolver, LinkedIn, cargo, porte da empresa, tech stack e score de fit com o ICP — usando o Enricher Agent do VRAXIA.
tags: [enricher, enriquecimento, lead, emailpatternresolver, icp, score, dados, prospecto]
---

# Enriquecimento de Lead (Enricher Agent)

## Objetivo
Enriquecer um lead básico — muitas vezes só nome e empresa — com todos os campos necessários para o outbound personalizado: email corporativo via `EmailPatternResolver`, URL do LinkedIn, cargo exato, porte da empresa, tech stack e score de fit com o ICP. Saída em JSON pronto para o `outbound-log.json` do VRAXIA.

## Quando usar
- Ao importar leads de eventos, indicações ou listas com dados incompletos
- Quando o `EmailPatternResolver` precisa ser calibrado com um novo domínio
- Para completar campos faltantes antes de adicionar ao pipeline de outbound
- Ao processar leads vindos do LinkedIn sem email confirmado

## Como usar
1. Passe o lead básico (nome + empresa + o que tiver) para o Enricher Agent
2. O agente usa este prompt para estruturar a estratégia de enriquecimento
3. O `EmailPatternResolver` testa os padrões de email do domínio
4. O resultado é validado (skill 003) antes de entrar no pipeline
5. Score de fit é calculado contra o ICP configurado

## O Prompt
```
Você é o Enricher Agent de um sistema de outbound B2B. Seu trabalho é transformar dados incompletos em um payload de lead completo e validado, pronto para o pipeline de prospecção.

**DADOS DISPONÍVEIS DO LEAD:**
- Nome: [nome completo ou parcial]
- Empresa: [nome da empresa]
- Outros dados: [qualquer outro dado disponível — cargo, cidade, LinkedIn]

**ICP CONFIGURADO (para calcular o score):**
- Setor ideal: [ex: SaaS B2B, Fintech]
- Porte ideal: [ex: 50-300 funcionários]
- Cargo do decisor ideal: [ex: CTO, CEO, VP de Ops]
- Sinais de momento ideal: [ex: série A, expansão de time]

**FONTES DISPONÍVEIS PARA ENRIQUECIMENTO:**
[liste as fontes que o agente pode usar: LinkedIn, site da empresa, Apollo, Crunchbase, news]

Execute o enriquecimento em etapas:

**ETAPA 1 — IDENTIFICAÇÃO DA EMPRESA**
- Nome completo e variações do nome da empresa
- Site oficial (domínio para o EmailPatternResolver)
- Setor (SIC/CNAE ou descrição)
- Porte (funcionários, faturamento estimado, rodada de investimento)
- Tecnologias detectadas (tech stack do site)
- Últimas notícias relevantes (últimas 12 semanas)

**ETAPA 2 — IDENTIFICAÇÃO DO PROSPECT**
- Cargo exato e variações (como aparece no LinkedIn)
- URL do perfil LinkedIn
- Tempo no cargo atual (novo cargo = oportunidade)
- Posts recentes (para o RAG Agent contextualizar)
- Decisor de compra? Influenciador? Bloqueador?

**ETAPA 3 — RESOLUÇÃO DE EMAIL (EmailPatternResolver)**
Padrões a testar em ordem de probabilidade:
1. nome.sobrenome@dominio.com
2. n.sobrenome@dominio.com
3. nome@dominio.com
4. nomesobrenome@dominio.com
5. sobrenome@dominio.com
6. [outros padrões encontrados no domínio]

Para cada padrão: confidence score estimado (baseado no que se sabe do domínio)

**ETAPA 4 — SCORE DE FIT COM ICP (0-100)**
- Setor: [score parcial e justificativa]
- Porte: [score parcial e justificativa]
- Cargo: [score parcial e justificativa]
- Momento: [score parcial e justificativa]
- SCORE TOTAL: [0-100]
- CLASSIFICAÇÃO: HOT (>75) | WARM (50-75) | COLD (<50)

**ETAPA 5 — PAYLOAD FINAL (JSON para outbound-log)**
```json
{
  "id": "[uuid]",
  "nome": "",
  "primeiroNome": "",
  "email": "",
  "emailConfidence": 0.0,
  "cargo": "",
  "empresa": "",
  "dominio": "",
  "setor": "",
  "porte": "",
  "linkedin": "",
  "contexto": "",
  "icpScore": 0,
  "icpClassificacao": "",
  "status": "pendente",
  "fonte": "",
  "enriquecidoEm": ""
}
```
```

## Exemplo de uso

### Input
Nome: João Silva | Empresa: DataLayer
Dados adicionais: vi o nome no LinkedIn, cargo "CTO"
ICP: SaaS B2B, 30-200 funcionários, CTO/CEO, Brasil

### Output
Empresa: DataLayer Tecnologia LTDA | Site: datalayer.com.br | Setor: SaaS/Dados | Porte: ~45 funcionários | Sede: São Paulo
Tech stack: AWS, Python, PostgreSQL (detectado no site/jobs)

Prospect: João Paulo Silva | Cargo: CTO & Co-founder | LinkedIn: linkedin.com/in/jpsilva-datalayer | Cargo há: 2.5 anos
Padrão de email: j.silva@datalayer.com.br (confidence 0.78 — padrão mais comum detectado em 2 outros emails do domínio)

ICP Score: 82/100 — HOT (SaaS B2B ✓, porte ✓, cargo CTO ✓, fundador = decisor direto ✓)

---
**Tags:** Técnico | Operacional | Comercial, Enricher, Pipeline, Dados
