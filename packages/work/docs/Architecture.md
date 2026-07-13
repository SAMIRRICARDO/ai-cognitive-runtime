# VRAXIA WORK — Arquitetura

## Antes (estado anterior)

```
hunt.ts
  → MatchAgent (score)
  → LinkedInApplyEngine (DOM automation)
  → StatusTracker.updateStatus('applied')  ← estado binário
```

**Problema:** `applied` era set em qualquer fechamento de modal. Sem evidências. Sem validação real. Dashboard mostrava o que o robô achava.

## Depois (estado atual)

```
hunt.ts
  → MatchAgent (score 0-100, 6 dimensões, 5-day cache)
  → ApplicationService (orquestrador)
      ├── ApplicationStateMachine (21 estados, transições validadas)
      ├── EvidenceCollector (screenshots, HTML, network, console)
      ├── ApplicationTracer (trace.json, timeline.json)
      ├── LinkedInApplyEngine (DOM automation + retry)
      ├── ValidationEngine (3 métodos: rede, My Jobs, página)
      ├── HealthCheck (12 checks, score 0-100, health-report.json)
      ├── ApplicationTruthEngine (provas objetivas, ConfidenceLevel)  ← NOVO
      └── ErrorClassifier (17 categorias, RCA automático)            ← NOVO
  → ApplicationRepository (SQLite: estados, scores, truth, errors)
```

## Ciclo de Vida Completo

```
discovered → queued → starting → opening_job → opening_easy_apply
         → uploading_resume → filling_questions → reviewing
         → submitting → submitted → validating → confirmed
                                                      ↓
                                              interview → offer → hired
                                                         ↓
                                                      rejected
         ↓
      failed/cancelled/blocked/timeout/already_applied
         ↓
      retrying → starting (retry loop)
```

## Módulos

| Módulo | Responsabilidade |
|--------|-----------------|
| `ApplicationStateMachine` | 21 estados, transições validadas, nunca permite estado inválido |
| `EvidenceCollector` | Captura screenshots, HTML, rede, console — desanexa listeners por job |
| `ApplicationTracer` | Escreve trace.json e timeline.json por candidatura |
| `LinkedInApplyEngine` | Automação DOM com retry, keepalive, upload, questionnaire |
| `ValidationEngine` | Valida submit em tempo real: rede → My Jobs → texto de página |
| `HealthCheck` | 12 verificações pós-process, grava health-report.json |
| `ApplicationTruthEngine` | Avaliação objetiva pós-hoc com provas e ConfidenceLevel ← NOVO |
| `ErrorClassifier` | 17 categorias de erro + RCA automático ← NOVO |
| `RetryEngine` | Backoff exponencial com políticas de retry por categoria |
| `ApplicationRepository` | SQLite: upsert, updateState, saveTruth, saveError, stats |

## Banco de Dados

```sql
job_applications
  -- Campos existentes --
  id, job_title, company, location, platform, status, score_total
  application_state  -- estado granular da máquina
  trace_id, evidence_dir
  validation_method, validation_confidence
  retry_count, total_duration_ms
  -- Campos novos --
  confidence          -- CONFIRMED | PROBABLE | FAILED | UNKNOWN
  validation_score    -- 0-100
  proofs_json         -- array JSON de ApplicationProof
  error_category      -- ErrorCategory (17 tipos)
  error_rca           -- Root Cause Analysis automático
  health_score        -- 0-100

score_cache
  job_id, scored_at, score_json  -- 5-day TTL

application_attempts
  id, application_id, attempt_number, state, started_at
  finished_at, duration_ms, error, stack, screenshot_path
```

## Custo

| Componente | Custo por candidatura |
|------------|-----------------------|
| Scoring (MatchAgent Haiku) | ~$0.003 |
| Questionnaire LLM (Haiku, quando chamado) | ~$0.002 por pergunta |
| Score cache hit | $0 |
| CPU-only (filtro geo/título) | $0 |

## Observabilidade

Toda candidatura gera:
- `trace.json` — todos os eventos do fluxo com timestamps
- `timeline.json` — transições de estado com duração por etapa
- `network.json` — requisições de rede relacionadas ao apply
- `console.log` — output do console do browser
- `manifest.json` — inventário de todas as evidências
- `health-report.json` — resultado dos 12 checks
- `truth-record.json` — avaliação objetiva com provas ← NOVO
- Screenshots PNG em cada etapa crítica
- HTML snapshots em pontos de falha
