---
name: configuracao-do-linkedin-dispatcher
description: Configurar e executar o linkedin_dm_dispatcher.ts do VRAXIA — definindo lista de leads, template de mensagem, daily cap, janela de envio e flags de execução (--dry-run, --limit, --offset) — para automação de DMs e convites no LinkedIn via Playwright com Chrome profile persistente.
tags: [linkedin, dispatcher, playwright, automação, leads, dm, configuração, outbound, chrome]
---

# Configuração do LinkedIn Dispatcher

## Objetivo
Configurar e executar o `linkedin_dm_dispatcher.ts` — o engine de automação LinkedIn do VRAXIA — que envia DMs diretas para conexões de 1º grau e convites com nota personalizada para 2º/3º grau, com controle de daily cap (10 ações/dia), janela comercial (seg-sex 8h-18h BRT) e state machine persistente por URL.

## Quando usar
- Antes de iniciar uma nova campanha de outbound LinkedIn
- Para processar uma lista de leads de um evento (ex: Futurecom)
- Para testar o template antes do disparo real (--dry-run)
- Para processar lotes menores em sequência (--offset=N --limit=N)

## Como usar
1. Prepare a lista de leads no formato JSON correto (ver estrutura abaixo)
2. Configure o template de DM (skill 024)
3. Rode em `--dry-run` para validar chars e leads
4. Execute o disparo real respeitando o daily cap de 10/dia
5. Monitore o log JSON gerado em `vault/imprensa/logs/`

## O Prompt
```
Você é o operador do pipeline LinkedIn do VRAXIA. Antes de rodar o dispatcher, valide toda a configuração e gere o comando de execução correto.

**PARÂMETROS DA CAMPANHA:**
- Arquivo de leads: [caminho do JSON]
- Template: [caminho do .md]
- Modo: [dry-run / produção]
- Limite de leads nesta sessão: [N ou todos]
- Offset (pular os primeiros N): [0 ou N]

**VALIDAÇÃO PRÉ-DISPARO:**

1. Estrutura do arquivo de leads:
```json
{
  "metadata": {
    "source": "[evento/origem]",
    "total": 0,
    "createdAt": "[ISO date]"
  },
  "contacts": [
    {
      "name": "Nome Completo",
      "company": "Empresa",
      "role": "Cargo",
      "linkedin_url": "https://linkedin.com/in/perfil"
    }
  ]
}
```

2. Validar template (skill 024):
- Usa `{{nome}}` para primeiro nome (extraído automaticamente do `name`)
- Usa `{{empresa}}` para nome da empresa
- Total de chars com valores médios ≤ 200 (convite) / ≤ 300 (DM)
- Sem frontmatter na mensagem (removido automaticamente)

3. Validar Chrome profile:
- Diretório `.linkedin-profile/` existe no root do projeto
- Perfil autenticado (rodar uma vez com `headless: false` para login)

**COMANDOS DE EXECUÇÃO:**

Dry-run (validação sem envio):
```bash
tsx scripts/linkedin_dm_dispatcher.ts --dry-run
```

Dry-run com limite:
```bash
tsx scripts/linkedin_dm_dispatcher.ts --dry-run --limit=10
```

Produção — primeiros 10 leads:
```bash
tsx scripts/linkedin_dm_dispatcher.ts --limit=10
```

Produção — pular os 10 primeiros, processar próximos 10:
```bash
tsx scripts/linkedin_dm_dispatcher.ts --offset=10 --limit=10
```

**PARÂMETROS DE PROTEÇÃO (hardcoded no dispatcher):**
- `DAILY_CAP = 10` — máximo de ações reais por dia
- `DELAY_MIN_MS = 75.000ms` — mínimo 75s entre ações
- `DELAY_MAX_MS = 180.000ms` — máximo 3min entre ações
- `NOTE_CHAR_LIMIT = 200` — limite de chars para convite com nota
- Janela: seg-sex 8h-18h BRT (bloqueia fora da janela)

**LOGS GERADOS:**
- `vault/imprensa/logs/linkedin_dm_YYYY-MM-DD.json` — log de DMs por dia (acumulativo)
- `vault/imprensa/logs/dispatcher_YYYY-MM-DD.log` — log estruturado Winston
- `data/linkedin/lead-states.json` — state machine persistente cross-session
- `vault/imprensa/logs/daily_state.json` — contador do cap diário
```

## Exemplo de uso

### Input
Lista: `data/leads/futurecom/futurecom-event-2026.json` (15 leads)
Template: `vault/imprensa/templates/template_futurecom_dm.md`
Modo: dry-run primeiro, depois produção em batches de 5

### Output
**Dry-run result:**
```
[LINKEDIN DM] 15 leads encontrados

[1/15] João Silva — TechCorp (Head of Ops)
  URL    : https://linkedin.com/in/joaosilva
  CHARS  : 183 / 200 ✓ cabe em nota
  DM     :
    Olá João! Nós cuidamos de toda a operação e experiência
    do cliente no stand ou no seu evento. Conheça nossa agência!
    www.vrashows.com.br
```

**Produção (5 leads, offset 0):**
```bash
tsx scripts/linkedin_dm_dispatcher.ts --limit=5
```
Estado: 4 enviados (2 DM direto, 2 convite com nota), 1 InMail Premium (sem canal).

---
**Tags:** Técnico | Operacional | Comercial, LinkedIn, Dispatcher, Automação
