---
name: mapeamento-de-stakeholders-enterprise
description: Mapear todos os stakeholders envolvidos em uma compra enterprise — identificando decisor econômico, influenciadores técnicos, bloqueadores e campeões internos — e definir a estratégia de abordagem para cada um, incluindo as mensagens e canais por perfil.
tags: [enterprise, stakeholders, decisor, mapeamento, abm, influenciador, campeão, b2b complexo]
---

# Mapeamento de Stakeholders Enterprise

## Objetivo
Identificar e mapear todos os envolvidos em uma venda enterprise — quem decide, quem influencia, quem bloqueia e quem defende internamente — e definir a estratégia de abordagem personalizada para cada perfil. Essencial para negociações com múltiplos decisores onde a abordagem de uma única pessoa raramente fecha.

## Quando usar
- Em oportunidades enterprise com ticket acima de R$10.000/mês
- Quando o prospect disse "preciso envolver outras pessoas"
- Para preparar uma apresentação para múltiplos stakeholders
- Em processos de venda com ciclo acima de 45 dias

## Como usar
1. Passe o que sabe sobre a empresa e os contatos identificados
2. O RAG Agent enriquece com dados do LinkedIn dos envolvidos
3. O Comercial AI mapeia os papéis e gera a estratégia por perfil
4. O Orchestrator Agent executa contatos paralelos com cada perfil
5. O campeão interno recebe materiais específicos para apresentar internamente

## O Prompt
```
Você é um especialista em vendas enterprise B2B complexas. Em compras acima de R$10k/mês, raramente existe um único decisor. Seu trabalho é mapear o comitê de compra e definir como abordar cada pessoa.

**EMPRESA PROSPECT:**
- Nome: [empresa]
- Porte: [funcionários]
- Setor: [setor]
- Oportunidade: [o que está sendo vendido + valor estimado]

**CONTATOS IDENTIFICADOS ATÉ AGORA:**
[liste nome, cargo, e o que você sabe sobre cada um]

**CONTEXTO DA OPORTUNIDADE:**
[como chegou até aqui, o que já foi discutido, qual o estágio]

**MAPEAMENTO DOS STAKEHOLDERS:**

Para cada perfil identificado, classifique:

**DECISOR ECONÔMICO (quem aprova o orçamento):**
- Nome e cargo: [...]
- Motivação principal: [o que importa para ele — ROI, risco, velocidade]
- Nível de suporte: [desconhecido / neutro / positivo / negativo]
- Estratégia de abordagem: [...]
- Mensagem-chave: [...]
- Canal preferido: [email / linkedin / call / apresentação formal]

**INFLUENCIADOR TÉCNICO (quem avalia a solução):**
- [idem]

**USUÁRIO FINAL (quem vai usar no dia a dia):**
- [idem]

**CAMPEÃO INTERNO (quem vai vender internamente para você):**
- [idem]
- Materiais para capacitar: [deck, one-pager, ROI calculator]

**BLOQUEADOR (quem tem interesse em não comprar):**
- Nome/cargo provável: [...]
- Por que pode bloquear: [...]
- Como neutralizar: [...]

**PLANO DE AÇÃO MULTI-STAKEHOLDER:**
- Semana 1: [quem contatar + mensagem]
- Semana 2: [...]
- Semana 3: [apresentação coletiva ou individual?]
- Semana 4: [...]

**ALERTA DE RISCO:**
[o que pode derrubar a negociação + como mitigar]
```

## Exemplo de uso

### Input
Empresa: ContaFácil (180 funcionários, SaaS financeiro) | Oportunidade: VRAXIA OS R$9.800/mês
Contatos: Lucas (CTO, primeiro contato), Ana (CFO, mencionada por Lucas), Pedro (Head of Eng, vai usar)

### Output
**Decisor Econômico: Ana (CFO)**
Motivação: ROI e controle de custo. Não quer riscos com vendor novo.
Suporte: Desconhecida.
Estratégia: Não abordar frio — pedir ao Lucas para apresentar internamente primeiro.
Mensagem-chave: Payback em 22 dias, ROI documentado, SLA de suporte.

**Influenciador Técnico: Lucas (CTO)**
Motivação: Eficiência do time de engenharia.
Suporte: Positivo (iniciou o contato).
Estratégia: Fornecer materiais técnicos, fazer dele o campeão.
Mensagem-chave: Integração simples, BYOK, sem lock-in.

**Campeão Interno: Lucas**
Materiais: One-pager de ROI para Ana, deck técnico para Pedro, calculadora de economia de horas.

**Bloqueador provável:** Time de TI/Segurança (processo de aprovação de novos softwares).
Mitigação: Preparar security review doc com SOC2/LGPD compliance.

**Plano:** Sem 1: Materiais para Lucas apresentar para Ana. Sem 2: Call com Lucas + Pedro (demo técnica). Sem 3: Apresentação executiva com Ana se Lucas tiver suporte. Sem 4: Proposta final com SLA.

---
**Tags:** Avançado | Enterprise | Comercial, Stakeholders, ABM, Negociação
