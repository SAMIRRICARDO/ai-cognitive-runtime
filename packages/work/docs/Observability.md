# VRAXIA WORK — Observabilidade

## Arquivos de Evidência por Candidatura

Todo job aplicado gera um diretório `.vraxia-work/logs/application_<jobId>/` contendo:

| Arquivo | Gerado por | Conteúdo |
|---------|-----------|---------|
| `trace.json` | ApplicationTracer | Todos os eventos do fluxo com timestamps e payloads |
| `timeline.json` | ApplicationTracer | Transições de estado com duração por etapa |
| `network.json` | EvidenceCollector | Requisições de rede interceptadas pelo browser |
| `console.log` | EvidenceCollector | Output do console JavaScript da página |
| `manifest.json` | EvidenceCollector | Inventário de todas as evidências com checksums |
| `health-report.json` | HealthCheck | Resultado dos 12 checks com score 0-100 |
| `truth-record.json` | ApplicationTruthEngine | TruthRecord com provas e ConfidenceLevel |
| `*.png` | Playwright | Screenshots em cada etapa crítica |
| `*.html` | Playwright | DOM snapshots em pontos de falha |

## Endpoints de Observabilidade

```
GET  /api/work/health                          → Status da API e DB
GET  /api/work/stats                           → KPIs gerais (total, custo, taxa)
GET  /api/work/truth-stats                     → Métricas Truth Engine
GET  /api/work/funnel                          → Contagem por estado do ciclo de vida
GET  /api/work/evidence/:jobId/truth           → TruthRecord de uma candidatura
GET  /api/work/applications/:jobId/analytics   → Analytics completo (truth+health+timeline)
GET  /api/work/chart/daily                     → Candidaturas por dia (14d)
GET  /api/work/chart/companies                 → Top empresas
```

## Dashboard

O Dashboard em `dashboard/index.html` exibe:

- **KPIs**: vagas escaneadas, candidaturas, custo estimado, last run
- **Truth Engine** (aba "Truth Engine"):
  - Truth Rate (CONFIRMED / total)
  - Funil de candidatura baseado em evidências
  - Classificação de erros por categoria + RCA
  - Tipos de prova coletadas com pesos
  - Gráfico de distribuição de confiança
- **Analytics**: funil tradicional, distribuição de score, plataformas
- **Gráficos**: candidaturas por dia, status, top empresas

## ApplicationTruthEngine — Decisão de Confiança

```
score = sum(proof.weight for each proof collected)

CONFIRMED: score >= 50 OR hard_proof exists
PROBABLE:  score >= 25
FAILED:    state in FAILED_STATES AND score = 0
UNKNOWN:   otherwise
```

Hard proofs (qualquer um confirma sozinho):
- `network_submit_200` (weight=50): POST 200/201 ao endpoint de submit
- `my_jobs_applied` (weight=40): candidatura aparece em My Jobs > Applied
- `ats_confirmation` (weight=45): ATS externo retornou confirmação

## ErrorClassifier — Categorias e RCA

| Categoria | Pattern | Retryable |
|-----------|---------|-----------|
| `TIMEOUT_ERROR` | timeout, navigation timeout | Sim |
| `DOM_ERROR` | strict mode violation, locator | Sim |
| `CAPTCHA_ERROR` | captcha, recaptcha | Não |
| `LOGIN_ERROR` | 401, unauthorized, session expired | Não |
| `RATE_LIMIT_ERROR` | 429, rate limit | Não |
| `UPLOAD_ERROR` | setInputFiles, pdf not found | Sim |
| `SUBMIT_ERROR` | submit failed, form rejected | Sim |
| `ATS_ERROR` | greenhouse, lever, workday failed | Sim |
| `NAVIGATION_ERROR` | navigation failed, net::ERR | Sim |
| `LLM_ERROR` | anthropic api, model unavailable | Não |
| `ANTI_BOT_ERROR` | bot detected, challenge | Não |

## Custo — Como Calcular

```
custo = llmCalls * (500 input_tokens * $0.80/M + 650 output_tokens * $4.00/M)
      + scoringCalls * (4000 input_tokens * $0.80/M + 256 output_tokens * $4.00/M)
```

- `llmCalls` = entradas com `api_called === true` no QA cache
- `scoringCalls` = chamadas ao MatchAgent sem cache hit

Cache de score (5 dias TTL) zera o custo de scoring em re-execuções.

## Score Health de uma Candidatura

```
health_score = média ponderada de 12 checks:
  - confirmation_text_exists (15pts)
  - no_error_in_trace (20pts)
  - state_reached_confirmed (20pts)
  - network_submit_200 (20pts)
  - validation_ran (10pts)
  - health_check_ran (5pts)
  - screenshots_exist (5pts)
  - ... (outros checks)
```

Score ≥ 80 = saudável. Score < 50 = investigar.
