# VRAXIA WORK — Runbook Operacional

## Início rápido

```powershell
# 1. Instalar dependências
cd packages/work
npm install

# 2. Iniciar servidor API
npx tsx src/api/server.ts

# 3. Iniciar hunt noturno (modo headless, 24 vagas)
npx tsx src/cli/hunt.ts --platform linkedin --limit 24 --headless

# 4. Monitor
Get-Content .vraxia-work/logs/hunt-*.log -Wait
```

## Variáveis de ambiente necessárias

| Variável | Obrigatório | Padrão | Descrição |
|----------|-------------|--------|-----------|
| `ANTHROPIC_API_KEY` | Sim | — | Chave Haiku para Q&A |
| `VRAXIA_DB_PATH` | Não | `.vraxia-work/work.db` | SQLite |
| `VRAXIA_LOG_DIR` | Não | `.vraxia-work/logs` | Evidências por candidatura |
| `VRAXIA_EVIDENCE_DIR` | Não | `VRAXIA_LOG_DIR` | Screenshots e trace files |
| `TELEGRAM_BOT_TOKEN` | Não | — | Notificações |
| `TELEGRAM_CHAT_ID` | Não | — | Chat de destino |

## Verificação de saúde

```bash
# API respondendo?
curl http://localhost:3001/api/work/health

# Truth stats (últimas candidaturas)
curl http://localhost:3001/api/work/truth-stats

# Funil
curl http://localhost:3001/api/work/funnel
```

## Diagnóstico de falhas

### Hunt não inicia
1. Verificar se o browser Playwright está instalado: `npx playwright install chromium`
2. Verificar se há sessão LinkedIn válida em `.linkedin-profile/`
3. Verificar log: `cat .vraxia-work/logs/hunt-latest.log`

### Custo acima do esperado
1. Verificar campo `api_called` no QA cache: `api_called === true` significa chamada real ao Haiku
2. Rodar `/api/work/stats` e checar `estimatedCostUsd`
3. Candidaturas com muitas perguntas abertas custam mais — verificar `FAST` vs `LLM` no log de questionários

### Candidaturas com confidence UNKNOWN
1. A evidência está em `.vraxia-work/logs/application_<id>/`
2. Verificar se `network.json` existe e tem entradas
3. Re-avaliar manualmente: `GET /api/work/evidence/<id>/truth`
4. Se evidência está incompleta, verificar se `ValidationEngine` teve timeout

### Score sempre baixo (abaixo de 50)
1. Verificar se o score_cache foi invalidado: `SELECT * FROM score_cache WHERE scored_at > datetime('now', '-5 days')`
2. Verificar se as dimensões de score estão corretas — o MatchAgent usa 6 dimensões (0-100)
3. Ajustar thresholds: `APPLY >= 75`, `REVIEW >= 50`

## Manutenção

### Limpar candidaturas antigas (mais de 30 dias)
```sql
DELETE FROM job_applications WHERE updated_at < datetime('now', '-30 days') AND status IN ('filtered_out', 'error');
DELETE FROM score_cache WHERE scored_at < datetime('now', '-5 days');
```

### Reiniciar evidências corrompidas
```bash
rm -rf .vraxia-work/logs/application_<id>/
# Re-executar o hunt para re-candidatar
```

### Backup do banco
```powershell
Copy-Item .vraxia-work/work.db ".vraxia-work/work.db.bak-$(Get-Date -Format 'yyyyMMdd')"
```

## Ciclo noturno (NOITE.ps1)

O script `NOITE.ps1` executa 3 rodadas de hunt com limites progressivos:
- Rodada 1: 8 vagas
- Rodada 2: 8 vagas (score ≥ 60)
- Rodada 3: 8 vagas (score ≥ 50)

Logs enviados automaticamente via Telegram ao final de cada rodada.

## Indicadores de produção saudável

| Indicador | Meta |
|-----------|------|
| Truth Rate | ≥ 60% |
| Avg Health Score | ≥ 70 |
| CONFIRMED em 24h | ≥ 10 |
| Custo por candidatura | ≤ $0.005 |
| Cache hit rate | ≥ 70% |
| DOM_ERROR rate | ≤ 5% |
| CAPTCHA_ERROR rate | ≤ 2% |
