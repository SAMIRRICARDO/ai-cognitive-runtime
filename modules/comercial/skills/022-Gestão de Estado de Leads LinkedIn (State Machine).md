---
name: gestao-de-estado-de-leads-linkedin-state-machine
description: Usar e interpretar a LeadStateMachine do VRAXIA — que persiste o estado de cada lead LinkedIn entre sessões — para saber quais leads já foram tratados, quais estão aguardando aceite de convite, quais têm follow-up vencido e como forçar transições manuais de estado.
tags: [linkedin, state machine, lead state, follow-up, convite pendente, cross-session, persistência, automação]
---

# Gestão de Estado de Leads LinkedIn (State Machine)

## Objetivo
Interpretar e operar a `LeadStateMachine` do VRAXIA — sistema de persistência cross-session que rastreia o ciclo de vida completo de cada lead LinkedIn por URL — garantindo que o dispatcher nunca recontacte alguém já tratado, que convites pendentes sejam rastreados, e que follow-ups sejam executados no momento certo.

## Quando usar
- Para auditar quais leads foram processados e em qual estado estão
- Quando o dispatcher precisa ser reiniciado sem duplicar contatos
- Para identificar convites pendentes há mais de 7 dias (oportunidade de follow-up)
- Para forçar a transição de estado de um lead manualmente

## Como usar
1. O arquivo de estado fica em `data/linkedin/lead-states.json`
2. O dispatcher carrega automaticamente via `sm.load()` no início de cada sessão
3. Leads em `MESSAGE_SENT`, `INVITATION_SENT`, `CLOSED` são automaticamente pulados
4. Use os métodos utilitários para auditar stale invites e follow-ups vencidos

## O Prompt
```
Você é o analista de pipeline LinkedIn do VRAXIA. A state machine é a fonte da verdade sobre cada lead. Use-a para auditoria e decisões de próxima ação.

**ESTADOS POSSÍVEIS DO LEAD:**
| Estado | Significado | Próxima ação |
|---|---|---|
| COLLECTED | Lead na lista, ainda não processado | Dispatcher vai processar |
| PROFILE_ANALYZED | Perfil visitado, estratégia selecionada | Dispatcher vai executar |
| DIRECT_MESSAGE_AVAILABLE | 1º grau detectado | DM direta disponível |
| CONNECTION_REQUIRED | 2º/3º grau | Convite com nota |
| INVITATION_SENT | Convite enviado, aguardando aceite | Aguardar (não recontactar) |
| WAITING_ACCEPTANCE | Alias de INVITATION_SENT (interno) | Aguardar |
| CONNECTED | Conexão aceita (mapeado externamente) | Follow-up ativo |
| MESSAGE_SENT | DM enviada com sucesso | Estado terminal ✓ |
| FOLLOWUP_PENDING | Conexão aceita, follow-up agendado | Enviar DM de follow-up |
| CLOSED | Sem canal / descartado | Estado terminal (não recontactar) |

**ARQUIVO DE ESTADO (lead-states.json):**
```json
[
  {
    "linkedin_url": "https://linkedin.com/in/joaosilva",
    "name": "João Silva",
    "company": "TechCorp",
    "state": "INVITATION_SENT",
    "previousState": "PROFILE_ANALYZED",
    "transitionAt": "2026-06-12T14:23:00Z",
    "transitionReason": "connection_note_sent",
    "attemptCount": 1,
    "inviteSentAt": "2026-06-12T14:23:00Z"
  }
]
```

**CONSULTAS ÚTEIS (via código ou análise manual):**

Leads pendentes (não ainda tratados):
- Filtrar onde `state` = "COLLECTED" ou "PROFILE_ANALYZED"

Convites aguardando aceite há mais de 7 dias (stale):
- Filtrar onde `state` = "INVITATION_SENT" E `inviteSentAt` < hoje - 7 dias
- Ação: considerar enviar email como canal secundário

Follow-ups vencidos:
- Filtrar onde `state` = "FOLLOWUP_PENDING" E `followupDue` ≤ hoje
- Ação: rodar dispatcher para enviar DM de follow-up

Leads para auditar (erros):
- Filtrar onde `lastError` não está vazio
- Verificar manualmente no LinkedIn

**INTERPRETAÇÃO DO SUMÁRIO DO DISPATCHER:**
```
SM States: {
  "MESSAGE_SENT": 8,
  "INVITATION_SENT": 4,
  "CLOSED": 2,
  "COLLECTED": 1
}
```
→ 8 DMs entregues ✓ | 4 aguardando aceite | 2 sem canal (InMail) | 1 pendente

**FORÇAR TRANSIÇÃO MANUAL (quando necessário):**
Para marcar um lead como "já tratado" manualmente, edite diretamente o JSON:
- Mude `state` para `"MESSAGE_SENT"` ou `"CLOSED"`
- Atualize `transitionAt` e `transitionReason`
- O dispatcher vai pular o lead na próxima execução via `sm.shouldSkip(url)`
```

## Exemplo de uso

### Input
Auditoria pós-campanha Futurecom (15 leads processados ao longo de 3 dias)

### Output
**Sumário:** MESSAGE_SENT: 9 | INVITATION_SENT: 3 | CLOSED: 3 (InMail Premium)

**Stale invites (>7 dias):** 1 — João Silva / TechCorp — inviteSentAt: 2026-06-11
Ação recomendada: Tentativa de email corporativo via EmailPatternResolver como canal alternativo.

**Follow-ups vencidos:** 0 — nenhum em FOLLOWUP_PENDING.

**Leads CLOSED por InMail:** Ana Lima (Grupo Natura), Rafael Torres (AMBEV), Fernanda Costa (Gerdau).
Ação recomendada: Tentar via email corporativo com email de apresentação (skill 013).

---
**Tags:** Técnico | Diagnóstico | Comercial, LinkedIn, State Machine, Pipeline
