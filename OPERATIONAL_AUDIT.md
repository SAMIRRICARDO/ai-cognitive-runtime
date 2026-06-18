# OPERATIONAL AUDIT — VRAXIA OS

> **Data:** 2026-06-18 | **Tipo:** Auditoria operacional — sem alterações no código  
> **Objetivo:** Identificar bloqueadores exatos para execução local e produção

---

## Como iniciar localmente

### Modo mínimo — funciona agora, sem Docker

```bash
# 1. Variáveis mínimas obrigatórias
cp .env.example .env
# Editar .env: adicionar ANTHROPIC_API_KEY, TELEGRAM_BOT_TOKEN, DEV_MODE=true

# 2. Instalar dependências
npm install

# 3. Iniciar API principal (porta 3000)
npm run api:dev
# → Dashboard acessível em http://localhost:3000/vraxia
# → API disponível em http://localhost:3000/api/health
```

### Para o webhook server separado (Waalaxy)

```bash
# Terminal separado — porta 3001
npm run start:webhook
```

### Dashboard standalone (porta 4200)

```bash
npm run dashboard
# → http://localhost:4200/vraxia/index.html
```

### Com infraestrutura completa (Redis + Postgres)

```bash
# Pré-requisito: Docker instalado
npm run infra:up

# ATENÇÃO: Postgres exposto na porta 5433 (não 5432!)
DATABASE_URL=postgresql://ailab:ailab@localhost:5433/ai_lab
ENABLE_MEMORY=true

npm run api:dev
```

---

## Dependências obrigatórias

| Dependência | Versão | Obrigatória | Quando |
|---|---|---|---|
| **Node.js** | >= 18 (ESM nativo) | **SIM** | Sempre |
| **npm** | >= 9 | **SIM** | Sempre |
| **Docker** | qualquer | NÃO | Apenas com ENABLE_MEMORY=true |
| **PostgreSQL** | 16 + pgvector | NÃO | Apenas com ENABLE_MEMORY=true |
| **Redis** | 7 | NÃO | Apenas com ENABLE_MEMORY=true |
| **tsx** | ^4.19 (incluído) | SIM | Dev runner — via npx |
| **cross-env** | ^10.1 (incluído) | SIM | Scripts de dev |

**Nota crítica:** O projeto usa ESM puro (`"type": "module"`). Node < 18 não funciona.

---

## Variáveis obrigatórias

### O `.env.example` está INCOMPLETO — variáveis em uso que não estão documentadas

| Variável | Obrigatória | Presente no .env.example | Onde é usada |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | **SIM** | ✅ | Todos os agentes |
| `DEV_MODE` | Recomendada | ❌ **AUSENTE** | api/server.ts — bypass tenant auth |
| `ENABLE_MEMORY` | Recomendada | ❌ **AUSENTE** | module-agent.ts — desabilita Redis/pgvector |
| `TELEGRAM_BOT_TOKEN` | SIM (Sense handoffs) | ❌ **AUSENTE** | tools/telegram.ts |
| `VRAXIA_MASTER_KEY` | SIM (produção) | ❌ **AUSENTE** | tenant/manager.ts |
| `VRAXIA_ADMIN_KEY` | SIM (admin routes) | ❌ **AUSENTE** | api/routes/admin.ts |
| `TAVILY_API_KEY` | SIM (find_new_leads) | ❌ **AUSENTE** | tools/find-new-leads.ts |
| `RESEND_FROM_NAME` | Sim (email) | ❌ **AUSENTE** | tools/send-email.ts |
| `MEDIA_KIT_PDF` | Sim (outbound) | ❌ **AUSENTE** | delivery-worker.ts |
| `API_PORT` | NÃO (default 3000) | ❌ **AUSENTE** | api/server.ts |
| `WEBHOOK_PORT` | NÃO (default 4000) | ❌ **AUSENTE** | workers/webhookServer.ts |
| `RESEND_API_KEY` | Sim (email) | ✅ | tools/send-email.ts |
| `RESEND_FROM_EMAIL` | Sim (email) | ✅ | tools/send-email.ts |
| `REDIS_URL` | NÃO | ✅ | memory/manager.ts |
| `DATABASE_URL` | NÃO | ✅ (errado — falta :5433) | memory/long-term/ |
| `CHEAP_MODE` | NÃO (default false) | ✅ | config/models.ts |
| `MAX_OUTPUT_TOKENS` | NÃO (default 8192) | ✅ | config/models.ts |

### Variáveis mínimas para o sistema funcionar (DEV_MODE)

```env
# Obrigatória
ANTHROPIC_API_KEY=sk-ant-...

# Essenciais para não travar
DEV_MODE=true
ENABLE_MEMORY=false
CHEAP_MODE=true

# Para notificações do Sense funcionar
TELEGRAM_BOT_TOKEN=...

# Para email funcionar
RESEND_API_KEY=...
RESEND_FROM_EMAIL=...
RESEND_FROM_NAME=...

# Para busca de novos leads funcionar
TAVILY_API_KEY=...
```

---

## Rotas disponíveis

### API Principal — `api/server.ts` (porta 3000)

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| `GET` | `/api/health` | Nenhuma | Health check |
| `POST` | `/api/run` | DEV ou tenant | SSE streaming — executa módulo departamental |
| `GET/POST` | `/api/modules` | DEV ou tenant | Lista e executa módulos |
| `GET/POST` | `/api/leads` | DEV ou tenant | CRUD de leads |
| `GET` | `/api/usage` | DEV ou tenant | Relatório de uso e custo |
| `POST` | `/api/sense/commercial` | **Nenhuma** | Webhook Waalaxy/LinkedIn |
| `GET` | `/api/sense/stats` | DEV ou tenant | Counters do VRAXIA Sense |
| `GET` | `/api/sense/events` | DEV ou tenant | Eventos recentes do Sense |
| `*` | `/admin/*` | Admin key header | Rotas administrativas |
| `GET` | `/vraxia/*` | Nenhuma | Dashboard SPA estático |
| `GET` | `/` | Nenhuma | Redireciona para /vraxia |

### Webhook Server — `workers/webhookServer.ts` (porta 3001)

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| `POST` | `/webhook/linkedin` | Nenhuma | LinkedIn genérico |
| `POST` | `/webhook/waalaxy` | Nenhuma | Waalaxy replies |
| `POST` | `/sense/commercial` | Nenhuma | Entrada alternativa do Sense |
| `GET` | `/health` | Nenhuma | Health check |

### Dashboard Standalone — `dashboard/server.js` (porta 4200)

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/vraxia/index.html` | Dashboard principal |
| `GET` | `/vraxia/comercial.html` | Dashboard comercial/Sense |
| `GET` | `/api/live-dashboard` | Métricas em tempo real do outbound |

---

## Dashboard

### Como iniciar

**Opção 1 — Via API (recomendado):**
```bash
npm run api:dev
# Dashboard disponível em: http://localhost:3000/vraxia
```

**Opção 2 — Standalone:**
```bash
npm run dashboard
# Dashboard disponível em: http://localhost:4200/vraxia/index.html
```

### O que funciona no dashboard

- Chat com qualquer módulo departamental via POST `/api/run` (SSE)
- Chips de sugestão por módulo
- Painel VRAXIA Sense: stats (polling 30s) + tabela de eventos recentes
- Indicadores visuais (live dot, pulse, custo, tokens)

### O que o dashboard ainda precisa

- `dashboard/server.js` aponta para `dashboard/index.html` (path antigo) — deveria ser `vraxia/index.html`
- O endpoint `/api/live-dashboard` do `dashboard/server.js` lê `logs/outbound-log.json` diretamente — não passa pela API REST

---

## Agentes que executam hoje sem desenvolvimento adicional

### Executam via `npm run api:dev` + chat no dashboard:

| Módulo/Agente | Comando | Skills | Pré-requisito |
|---|---|---|---|
| `comercial` | Chat no /vraxia → Comercial AI | 35 skills + 5 Codex tools | ANTHROPIC_API_KEY |
| `financeiro` | Chat no /vraxia → Financeiro AI | 100+ skills | ANTHROPIC_API_KEY |
| `juridico` | Chat no /vraxia → Jurídico AI | skills disponíveis | ANTHROPIC_API_KEY |
| `marketing` | Chat no /vraxia → Marketing AI | skills disponíveis | ANTHROPIC_API_KEY |
| `operacoes` | Chat no /vraxia → Operações AI | skills disponíveis | ANTHROPIC_API_KEY |
| `conteudo` | Chat no /vraxia → Conteúdo AI | skills disponíveis | ANTHROPIC_API_KEY |
| `lideranca` | Chat no /vraxia → Liderança AI | skills disponíveis | ANTHROPIC_API_KEY |
| `produto` | Chat no /vraxia → Produto AI | skills disponíveis | ANTHROPIC_API_KEY |
| `codigo` | Chat no /vraxia → Código AI | skills disponíveis | ANTHROPIC_API_KEY |

### Executam via CLI:

| Agente | Comando | Pré-requisito |
|---|---|---|
| `sense` (webhook) | `npm run start:webhook` + curl para /webhook/waalaxy | ANTHROPIC_API_KEY + TELEGRAM_BOT_TOKEN |
| `lead-acquisition` | `tsx scheduler/lead-acquisition-scheduler.ts` | ANTHROPIC_API_KEY |
| `outbound-scheduler` | `tsx scheduler/outbound-scheduler.ts --live` | RESEND_API_KEY + MEDIA_KIT_PDF |
| `researcher` | `tsx scripts/run-agent.ts researcher "query"` | ANTHROPIC_API_KEY + TAVILY_API_KEY |
| `coder` | `tsx scripts/run-agent.ts coder "task"` | ANTHROPIC_API_KEY |
| `coordinator` | `tsx scripts/run-agent.ts coordinator "goal"` | ANTHROPIC_API_KEY |

---

## Deploy

### `railway.toml` existe — com um problema crítico

```toml
[deploy]
startCommand = "npx tsx workers/webhookServer.ts"
```

**Problema:** O Railway está configurado para iniciar APENAS o webhook server (porta 3001). Isso significa que em produção no Railway:
- ✅ `/webhook/waalaxy` funciona
- ✅ `/sense/commercial` funciona
- ❌ `/api/run` (chat departamental) — NÃO funciona
- ❌ `/vraxia` (dashboard) — NÃO funciona
- ❌ `/api/sense/stats` — NÃO funciona

**Para colocar TUDO em produção, o startCommand deve ser:**
```toml
startCommand = "npx tsx api/server.ts"
```

### Arquivos existentes para deploy

| Arquivo | Status | Observação |
|---|---|---|
| `railway.toml` | ✅ Existe | startCommand aponta para processo errado |
| `docker-compose.yml` | ✅ Existe | Funcional para infra local |
| `infra/postgres/init.sql` | ✅ Existe | Schema correto |
| `.npmrc` (com legacy-peer-deps) | Verificar | Mencionado em commit anterior |
| Script `start` no package.json | ❌ **AUSENTE** | Node infra como Railway precisa disso |

### O que falta para um VPS genérico (Ubuntu/Debian)

1. Script `start` no `package.json`
2. Variáveis de ambiente no servidor (`.env` ou secrets do painel)
3. Nginx como reverse proxy (opcional mas recomendado)
4. PM2 ou systemd para manter o processo vivo

---

## Bloqueadores

### BLOQUEADOR 1 — CRÍTICO: `railway.toml` inicia processo errado

```toml
# ATUAL — inicia apenas o webhook server
startCommand = "npx tsx workers/webhookServer.ts"

# NECESSÁRIO — para iniciar API + dashboard + Sense
startCommand = "npx tsx api/server.ts"
```

**Impacto:** Deploy no Railway expõe apenas os webhooks, não o sistema principal.

---

### BLOQUEADOR 2 — CRÍTICO: `TELEGRAM_CHAT_ID` hardcoded no código

**Arquivo:** `tools/telegram.ts`, linha 3:
```typescript
const chatId = '8135843555';
```

O `chatId` está hardcoded. Não pode ser alterado via variável de ambiente sem modificar o arquivo. Toda notificação vai para o mesmo número fixo. Não está documentado no `.env.example`.

---

### BLOQUEADOR 3 — ALTO: `.env.example` incompleto — 9 variáveis ausentes

Qualquer novo desenvolvedor ou servidor não saberá quais variáveis configurar. As seguintes estão em uso no código mas não documentadas no `.env.example`:

```
DEV_MODE           — obrigatória para ambiente sem Redis/Postgres
ENABLE_MEMORY      — obrigatória para não tentar conectar em infra inexistente
TELEGRAM_BOT_TOKEN — obrigatória para qualquer notificação do Sense
VRAXIA_MASTER_KEY  — obrigatória para autenticação de tenant em produção
VRAXIA_ADMIN_KEY   — obrigatória para rotas /admin/*
TAVILY_API_KEY     — obrigatória para find_new_leads funcionar
RESEND_FROM_NAME   — obrigatória para email funcionar
MEDIA_KIT_PDF      — obrigatória para outbound funcionar
API_PORT           — opcional mas não documentado
```

---

### BLOQUEADOR 4 — ALTO: `DATABASE_URL` no `.env.example` com porta errada

O `.env.example` define:
```
DATABASE_URL=sqlite://local-runtime.db
```

Mas `docker-compose.yml` expõe Postgres na **porta 5433** (não 5432):
```yaml
ports:
  - "5433:5432"
```

Se alguém tentar usar `postgresql://ailab:ailab@localhost:5432/ai_lab`, a conexão falha.  
A URL correta para Postgres local é: `postgresql://ailab:ailab@localhost:5433/ai_lab`

---

### BLOQUEADOR 5 — MÉDIO: Sem script `start` no `package.json`

O `package.json` tem `api:start` e `api:dev` mas nenhum `start`.  
Railway, Heroku e a maioria das plataformas executam `npm start` por padrão.  
Com `railway.toml` existente, isso não é bloqueador para Railway — mas é para VPS sem configuração adicional.

---

### BLOQUEADOR 6 — MÉDIO: `dashboard/server.js` aponta para path errado

```javascript
// dashboard/server.js linha 29
if (pathname === "/" || pathname === "/dashboard" || pathname === "/dashboard/") {
  return "/dashboard/index.html";  // ← este arquivo não existe mais
}
```

O arquivo está em `/vraxia/index.html`, não `/dashboard/index.html`.  
Isso faz o `npm run dashboard` (porta 4200) não servir a página correta em `/`.  
**Workaround:** Acessar diretamente `http://localhost:4200/vraxia/index.html`

---

### BLOQUEADOR 7 — BAIXO: `config/runtime-config.json` especifica `gpt-4o-mini`

```json
"preferredModel": "gpt-4o-mini"
```

O sistema usa Claude (Anthropic), não OpenAI. Este arquivo é lido como governança/documentação mas não pelo agent factory. Cria confusão para quem lê. Não bloqueia execução mas pode induzir erro de configuração.

---

### BLOQUEADOR 8 — BAIXO: Sem script `npm run start:webhook` documentado para produção

O `railway.toml` (atual, errado) usa `workers/webhookServer.ts`. O `package.json` tem:
```json
"start:webhook": "tsx workers/webhookServer.ts"
```
Isso funciona em dev com tsx mas em produção pode ser lento (tsx adiciona overhead de transpile em runtime).

---

## Plano de Go-Live

### Checklist numerado — do estado atual ao sistema funcionando em produção

#### FASE 1 — Local funcional (estimativa: 30 minutos)

```
[ ] 1. Copiar .env.example para .env
[ ] 2. Adicionar ANTHROPIC_API_KEY no .env
[ ] 3. Adicionar DEV_MODE=true no .env
[ ] 4. Adicionar ENABLE_MEMORY=false no .env
[ ] 5. Adicionar CHEAP_MODE=true no .env
[ ] 6. Adicionar TELEGRAM_BOT_TOKEN no .env
[ ] 7. Adicionar TAVILY_API_KEY no .env
[ ] 8. Executar: npm install
[ ] 9. Executar: npm run api:dev
[10] 10. Acessar: http://localhost:3000/vraxia
[11] 11. Testar chat com módulo Comercial
[12] 12. Testar: curl localhost:3000/api/health
```

#### FASE 2 — VRAXIA Sense funcional localmente (estimativa: 15 minutos)

```
[13] 13. Abrir terminal separado: npm run start:webhook
[14] 14. Testar Sense com curl:
         curl -X POST http://localhost:3001/sense/commercial \
           -H "Content-Type: application/json" \
           -d '{"prospect_name":"Test","company":"X","job_title":"CEO",
                "linkedin_url":"linkedin.com/in/test",
                "message_content":"Oi quero saber mais sobre a operação de eventos"}'
[15] 15. Verificar notificação no Telegram
[16] 16. Verificar http://localhost:3000/api/sense/stats
```

#### FASE 3 — Deploy Railway (estimativa: 1-2 horas)

```
[17] 17. CORRIGIR railway.toml: startCommand = "npx tsx api/server.ts"
[18] 18. Criar projeto no Railway (railway.app)
[19] 19. Conectar repositório GitHub
[20] 20. Configurar variáveis de ambiente no painel Railway:
          ANTHROPIC_API_KEY
          TELEGRAM_BOT_TOKEN
          TAVILY_API_KEY
          RESEND_API_KEY
          RESEND_FROM_EMAIL
          RESEND_FROM_NAME
          DEV_MODE=true         (ou configurar VRAXIA_MASTER_KEY para produção real)
          ENABLE_MEMORY=false   (ou adicionar plugin Redis/Postgres no Railway)
          CHEAP_MODE=true
[21] 21. Deploy inicial — verificar logs do Railway
[22] 22. Testar: https://sua-url.railway.app/api/health
[23] 23. Configurar webhook Waalaxy: https://sua-url.railway.app/api/sense/commercial
[24] 24. Testar fluxo completo: reply LinkedIn → webhook → Telegram
```

#### FASE 4 — Produção com infraestrutura completa (estimativa: 2-4 horas)

```
[25] 25. Adicionar plugin PostgreSQL no Railway
[26] 26. Adicionar plugin Redis no Railway
[27] 27. Atualizar variáveis:
          DATABASE_URL=<url do plugin PostgreSQL Railway>
          REDIS_URL=<url do plugin Redis Railway>
          ENABLE_MEMORY=true
[28] 28. Configurar VRAXIA_MASTER_KEY (32+ chars) e VRAXIA_ADMIN_KEY
[29] 29. Remover DEV_MODE ou setar DEV_MODE=false
[30] 30. Provisionar primeiro tenant: tsx scripts/provision-tenant.ts
[31] 31. Testar autenticação com X-Api-Key header
[32] 32. Ativar backup automático: npm run backup (configurar cron externo)
```

#### FASE 5 — Correções de código necessárias (estimativa: 2 horas)

```
[33] 33. Atualizar .env.example com as 9 variáveis ausentes
[34] 34. Corrigir tools/telegram.ts — ler TELEGRAM_CHAT_ID do env em vez de hardcoded
[35] 35. Corrigir dashboard/server.js path: "/dashboard/index.html" → "/vraxia/index.html"
[36] 36. Verificar DATABASE_URL padrão no .env.example (porta 5433 vs 5432)
```

---

## Resumo executivo dos bloqueadores

| # | Severidade | Bloqueador | Solução | Esforço |
|---|---|---|---|---|
| 1 | **CRÍTICO** | `railway.toml` inicia processo errado | Alterar startCommand para `tsx api/server.ts` | 1 linha |
| 2 | **CRÍTICO** | `TELEGRAM_CHAT_ID` hardcoded | Ler de `process.env.TELEGRAM_CHAT_ID` | 2 linhas |
| 3 | **ALTO** | `.env.example` incompleto (9 vars ausentes) | Adicionar as vars | 15 min |
| 4 | **ALTO** | DATABASE_URL com porta errada no example | Corrigir para `:5433` | 1 linha |
| 5 | **MÉDIO** | Sem script `start` no package.json | Adicionar `"start": "tsx api/server.ts"` | 1 linha |
| 6 | **MÉDIO** | Dashboard standalone com path errado | Corrigir referência para `/vraxia/index.html` | 1 linha |
| 7 | **BAIXO** | runtime-config.json com gpt-4o-mini | Atualizar modelo para Claude | 1 linha |

**Tempo total estimado para sistema funcionando em produção:** 3-5 horas  
**Código novo necessário:** Zero — todos os bloqueadores são configuração ou 1-2 linhas

---

*Auditoria operacional — nenhum arquivo foi alterado durante esta análise.*
