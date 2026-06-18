---
name: scheduler-de-aquisicao-diaria-e-governanca-do-runtime
description: Documentação do scheduler de aquisição automática de leads (07:30 segunda a sexta), governança do runtime (AGENTS.md + runtime-config.json), rotação automática de pool quando exausto, e limites operacionais do sistema VRAXIA.
tags: [scheduler, aquisição, governança, runtime-config, agents, cheap-mode, pool-rotation, sqlite, logs, automação]
---

# Scheduler de Aquisição Diária e Governança do Runtime

## Scheduler de Aquisição

O `lead-acquisition-scheduler.ts` roda automaticamente via Tarefa Windows:

| Campo | Valor |
|---|---|
| Nome da tarefa | VRASHOWS Lead Acquisition |
| Horário | 07:30 (segunda a sexta) |
| Máx leads/rodada | 25 |
| Máx execuções/dia | 1 |
| Finais de semana | Bloqueados |
| Deduplicação | SQLite cache + processedCompanyHashes (state) |
| Rotação de pool | Automática quando pool exausto |

**Execução manual:**
```bash
npm run leads:acquire
# Forçar (ignora guard de data):
npx tsx scheduler/lead-acquisition-scheduler.ts --force
```

## Rotação Automática de Pool

Quando todos os candidatos do pool foram processados (`leads=0, duplicatesRemoved >= pool`):

1. Detecta esgotamento
2. Limpa cache SQLite: `DELETE FROM companies WHERE status = 'acquired'`
3. Reseta `processedCompanyHashes: []` no state file
4. Loga `reason: "pool_rotated: cleared N entries"`
5. Reinicia o ciclo — pool completo disponível novamente

O pool contém ~40 empresas B2B enterprise (Google Cloud, AWS, NVIDIA, Huawei, Accenture, etc.) ranqueadas por `eventFitScore + enterpriseScore`.

## Governança — runtime-config.json

```json
{
  "cheapMode": true,
  "preferredModel": "claude-haiku-4-5-20251001",
  "maxLeadsPerBatch": 25,
  "maxDailyRuns": 1,
  "runTime": "07:30",
  "weekendBlocked": true,
  "maxOutputTokens": 300,
  "poolRotationDays": 90,
  "linkedin": {
    "dailyCap": 15,
    "delayMinMs": 75000,
    "delayMaxMs": 180000
  }
}
```

## Governança — AGENTS.md

Regras permanentes (não podem ser alteradas sem revisão explícita):

- `cheapMode: true` — Haiku para sourcing e enrichment simples
- `maxDailyRuns: 1` — máximo 1 execução do scheduler por dia útil
- `maxOutputTokens: 300` — respostas curtas, JSON only
- `preferredModel: claude-haiku-4-5-20251001` — modelo cheap Claude-nativo
- Sem daemon infinito — processos encerram após finalizar o batch
- Deduplicação obrigatória antes de persistir novos leads
- Logs obrigatórios em `logs/lead-acquisition.log`

## Arquivos gerados pelo scheduler

```
data/leads/futurecom/
  futurecom-expansion-2026-06-18.json   ← leads do dia
  .lead-acquisition-state.json          ← state: lastRunDate, hashes processados
logs/
  lead-acquisition.log                  ← linha JSON por execução
```

**Formato do log:**
```json
{
  "timestamp": "2026-06-18T10:30:02Z",
  "date": "2026-06-18",
  "status": "success",
  "leads": 23,
  "duplicatesRemoved": 13,
  "errors": [],
  "executionTimeMs": 120,
  "outputFile": "data/leads/futurecom/futurecom-expansion-2026-06-18.json"
}
```

## Outbound rules

- Batches pequenos — sem spam
- Throttling humano ativo (`humanThrottle: true`)
- Horário comercial apenas — máx até 16h
- Attachment obrigatório: `vrashows_media_kit_optimized.pdf`
- Não disparar novo batch antes do atual finalizar

## SQLite cache (memory/cache/ialeads-runtime.sqlite)

| Tabela | O que armazena |
|---|---|
| `companies` | Empresas adquiridas (deduplicação de pool) |
| `leads` | Contatos enriquecidos |
| `outbound_history` | Histórico de envios por email+campanha |
| `prompts_memory` | Cache de prompts/respostas (evita reprocessamento) |
| `runtime_logs` | Logs de eventos do runtime |

**Limpar cache de aquisição manualmente:**
```typescript
import { getIALeadsCache } from './memory/sqlite-cache.js';
getIALeadsCache().clearAcquiredCompanies();
```

---
**Tags:** Técnico | Governança | Comercial, Scheduler, Runtime, SQLite, Logs, Automação
