---
name: configuracao-do-pipeline-no-outbound-log
description: Configurar a estrutura do outbound-log.json para uma nova campanha — definindo os campos de rastreamento, status de cada prospect, timestamps de cada toque e regras de progressão automática de estágio — padronizando o pipeline para ser lido pelo Orchestrator Agent.
tags: [outbound-log, pipeline, configuração, orchestrator, json, rastreamento, campanha, estado]
---

# Configuração do Pipeline no Outbound-Log

## Objetivo
Configurar a estrutura do `outbound-log.json` para uma nova campanha de outbound — definindo os campos obrigatórios, regras de progressão entre estágios, e os critérios que o Orchestrator Agent usa para decidir qual é o próximo toque para cada prospect. Esta skill é o setup técnico que habilita toda a automação do pipeline.

## Quando usar
- Ao iniciar uma nova campanha de outbound com uma lista nova
- Quando o pipeline existente precisa de novos campos ou estágios
- Para onboarding de um novo segmento/vertical com regras diferentes
- Para auditar e corrigir inconsistências no outbound-log atual

## Como usar
1. Defina os estágios do pipeline e as regras de transição
2. O Comercial AI gera a estrutura JSON completa
3. Copie para `outbound-log.json` no projeto
4. O Orchestrator Agent lê este arquivo a cada ciclo de execução
5. O Analytics Agent usa o log para gerar os relatórios de campanha

## O Prompt
```
Você é o arquiteto do pipeline de outbound do VRAXIA. O outbound-log.json é o estado da verdade — o que determina quem recebe o quê e quando. Um log mal estruturado cria race conditions, duplicatas e prospects recebendo mensagens erradas.

**PARÂMETROS DA CAMPANHA:**
- Nome: [nome da campanha]
- Segmento: [vertical / cargo alvo]
- Canal principal: [email / linkedin / multicanal]
- Sequência de toques: [D+0, D+3, D+7, D+14 ou customizar]
- Janela de envio: [ex: seg-sex 9h-18h BRT]
- Limite de toques antes de desistir: [ex: 4 toques]

Gere a estrutura completa:

**ESTRUTURA DO PROSPECT NO OUTBOUND-LOG:**
```json
{
  "campanhaId": "[uuid-campanha]",
  "campanhaName": "[nome]",
  "versao": "2.0",
  "criadoEm": "[ISO timestamp]",
  "atualizadoEm": "[ISO timestamp]",
  "configuracao": {
    "segmento": "",
    "canal": "",
    "janelaEnvio": { "diasSemana": [1,2,3,4,5], "horaInicio": "09:00", "horaFim": "18:00", "timezone": "America/Sao_Paulo" },
    "maxToques": 4,
    "pausarSeResponder": true,
    "intervaloEntreToques": [0, 3, 7, 14]
  },
  "estagio": {
    "possibilidades": ["pendente","enviado","aberto","clicou","respondeu","qualificado","descartado","nurturing"],
    "transicoes": {
      "pendente": ["enviado"],
      "enviado": ["aberto","bounced","descartado"],
      "aberto": ["clicou","respondeu","enviado"],
      "respondeu": ["qualificado","descartado","nurturing"]
    }
  },
  "prospects": []
}
```

**ESTRUTURA DE CADA PROSPECT:**
```json
{
  "id": "[uuid]",
  "nome": "",
  "primeiroNome": "",
  "email": "",
  "linkedin": "",
  "cargo": "",
  "empresa": "",
  "setor": "",
  "icpScore": 0,
  "estagio": "pendente",
  "toques": [
    {
      "numero": 1,
      "tipo": "email",
      "subject": "",
      "enviadoEm": null,
      "abertoEm": null,
      "clicouEm": null,
      "respondeuEm": null,
      "bounced": false,
      "resposta": null
    }
  ],
  "proximoToque": { "numero": 1, "agendar": "[ISO timestamp]" },
  "notas": "",
  "fonte": "",
  "adicionadoEm": ""
}
```

**REGRAS DE PROGRESSÃO (para o Orchestrator Agent):**
[liste as regras lógicas em pseudo-código legível]

**CRITÉRIOS DE DESCARTE AUTOMÁTICO:**
[quais condições movem o prospect para "descartado" sem intervenção humana]

**CRITÉRIOS DE ESCALADA PARA HUMANO:**
[quando o Orchestrator Agent deve pausar e notificar]
```

## Exemplo de uso

### Input
Campanha: Outbound Fintechs Q3-2026 | Canal: email + LinkedIn | Toques: D+0, D+3, D+7, D+14

### Output
**Regras de progressão:**
```
SE estagio = "enviado" E abertoEm != null → mover para "aberto"
SE estagio = "aberto" E respondeuEm != null → mover para "respondeu"
SE estagio = "respondeu" E resposta contém ["sim","interesse","demo","call"] → mover para "qualificado" E notificar humano
SE toques.length >= 4 E estagio != "respondeu" → mover para "nurturing"
SE bounced = true → mover para "descartado" E registrar motivo
SE estagio = "respondeu" E resposta contém ["não","concorrente","sem interesse"] → mover para "descartado"
```

**Critérios de descarte automático:**
- Bounce hard (domínio inválido)
- "unsubscribe" ou "remova-me" na resposta
- 4 toques sem abertura (segmento pode estar errado)

**Critérios de escalada para humano:**
- Prospect pediu call ou demo
- Resposta positiva mas ambígua ("pode me mandar mais detalhes?")
- Prospect com ICP Score > 80 que respondeu negativamente

---
**Tags:** Técnico | Configuração | Comercial, Outbound-Log, Orchestrator, Pipeline
