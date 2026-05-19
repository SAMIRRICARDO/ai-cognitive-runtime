# Disaster Recovery Playbook — AI Cognitive Runtime

**Versão:** 1.0.0 | **Data:** 2026-05-19  
**Responsável:** Equipe de Infraestrutura AI  
**Classificação:** Interno — Operacional

---

## 1. Visão Geral

Este documento cobre os procedimentos para:
- Backup automático e manual do runtime
- Restauração em caso de falha
- Replicação em nova máquina
- Rollback de versão
- Validação pós-restore

**RTO (Recovery Time Objective):** < 30 minutos para restore completo  
**RPO (Recovery Point Objective):** máximo 24h de perda (com backup diário)

---

## 2. Estrutura de Backup

```
backups/
├── daily/                    # Backups automáticos diários (retenção: 7)
│   └── backup-YYYY-MM-DD-HH-mm-ss/
│       ├── code/             # Todos os arquivos fonte
│       ├── postgres/
│       │   └── ai_lab.sql    # pg_dump completo
│       ├── redis/
│       │   └── dump.rdb      # Redis snapshot
│       └── manifest.json     # Metadados do backup
├── weekly/                   # Backups semanais (retenção: 4)
├── snapshots/                # Snapshots manuais (retenção: ilimitada)
└── manifests/                # Índice global de todos os backups
    └── *.json
```

**O que é salvo:**
- Todo código-fonte (agents/, tools/, config/, memory/, scripts/, prompts/, etc.)
- Templates e leads (assets/templates/, data/leads/)
- Documentação (docs/)
- Vault Obsidian (obsidian-vault/)
- Arquivos de configuração raiz (package.json, tsconfig.json, docker-compose.yml, etc.)
- PostgreSQL dump completo (inclui agent_memories com embeddings)
- Redis snapshot (cache, dedup, cost records)

**O que NÃO é salvo (por segurança):**
- `.env` (contém secrets — manual)
- `node_modules/` (reconstruído via npm install)
- `assets/pdfs/` (binários — backup separado)
- `logs/` (artefatos gerados)

---

## 3. Comandos de Backup

### Backup diário (padrão)
```bash
npm run backup
# ou
tsx scripts/backup-runtime.ts
```

### Backup semanal
```bash
npm run backup:weekly
# ou
tsx scripts/backup-runtime.ts --type weekly
```

### Snapshot nomeado (pré-deploy, pré-release)
```bash
npm run backup:snapshot -- --label "pre-v2-deploy"
# ou
tsx scripts/backup-runtime.ts --type snapshot --label "pre-v2-deploy"
```

### Dry-run (ver o que seria salvo)
```bash
tsx scripts/backup-runtime.ts --dry-run
```

### Backup sem banco de dados (rápido, apenas código)
```bash
tsx scripts/backup-runtime.ts --skip-db
```

---

## 4. Procedimento de Restore

### 4.1 Listar backups disponíveis
```bash
npm run restore:list
# ou
tsx scripts/restore-runtime.ts --list
```

Output exemplo:
```
Available Backups

  ID                                       Type       Git          Date                   Size
  ──────────────────────────────────────── ────────── ──────────── ──────────────────────
  backup-2026-05-19-08-00-00              daily      0748a7b7     19/05/2026 08:00:00    12.4 MB  pg✓ rd✓
  pre-v2-deploy-2026-05-18-14-30-00       snapshot   193e2b26     18/05/2026 14:30:00     9.8 MB  pg✗ rd✓
```

### 4.2 Restore completo (código + banco)
```bash
tsx scripts/restore-runtime.ts --backup backup-2026-05-19-08-00-00
```

O sistema irá:
1. Confirmar antes de sobrescrever
2. Restaurar todos os arquivos fonte
3. Executar `npm install`
4. Subir Docker (Redis + PostgreSQL)
5. Restaurar pg_dump
6. Restaurar Redis snapshot

### 4.3 Restore somente código (sem banco)
```bash
tsx scripts/restore-runtime.ts --backup backup-2026-05-19-08-00-00 --skip-db
```

### 4.4 Restore sem confirmação interativa (CI/CD)
```bash
tsx scripts/restore-runtime.ts --backup backup-2026-05-19-08-00-00 --force
```

---

## 5. Replicação em Nova Máquina

### 5.1 Pré-requisitos na máquina destino
- Node.js ≥ 22.x (`node --version`)
- npm ≥ 10.x (`npm --version`)
- Docker Desktop instalado e rodando (`docker --version`)
- Git (`git --version`)

### 5.2 Procedimento completo

**Passo 1 — Transferir o backup**
```bash
# Opção A: Copiar o diretório de backup via USB/rede
cp -r /backups/daily/backup-2026-05-19-08-00-00 /nova-maquina/backup/

# Opção B: Clonar o repositório git + copiar backup separadamente
git clone <repo-url> ai-cognitive-runtime
cd ai-cognitive-runtime
# Copiar o backup para dentro do projeto
mkdir -p backups/snapshots
cp -r /caminho/do/backup backups/snapshots/
```

**Passo 2 — Restaurar**
```bash
cd ai-cognitive-runtime
tsx scripts/restore-runtime.ts --backup backup-2026-05-19-08-00-00 --force
```

**Passo 3 — Configurar secrets (MANUAL — nunca no backup)**
```bash
cp .env.backup.template .env
# Abrir .env e preencher todos os REPLACE_ME com os valores reais:
# - ANTHROPIC_API_KEY
# - RESEND_API_KEY
# - OPENAI_API_KEY (se ENABLE_MEMORY=true)
```

**Passo 4 — Copiar assets não versionados**
```bash
# Copiar o PDF media kit
mkdir -p assets/pdfs
cp /fonte/vrashows_media_kit_optimized.pdf assets/pdfs/
```

**Passo 5 — Validação completa**
```bash
# Health check geral
npm run health

# TypeScript — deve retornar zero erros
npm run typecheck

# Teste de agente (sem custo se CHEAP_MODE=true)
DEV_MODE=true tsx scripts/run-agent.ts researcher "Health check test"

# Teste de email (dry-run — não envia)
tsx scripts/run-email.ts --test-to seu@email.com --dry-run
```

**Passo 6 — Rebuild do vault index** (se ENABLE_MEMORY=true)
```bash
npm run vault:index
```

**Passo 7 — Reimportar memórias** (se ENABLE_MEMORY=true)
```bash
# Se o backup incluiu export de memórias:
tsx scripts/import-memories.ts --input ./backups/postgres/memories-YYYY-MM-DD.json
```

---

## 6. Backup e Restore de Memórias (pgvector)

### Export de memórias
```bash
# Export completo
npm run export-memories
# ou
tsx scripts/export-memories.ts

# Export por agente
tsx scripts/export-memories.ts --agent outreach-agent

# Export para caminho específico
tsx scripts/export-memories.ts --output ./minha-pasta/memories.json
```

### Import de memórias
```bash
# Import completo (com upsert — seguro para reimportar)
npm run import-memories -- --input ./backups/postgres/memories-2026-05-19.json

# Import dry-run (ver o que seria importado)
tsx scripts/import-memories.ts --input ./memories.json --dry-run

# Import sem sobrescrever existentes
tsx scripts/import-memories.ts --input ./memories.json --skip-existing
```

---

## 7. Health Check

```bash
# Verificação rápida de todos os sistemas
npm run health

# Com detalhes extras (inclui TypeScript check)
tsx scripts/system-health.ts --verbose

# Saída JSON (para CI/CD)
tsx scripts/system-health.ts --json

# Exit codes:
# 0 = todos sistemas ok
# 1 = degradado (sistemas não-críticos com problema)
# 2 = crítico (ANTHROPIC_API_KEY ausente ou arquivos críticos faltando)
```

Exemplo de output saudável:
```
AI Cognitive Runtime — System Health

  ✓ Node.js                 v22.15.0 (required: ≥22)
  ✓ Anthropic API           Key configured (sk-ant-api03-...)
  ✓ Resend Email            Key configured (re_xxxxxxxxxxxx...) | From: sender@yourdomain.com
  ✓ Docker                  v27.3.1
  ✓ Redis                   v7.2.3 — PONG
  ✓ PostgreSQL+pgvector     pgvector v0.7.0
  ✓ OpenAI Embeddings       Key configured (sk-proj-UQY...)
  ✓ Media Kit PDF           ./assets/pdfs/vrashows_media_kit_optimized.pdf (892 KB)
  ✓ Backups                 Last backup: 3h ago | 7 total
  ✓ Git                     0748a7b7 (main)
  ✓ Cost Mode               CHEAP 💰 | model: claude-haiku-4-5-20251001 | ...
  ✓ Critical Files          package.json, tsconfig.json, docker-compose.yml, ...

  ✓ All systems healthy
  ✓ 12 ok  ⚠ 0 degraded  ✗ 0 down  ○ 0 skipped
```

---

## 8. Estratégia Git

### O que entra no git
```
agents/          # Código dos agentes
tools/           # Tool handlers
config/          # Configuração (sem secrets)
memory/          # Memory adapters
workflows/       # Orquestração
scripts/         # CLI scripts (incluindo os novos de backup)
prompts/         # System prompts
assets/templates/ # Templates de outreach
data/leads/      # Leads JSON (sem dados pessoais sensíveis)
docs/            # Documentação
infra/           # Init SQL do Postgres
evals/           # Eval runners
.env.example     # Template sem valores reais
.env.backup.template  # Template completo para restore
docker-compose.yml
package.json / package-lock.json
tsconfig.json
CLAUDE.md
.gitignore
```

### O que NUNCA entra no git
```
.env             # Secrets reais
assets/pdfs/     # Binários/media (usar git-lfs se necessário)
node_modules/    # Dependências
backups/         # Backups locais
logs/            # Logs de runtime
data/outreach/   # Artefatos de campanhas
dist/ coverage/  # Build outputs
*.tmp *.temp     # Temporários
```

### Tagging de releases
```bash
# Tag antes de deploy ou mudança significativa
git tag -a v1.2.0 -m "feat: add backup system and DR playbook"
git push origin v1.2.0

# Ver todas as tags
git tag -l

# Voltar para uma tag específica
git checkout v1.1.0
```

### Rollback seguro
```bash
# Opção A: Rollback via git (sem banco)
git log --oneline -10
git checkout <commit-hash>

# Opção B: Rollback via backup (código + banco)
tsx scripts/restore-runtime.ts --list
tsx scripts/restore-runtime.ts --backup <backup-id>

# Opção C: Snapshot pré-deploy (melhor prática)
tsx scripts/backup-runtime.ts --type snapshot --label "pre-deploy-$(date +%Y%m%d)"
# ... fazer o deploy ...
# Se algo der errado:
tsx scripts/restore-runtime.ts --backup "pre-deploy-20260519" --force
```

---

## 9. Cenários de Disaster Recovery

### Cenário 1: Corrupção de arquivos fonte
```bash
# Restaurar apenas código (preservar banco)
tsx scripts/restore-runtime.ts --backup <latest> --skip-db
npm run typecheck
npm run health
```

### Cenário 2: Perda de banco de dados (memórias)
```bash
# 1. Verificar se banco ainda está rodando
docker ps | grep postgres

# 2. Se sim, tentar recuperação in-place
npm run infra:up

# 3. Se não, restaurar do backup
tsx scripts/restore-runtime.ts --backup <latest>

# 4. Reimportar memórias se necessário
tsx scripts/import-memories.ts --input ./backups/postgres/memories-<latest>.json
```

### Cenário 3: Falha total da máquina (nova máquina)
```bash
# Seguir procedimento completo da seção 5
# Tempo estimado: 15-30 minutos
```

### Cenário 4: Secret comprometido
```bash
# 1. IMEDIATAMENTE invalidar a key no dashboard da API
# 2. Gerar nova key
# 3. Atualizar .env local
# 4. Verificar git log por commits com o secret
git log --all -p | grep "sk-ant-"  # buscar por fragments da key
# 5. Se encontrar: seguir procedimento de remoção do histórico (seção 5 do secrets checklist)
npm run health  # validar novo estado
```

### Cenário 5: Rollback de campanha de outreach
```bash
# Os dados de leads estão em data/leads/ — commitados no git
# Outreach enviado não pode ser "desfeito" (email já entregue)
# Mas o estado dos leads pode ser restaurado:
git checkout <commit-anterior> -- data/leads/
```

---

## 10. Automação de Backup (Opcional)

### Windows Task Scheduler (backup diário às 02:00)

Criar arquivo `scripts/schedule-backup.ps1`:
```powershell
# Executar como Administrador
$action = New-ScheduledTaskAction `
  -Execute "node" `
  -Argument "C:\AI-LAB\ai-cognitive-runtime\node_modules\.bin\tsx scripts\backup-runtime.ts --type daily" `
  -WorkingDirectory "C:\AI-LAB\ai-cognitive-runtime"

$trigger = New-ScheduledTaskTrigger -Daily -At "02:00AM"

Register-ScheduledTask `
  -TaskName "AI-Runtime-Daily-Backup" `
  -Action $action `
  -Trigger $trigger `
  -RunLevel Highest
```

### Linux/Mac cron (backup diário às 02:00)
```bash
# crontab -e
0 2 * * * cd /path/to/ai-cognitive-runtime && npx tsx scripts/backup-runtime.ts >> logs/backup.log 2>&1
0 3 * * 0 cd /path/to/ai-cognitive-runtime && npx tsx scripts/backup-runtime.ts --type weekly >> logs/backup.log 2>&1
```

---

## 11. Checklist de Validação Pós-Restore

```
□ npm run health                    → todos ok (exit 0)
□ npm run typecheck                 → zero erros TypeScript
□ tsx run-agent.ts researcher "test" → resposta recebida
□ tsx run-email.ts --dry-run        → "queued" no output
□ docker ps                         → redis e postgres up (se ENABLE_MEMORY=true)
□ .env preenchido com secrets reais
□ assets/pdfs/vrashows_media_kit_optimized.pdf presente
□ npm run backup                    → primeiro backup da nova máquina gerado
```

---

*Para questões sobre este playbook: ver `docs/AI_RUNTIME_ENTERPRISE_MANUAL.md` — Capítulo 13 (Troubleshooting).*
