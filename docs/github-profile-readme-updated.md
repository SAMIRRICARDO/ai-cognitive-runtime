<div align="center">

# Samir Ricardo Almeida

**AI Solutions Architect · Fundador VRASHOWS · Criador do Human RAG**

[![LinkedIn](https://img.shields.io/badge/LinkedIn-samirricardo-0A66C2?logo=linkedin&logoColor=white&style=flat-square)](https://linkedin.com/in/samirricardo)
[![Email](https://img.shields.io/badge/Email-contato@vrashows.com.br-EA4335?logo=gmail&logoColor=white&style=flat-square)](mailto:contato@vrashows.com.br)
[![Livro](https://img.shields.io/badge/Amazon-O%20Maior%20Ativo-FF9900?logo=amazon&logoColor=white&style=flat-square)](https://a.co/d/0dTw8I9Y)

</div>

---

## O que construo

Sistemas de IA que preservam o que as empresas perdem quando pessoas saem.

**75% das empresas familiares brasileiras fecham após a saída do fundador** — não por falta de capital, mas por perda de conhecimento estratégico (PwC).

Resolvi esse problema criando o **Human RAG**.

---

## Human RAG

```
RAG tradicional  →  indexa documentos  →  recupera texto
Human RAG        →  indexa raciocínio  →  reconstrói decisões
```

RAG tradicional indexa **o que foi escrito**.  
Human RAG indexa **como a pessoa pensa e decide**.

Implementado no **VRAXIA** — Enterprise AI OS em produção com 11 agentes especializados operando inteligência comercial e operações empresariais simultâneas.

| Métrica | Resultado em produção |
|---|---|
| ↓ Custo de inferência IA | **80%** |
| ↑ Eficiência operacional | **40%** |
| ↓ Falhas por contexto perdido | **30%** |

---

## Projeto principal

### [ai-cognitive-runtime](https://github.com/SAMIRRICARDO/ai-cognitive-runtime) — VRAXIA Enterprise AI OS

```bash
# Demo em 2 minutos — veja Human RAG ao vivo
git clone https://github.com/SAMIRRICARDO/ai-cognitive-runtime
cd ai-cognitive-runtime && npm install
npx tsx demo/human-rag-demo.ts
```

---

## Arquitetura de Agentes

### Núcleo Cognitivo

| Agente | Responsabilidade |
|---|---|
| `coordinator` | Decomposição de tarefas em DAGs, orquestração multi-agente |
| `researcher` | Pesquisa web, fact-finding, inteligência de mercado |
| `coder` | Geração de código, debugging, refatoração, testes |
| `evaluator` | Avaliação de qualidade, loops de reflexão e critique |
| `vault` | Busca semântica e keyword na base Obsidian |
| `memory-manager` | Gestão e consulta de memória episódica/semântica |

### Inteligência Comercial (VRASHOWS)

| Agente | Responsabilidade |
|---|---|
| `futurecom-researcher` | Identifica expositores Futurecom com potencial 360° via web intelligence |
| `lead-enrichment-agent` | Enriquece leads com decisores, contatos e inteligência estratégica |
| `outreach-agent` | Gera pacotes de outreach consultivo enterprise (email + LinkedIn) |
| `lead-classifier` | Qualifica respostas de decisores (variantes A–E, intent, handoff) |
| `email-sender-agent` | Dispara emails enterprise via Resend com dedup e rate limiting |

---

## Pipeline de Inteligência Outbound

```
Pesquisa        →  futurecom-researcher  (Tavily web search + scoring)
     ↓
Enriquecimento  →  lead-enrichment-agent (decisores, emails, LinkedIn)
     ↓
Validação       →  email-quality + blocklist + pattern resolver (40+ empresas)
     ↓
Outreach        →  outreach-agent        (template personalizado por perfil)
     ↓
Disparo         →  email-sender-agent    (Resend API, batch controlado)
     ↓
Classificação   →  lead-classifier       (resposta → A/B/C/D/E → CRM)
```

---

## Memória Multi-Camada

```
Redis          →  cache de curto prazo, dedup, acumulação de custo
PostgreSQL     →  memória semântica de longo prazo (pgvector)
SQLite         →  cache local offline
Obsidian Vault →  memória arquitetural e decisional (Human RAG)
```

---

## Ferramentas e Integrações

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white&style=flat-square)
![Node.js](https://img.shields.io/badge/Node.js-339933?logo=nodedotjs&logoColor=white&style=flat-square)
![Claude](https://img.shields.io/badge/Claude%204-D4A017?logo=anthropic&logoColor=white&style=flat-square)
![PostgreSQL](https://img.shields.io/badge/pgvector-4169E1?logo=postgresql&logoColor=white&style=flat-square)
![Redis](https://img.shields.io/badge/Redis-DC382D?logo=redis&logoColor=white&style=flat-square)
![SQLite](https://img.shields.io/badge/SQLite-003B57?logo=sqlite&logoColor=white&style=flat-square)
![Resend](https://img.shields.io/badge/Resend-000000?logo=mail&logoColor=white&style=flat-square)
![Telegram](https://img.shields.io/badge/Telegram-26A5E4?logo=telegram&logoColor=white&style=flat-square)
![Playwright](https://img.shields.io/badge/Playwright-45ba4b?logo=playwright&logoColor=white&style=flat-square)

**Canais de entrega:** Email (Resend) · LinkedIn · Telegram · WhatsApp  
**Observabilidade:** token usage · latência · custo por agente · workflow tracing  
**Governança de custo:** cheap mode · seleção dinâmica de modelo · caps de batch

---

## Publicação

**[O Maior Ativo da Sua Empresa — E por que ele está indo embora?](https://a.co/d/0dTw8I9Y)**  
Amazon KDP · Junho 2026 · R$ 24,99 Kindle

O primeiro livro brasileiro sobre Human RAG aplicado à preservação de conhecimento organizacional.

---

<div align="center">
<sub>VRASHOWS · contato@vrashows.com.br · (11) 95357-7804</sub>
</div>
