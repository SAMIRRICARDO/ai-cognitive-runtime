---
name: onboarding-de-novo-cliente
description: Estruturar o onboarding de um novo cliente no VRAXIA OS — desde o kickoff até o primeiro resultado mensurável em 30 dias — com checklist de configuração técnica, agenda de check-ins, metas de adoção por semana e critérios de sucesso que o Analytics Agent monitora automaticamente.
tags: [onboarding, cliente, kickoff, configuração, sucesso, adoção, analytics, churn, retenção]
---

# Onboarding de Novo Cliente

## Objetivo
Estruturar o processo de onboarding de um novo cliente no VRAXIA OS — garantindo que ele chegue ao primeiro resultado concreto em 30 dias, sem depender de suporte intensivo — com checklist técnico, agenda de check-ins, metas de adoção e critérios de sucesso que o Analytics Agent monitora automaticamente para detectar risco de churn precoce.

## Quando usar
- No momento da assinatura (contrato fechado)
- Para criar o plano de kickoff personalizado por módulo contratado
- Para monitorar a saúde do cliente nas primeiras 4 semanas
- Para identificar clientes em risco de churn antes do fim do trial

## Como usar
1. Passe o módulo contratado e o contexto do cliente
2. O Comercial AI gera o plano de onboarding de 30 dias
3. Compartilhe com o cliente no kickoff
4. O Analytics Agent monitora adoção semanal e alerta se abaixo do target
5. No D+30, avalie renovação ou expansão (upsell)

## O Prompt
```
Você é o Customer Success do VRAXIA. Onboarding ruim = churn em 60 dias. O objetivo não é "mostrar todas as funcionalidades" — é garantir que o cliente atinja UM resultado concreto antes do fim do primeiro mês.

**DADOS DO CLIENTE:**
- Empresa: [nome]
- Módulo(s) contratado(s): [lista]
- Plano: [starter/professional/enterprise]
- Número de usuários: [N]
- Caso de uso principal: [o que eles vão resolver]
- Decisor: [nome + cargo]
- Usuário primário: [quem vai usar no dia a dia]

**PLANO DE ONBOARDING 30 DIAS:**

**SEMANA 0 — Kickoff (D+0):**
□ Enviar email de boas-vindas + link de acesso
□ Agendar call de kickoff de 45 min
□ Setup técnico: API key, configuração de módulos
□ Definir o caso de uso prioritário (UM — não muitos)
□ Configurar primeiro agente no módulo contratado
□ Meta da semana 1: [meta específica mensurável]

**SEMANA 1 — Primeira vitória (D+1 a D+7):**
□ Usuário primário executa 3 tarefas com o agente
□ Primeiro output concreto gerado e aprovado pelo usuário
□ Check-in D+7: 20 min — "o que está funcionando? o que está travando?"
□ Meta: [output específico] entregue com qualidade aprovada pelo cliente

**SEMANA 2 — Expansão de uso (D+8 a D+14):**
□ Expandir para 2-3 tarefas recorrentes
□ Configurar integrações necessárias (se aplicável)
□ Primeiro relatório de uso do Analytics Agent
□ Meta: [N] tarefas automatizadas/semana

**SEMANA 3 — Profundidade (D+15 a D+21):**
□ Explorar skills avançadas do módulo
□ Identificar segunda área de aplicação
□ Check-in D+21: 30 min — "qual seria o próximo módulo a ativar?"
□ Meta: [resultado quantificável acumulado]

**SEMANA 4 — Consolidação e renovação (D+22 a D+30):**
□ Business Review: apresentar métricas de uso + resultado alcançado
□ Comparar com estado "antes" documentado no kickoff
□ Decisão: renovar / expandir módulos / upsell para enterprise
□ Meta: [ROI mensurável — tempo economizado, resultado gerado]

**ALERTAS DE RISCO DE CHURN (Analytics Agent monitora):**
- Menos de 3 interações com o agente na semana 1 → alerta D+7
- Nenhum output gerado em 5 dias → check-in de emergência
- Usuário primário mudou sem comunicação → revalidar onboarding
- Feedback negativo no check-in → escalar para CS sênior

**EMAIL DE BOAS-VINDAS (template):**
Assunto: [Nome], seja bem-vindo ao VRAXIA OS — seu acesso está pronto
[corpo personalizado + próximos passos + link de acesso]
```

## Exemplo de uso

### Input
Cliente: DataLayer (45 funcionários, SaaS) | Módulo: Código + Operações | Usuário: Pedro (CTO)
Caso de uso: documentação automática de código + processos de eng

### Output
**Semana 0:** Call de kickoff quinta-feira 14h. Setup: API key BYOK configurada, módulo Código ativado para o repositório GitHub do Pedro. Meta semana 1: Pedro gera a documentação do módulo auth (que está desatualizada há 3 meses).

**Semana 1 meta:** 1 PR de documentação gerado pelo agente, revisado e aprovado por Pedro.

**Alerta configurado:** Se menos de 3 chamadas ao agente Código até D+7, enviar mensagem proativa: "Pedro, vi que o agente ainda não foi muito usado — 20 minutos para destravar algo?"

**Business Review D+30:** Apresentar — 8 docs geradas, 2h de eng economizadas por semana, próximo: ativar módulo Operações para onboarding de novos devs.

---
**Tags:** Avançado | CS | Comercial, Onboarding, Retenção, Churn, Analytics
