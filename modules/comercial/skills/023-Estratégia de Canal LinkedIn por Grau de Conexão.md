---
name: estrategia-de-canal-linkedin-por-grau-de-conexao
description: Entender e configurar a lógica de seleção de canal do LinkedIn Dispatcher — que detecta automaticamente se o prospect é 1º grau (DM direta), 2º/3º grau (convite com nota), tem convite pendente (aguardar) ou perfil fechado (InMail obrigatório) — e como o Strategy Agent decide a ação correta para cada caso.
tags: [linkedin, grau de conexão, estratégia, profile-analyzer, strategy-agent, dm, convite, inmail]
---

# Estratégia de Canal LinkedIn por Grau de Conexão

## Objetivo
Entender como o VRAXIA detecta automaticamente o tipo de relacionamento com cada prospect no LinkedIn e seleciona a estratégia de contato correta — eliminando tentativas erradas que resultariam em spam ou banimento. O `profile-analyzer.ts` lê o DOM do perfil antes de qualquer ação; o `strategy-agent.ts` decide o que fazer com base no estado detectado.

## Quando usar
- Para entender por que o dispatcher enviou DM ao invés de convite (ou vice-versa)
- Para depurar casos onde o canal detectado foi incorreto
- Para configurar uma campanha que só deve contatar 1º grau (DM direta)
- Para entender o fallback automático quando InMail é exigido

## Como usar
1. O dispatcher executa `analyzeProfile(page)` após navegar para o perfil
2. O retorno é `ProfileContactState` — um dos 4 estados possíveis
3. `selectStrategy(profileState, leadState)` combina o estado do perfil com o estado da SM
4. A estratégia correta é executada automaticamente

## O Prompt
```
Você é o arquiteto do pipeline LinkedIn do VRAXIA. O erro mais caro no outbound LinkedIn é enviar a mensagem errada para o grau de conexão errado — resulta em relatório por spam ou conta suspensa.

**FLUXO DE DECISÃO DO DISPATCHER:**

1. Navega para o perfil LinkedIn
2. `analyzeProfile(page)` detecta os botões visíveis
3. `selectStrategy(profileState, leadState)` decide a ação
4. Executa a ação com o executor correto

**ESTADOS DO PERFIL (ProfileContactState):**

DIRECT_MESSAGE_AVAILABLE:
- Detectado quando: botão "Mensagem" ou "Enviar mensagem" está visível
  E não há botão "Conectar" presente no perfil
- Significado: 1º grau — já conectados no LinkedIn
- Ação: `executeSendDirectMessage()` → abre chat e digita mensagem
- Limite: 300 chars (DM)
- Nota: se InMail for exigido mesmo com "Mensagem" visível → fallback para convite com nota

CONNECTION_REQUIRED:
- Detectado quando: botão "Conectar" ou aria-label "Convidar" está visível
- Significado: 2º ou 3º grau — ainda não conectados
- Ação: `executeSendConnectionNote()` → clica "Conectar" → preenche nota → envia
- Limite: 200 chars (nota de convite — menor que DM)
- Fluxo: direto OU via dropdown "… Mais" → "Conectar"

INVITATION_SENT:
- Detectado quando: botão "Pendente ▼" ou texto "Convite enviado" está visível
- Significado: convite já foi enviado em sessão anterior, aguardando aceite
- Ação: `SKIP_PENDING_INVITE` — não faz nada, registra na SM
- Intervalo: aguardar aceite, checar novamente após 7 dias

NO_CHANNEL:
- Detectado quando: nenhum dos botões acima está visível
- Significado: perfil requer InMail Premium (pago) para contato
- Ação: `SKIP_NO_CHANNEL` — registrado como CLOSED na SM
- Canal alternativo: tentar email corporativo via EmailPatternResolver (skill 003)

**FALLBACK AUTOMÁTICO:**
Quando "Mensagem" existe mas InMail é exigido na prática:
1. `executeSendDirectMessage()` detecta redirecionamento para `/premium/` ou modal Premium
2. Dispara `throw new Error('INMAIL_PREMIUM_REQUIRED')`
3. Dispatcher re-navega ao perfil (DOM limpo)
4. Tenta `executeSendConnectionNote()` como alternativa
5. Se também falhar: marca como CLOSED (NO_CHANNEL)

**MATRIX DE DECISÃO:**
| Estado Perfil | Estado SM | Estratégia |
|---|---|---|
| DIRECT_MESSAGE_AVAILABLE | COLLECTED/ANALYZED | SEND_DIRECT_MESSAGE |
| CONNECTION_REQUIRED | COLLECTED/ANALYZED | SEND_CONNECTION_NOTE |
| INVITATION_SENT | qualquer | SKIP_PENDING_INVITE |
| NO_CHANNEL | qualquer | SKIP_NO_CHANNEL |
| qualquer | MESSAGE_SENT | SKIP_ALREADY_HANDLED |
| qualquer | CLOSED | SKIP_ALREADY_HANDLED |
| qualquer | FOLLOWUP_PENDING | SEND_DIRECT_MESSAGE (se canal disponível) |
```

## Exemplo de uso

### Input
Lead: Marina Souza, CEO, FlowTech | LinkedIn: linkedin.com/in/marinasouza
Botões detectados pelo analyzeProfile: ["mensagem", "seguir", "mais"]
Estado SM: COLLECTED (primeiro contato)

### Output
**ProfileState:** DIRECT_MESSAGE_AVAILABLE (botão "Mensagem" ✓, sem "Conectar")
**LeadState SM:** COLLECTED
**Estratégia:** SEND_DIRECT_MESSAGE — "1º grau confirmado — canal de mensagem direta disponível"
**Executor:** `executeSendDirectMessage(page, message)` — opens chat, fills message, Ctrl+Enter
**Limite aplicado:** 300 chars (DM direta)
**Resultado esperado:** mensagem enviada → SM transição para MESSAGE_SENT

---
**Tags:** Técnico | Arquitetura | Comercial, LinkedIn, Estratégia, Dispatcher
