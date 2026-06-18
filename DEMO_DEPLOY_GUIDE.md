# VRAXIA OS — Demo Deploy Guide
**Versão:** Demo Comercial v1.0  
**Alvo:** Oracle Cloud Free Tier — VM 1 GB RAM / 1 OCPU  
**Objetivo:** Máxima estabilidade para demonstração comercial

---

## Modo DEMO_MODE

Quando `DEMO_MODE=true`, o sistema opera com footprint mínimo:

- **Agentes ativos** — executam LLM normalmente
- **Agentes preview** — aparecem no dashboard com badge `🔒 Enterprise`, bloqueiam execução de LLM, exibem modal "Disponível na versão Enterprise"

### Agentes Ativos (DEMO)

| Agente | Módulo | Ferramentas |
|--------|--------|-------------|
| **Comercial AI** | `comercial` | prospect_leads, find_new_leads, enrich_company, query_leads, validate_leads, classify_linkedin_reply |
| **Lead Intelligence** | `comercial` | prospect_leads (busca+enriquece+email+LinkedIn em 1 chamada) |
| **Executive Agent** | `lideranca` | skills de liderança, feedback, OKRs, gestão de equipes |

### Agentes Preview (Enterprise)

| Agente | Módulo |
|--------|--------|
| Finance Agent | `financeiro` |
| Marketing Agent | `marketing` |
| Legal Agent | `juridico` |
| Operations Agent | `operacoes` |
| Content Agent | `conteudo` |
| Product Agent | `produto` |
| Tech Agent | `codigo` |

---

## Consumo Estimado de Recursos

### RAM

| Componente | Mínimo | Típico |
|------------|--------|--------|
| OS Ubuntu + sshd | 120 MB | 150 MB |
| Node.js (api/server.ts via tsx) | 80 MB | 110 MB |
| Agente Comercial (em execução) | 15 MB | 25 MB |
| Agente Liderança (em execução) | 10 MB | 18 MB |
| Buffer + overhead GC | 50 MB | 80 MB |
| **Total estimado** | **275 MB** | **383 MB** |

> ✅ Dentro do limite de 1 GB com folga de ~600 MB

**O que NÃO sobe em DEMO_MODE:**
- Redis → `ENABLE_MEMORY=false` — economiza ~50 MB
- PostgreSQL / pgvector → `ENABLE_MEMORY=false` — economiza ~200 MB
- Docker → não necessário — economiza ~100 MB

### CPU

| Situação | CPU (1 OCPU) |
|----------|-------------|
| Idle (sem chamadas) | < 1% |
| Durante chamada Haiku | 5–15% (picos de I/O de rede) |
| Durante prospect_leads (Tavily + Haiku) | 10–20% por ~12s |
| Dashboard SSE streaming | < 3% |

> Carga de CPU é dominada pela latência de rede (Anthropic + Tavily), não por computação local.

---

## Configuração para Oracle Free Tier

### `.env` para demo

```env
# ── Obrigatório ────────────────────────────────────────────────────────────────
ANTHROPIC_API_KEY=sk-ant-...
TAVILY_API_KEY=tvly-...
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...

# ── DEMO MODE ─────────────────────────────────────────────────────────────────
DEMO_MODE=true
DEV_MODE=true          # Bypass tenant auth (sem Redis necessário)
ENABLE_MEMORY=false    # Desativa Redis + PostgreSQL
CHEAP_MODE=true        # Força Haiku (menor custo e latência)
MAX_OUTPUT_TOKENS=4096 # Suficiente para lead completo + análise

# ── Portas ─────────────────────────────────────────────────────────────────────
API_PORT=3000

# ── Opcionais ──────────────────────────────────────────────────────────────────
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=contato@vrashows.com.br
```

---

## Checklist Oracle Free Tier

### Infraestrutura

- [ ] **Shape**: VM.Standard.A1.Flex — 1 OCPU, 1 GB RAM (Free Tier)
- [ ] **OS**: Ubuntu 22.04 LTS (ARM64 — Ampere)
- [ ] **Node.js**: v20+ LTS (`curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -`)
- [ ] **Portas abertas** no Security List da VCN:
  - `3000/tcp` — API + Dashboard VRAXIA
  - `22/tcp` — SSH
- [ ] **Firewall interno** liberado:
  ```bash
  sudo iptables -I INPUT -p tcp --dport 3000 -j ACCEPT
  sudo iptables-save | sudo tee /etc/iptables/rules.v4
  ```

### Deploy

- [ ] Clone do repositório:
  ```bash
  git clone https://github.com/SAMIRRICARDO/ai-cognitive-runtime.git
  cd ai-cognitive-runtime
  npm install
  ```
- [ ] Copiar e editar `.env`:
  ```bash
  cp .env.example .env
  nano .env   # preencher ANTHROPIC_API_KEY, TAVILY_API_KEY, etc.
  ```
- [ ] Ativar `DEMO_MODE=true` no `.env`

### Iniciar (produção)

```bash
# Opção 1 — direto (foreground, bom para demo ao vivo)
npm run api:dev

# Opção 2 — background com PM2 (recomendado para deploy permanente)
npm install -g pm2
pm2 start "npm run start" --name vraxia-demo
pm2 startup
pm2 save
```

### Verificar

```bash
# Health check
curl http://localhost:3000/api/health

# Dashboard (no navegador)
http://<IP-ORACLE>:3000/vraxia
```

---

## Módulos Ativos na Demo

### ✅ Comercial AI + Lead Intelligence (`/vraxia/comercial.html`)

**Fluxo demonstrável:**
1. "busque 1 lead de tecnologia em São Paulo" → `prospect_leads` → nome + email + LinkedIn em ~12s
2. "classifica essa resposta: [texto LinkedIn]" → `classify_linkedin_reply` → score + intent + Telegram
3. "quantos leads HOT temos?" → `validate_leads` → relatório da base

**Custo por demo (estimativa):**
- prospect_leads: ~$0.008 (Tavily + Haiku ~800 tokens)
- classify_linkedin_reply: ~$0.0003 (Haiku 300 tokens)
- Total demo completa: < $0.02

### ✅ Executive Agent (`lideranca`)

**Fluxo demonstrável:**
1. "crie um plano de OKRs para Q3 focado em expansão comercial"
2. "estruture uma reunião de feedback para liderança comercial"
3. "crie um plano de desenvolvimento para SDR sênior"

---

## Segurança para Demo

- `DEV_MODE=true` → sem necessidade de API key no dashboard (facilita demo)
- Para demo com cliente real: considere `DEV_MODE=false` + criar tenant com `npm run tenant:provision`
- Não expor porta 3000 publicamente após demo — use nginx proxy ou VPN

---

## Rollback / Emergência

```bash
# Reiniciar o processo
pm2 restart vraxia-demo

# Ver logs em tempo real
pm2 logs vraxia-demo --lines 50

# Memória atual
free -h

# CPU atual
top -bn1 | head -5
```

---

## Roteiro de Demo Sugerido (15 min)

| Tempo | Ação | Módulo |
|-------|------|--------|
| 0–2 min | Apresentar dashboard — módulos ativos vs Enterprise | Overview |
| 2–5 min | "busque 1 lead de marketing em SP" → mostrar lead completo com email | Comercial AI |
| 5–8 min | Colar resposta LinkedIn → classificar com VRAXIA Sense → Telegram | Comercial AI |
| 8–11 min | "crie OKRs para expansão comercial Q3" | Executive Agent |
| 11–13 min | Clicar em módulo preview → modal Enterprise | Qualquer preview |
| 13–15 min | Mostrar billing widget (custo real da sessão) | Uso & Custo |

---

*Gerado automaticamente pelo VRAXIA OS — ai-cognitive-runtime*
