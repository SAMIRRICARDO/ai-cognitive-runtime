# Secure Secrets Checklist — AI Cognitive Runtime

**Uso:** Executar antes de qualquer deploy, compartilhamento de repositório, ou onboarding de nova máquina.

---

## PRÉ-DEPLOY — Verificação de Secrets

### Git
- [ ] `.env` está no `.gitignore`
- [ ] `git status` não mostra `.env` como untracked ou staged
- [ ] `git log --all -- .env` não retorna nenhum commit
- [ ] Verificar `.git/config` por credentials hardcoded

### Código-fonte
- [ ] Nenhum `process.env.ANTHROPIC_API_KEY` hardcoded (deve usar `env.ANTHROPIC_API_KEY` via Zod)
- [ ] Nenhum token ou key literal em arquivos `.ts`
- [ ] Nenhuma credencial em arquivos `.json` commitados
- [ ] `data/leads/*.json` não contém emails reais de funcionários internos
- [ ] `assets/pdfs/` está no `.gitignore` ✓

### Arquivos sensíveis que NUNCA devem ser commitados
```
.env
.env.local
.env.*.local
assets/pdfs/
data/outreach/
logs/
backups/
node_modules/
```

---

## ONBOARDING — Nova Máquina

### Checklist de instalação
- [ ] Clonar repositório: `git clone <repo>`
- [ ] `cp .env.backup.template .env`
- [ ] Preencher ANTHROPIC_API_KEY no `.env`
- [ ] Preencher RESEND_API_KEY no `.env` (se for usar email)
- [ ] Copiar PDF media kit para `assets/pdfs/vrashows_media_kit_optimized.pdf`
- [ ] `npm install`
- [ ] `npm run infra:up` (se ENABLE_MEMORY=true)
- [ ] `npm run health` — verificar todos os sistemas
- [ ] `npm run typecheck` — verificar zero erros TypeScript
- [ ] Teste de email: `tsx scripts/run-email.ts --test-to seu@email.com --dry-run`

---

## ROTAÇÃO DE SECRETS — Periodicidade recomendada

| Secret | Frequência | Ação |
|---|---|---|
| ANTHROPIC_API_KEY | A cada 90 dias | Gerar nova key no console Anthropic |
| RESEND_API_KEY | A cada 90 dias | Gerar nova key no dashboard Resend |
| OPENAI_API_KEY | A cada 90 dias | Rotacionar no painel OpenAI |
| TAVILY_API_KEY | A cada 180 dias | Rotacionar no dashboard Tavily |
| DATABASE_URL password | A cada 180 dias | Alterar senha do Postgres + atualizar .env |

### Procedimento de rotação
1. Gerar nova key no dashboard da API
2. Atualizar `.env` local
3. Testar: `npm run health`
4. Invalidar key antiga no dashboard
5. Atualizar `.env.backup.template` se o formato mudou

---

## RESPOSTA A INCIDENTES — Secret comprometido

### Se uma key foi exposta acidentalmente no git:

```bash
# PASSO 1: Invalidar a key IMEDIATAMENTE (não espere)
# Acessar console da API e revogar a key exposta

# PASSO 2: Verificar o histórico
git log --all --full-history -- .env
git log -p --all -- .env

# PASSO 3: Remover do histórico com BFG Repo-Cleaner
# https://rtyley.github.io/bfg-repo-cleaner/
java -jar bfg.jar --delete-files .env
git reflog expire --expire=now --all
git gc --prune=now --aggressive
git push --force

# PASSO 4: Gerar nova key
# PASSO 5: Atualizar .env local com nova key
# PASSO 6: Notificar equipe e fazer force push
```

---

## COMPARTILHAMENTO SEGURO DO PROJETO

### O que PODE ser compartilhado (via git/email/drive)
- Todo código-fonte TypeScript
- `prompts/agents/*.md`
- `assets/templates/*.md`
- `.env.backup.template` (template sem valores reais)
- `docs/` (documentação)
- `docker-compose.yml`
- `package.json`

### O que NUNCA deve ser compartilhado publicamente
- `.env` (contém API keys reais)
- `assets/pdfs/` (material institucional confidencial)
- `data/leads/*.json` (dados de prospects — LGPD)
- `data/outreach/` (histórico de campanhas)
- `logs/` (pode conter informações de contatos)
- `backups/` (contém dumps de banco e dados de memória)

---

*Manter este documento atualizado a cada nova variável de ambiente adicionada ao sistema.*
