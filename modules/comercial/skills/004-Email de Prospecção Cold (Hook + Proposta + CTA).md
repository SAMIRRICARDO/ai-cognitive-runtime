---
name: email-de-prospeccao-cold-hook-proposta-cta
description: Criar um email de prospecção cold B2B de alta performance — com hook personalizado por contexto do prospect, proposta de valor em 2 linhas e CTA de baixo atrito — pronto para o dispatcher do VRAXIA disparar via Resend com PDF institucional anexado.
tags: [cold email, outbound, copywriting, hook, cta, resend, dispatcher, b2b]
---

# Email de Prospecção Cold (Hook + Proposta + CTA)

## Objetivo
Criar um email de prospecção cold B2B que chega à caixa de entrada, é aberto pelo decisor e gera resposta — com hook personalizado pelo contexto do prospect (extraído pelo RAG Agent), proposta de valor direta e CTA de baixo atrito. Saída formatada para o `email-sender` do VRAXIA (campos `subject`, `body`, `cta`).

## Quando usar
- Para gerar o corpo do email no pipeline de outbound do VRAXIA
- Quando o Orchestrator Agent precisa de copy para um batch de prospects
- Ao criar variações A/B de subject line para testar com o Analytics Agent
- Para personalização por vertical/segmento antes do disparo

## Como usar
1. O RAG Agent coleta o contexto do prospect (cargo, empresa, momento, dor)
2. Passa para o Comercial AI com este prompt
3. Recebe `subject` + `body` + variação de subject para A/B
4. O dispatcher envia via Resend com o PDF institucional como attachment
5. O Analytics Agent registra abertura, clique e resposta

## O Prompt
```
Você é um especialista em cold email B2B com taxa de resposta consistentemente acima de 8%. Você sabe que: (1) o subject decide se abre, (2) a primeira linha decide se lê, (3) emails curtos convertem mais, (4) o CTA deve pedir o mínimo possível.

REGRAS ABSOLUTAS:
- Máximo 120 palavras no corpo (sem contar assinatura)
- Zero jargão corporativo ("soluções inovadoras", "plataforma robusta")
- Hook personalizado obrigatório na primeira linha — NÃO genérico
- CTA pede apenas uma coisa pequena (15min, sim/não, um clique)
- Tom: humano, direto, levemente informal (não robótico)

Escreva o email de prospecção para:

**PROSPECT:**
- Nome: [primeiro nome]
- Cargo: [cargo exato]
- Empresa: [nome da empresa]
- Setor: [setor]
- Porte: [número de funcionários ou faturamento]

**CONTEXTO DO PROSPECT (do RAG Agent):**
[cole aqui o contexto extraído: notícia recente, post no LinkedIn, expansão de time, produto lançado, desafio público]

**PRODUTO/SERVIÇO QUE ESTOU OFERECENDO:**
[descreva em 2 linhas o que oferece e o resultado principal]

**DOR QUE ENDEREÇA:**
[qual dor específica deste prospect você resolve]

**PDF/MATERIAL QUE SERÁ ANEXADO:**
[nome e resumo do material — ex: "Proposta VRAXIA OS — como empresas como a [empresa deles] reduzem 60% do trabalho operacional"]

Entregue:

**SUBJECT LINE A (direto, pergunta ou número):**
[subject]

**SUBJECT LINE B (personalizado com empresa/cargo):**
[subject — para teste A/B]

**CORPO DO EMAIL:**
[email completo, máximo 120 palavras]

**ASSINATURA:**
[nome | cargo | empresa | WhatsApp | site]

**ANÁLISE:**
- Por que o hook vai funcionar para este prospect
- Qual objeção este email pode gerar (e como o follow-up vai tratar)
```

## Exemplo de uso

### Input
Prospect: Ricardo, CTO, FinPay (fintech 120 funcionários)
Contexto (RAG): Postou no LinkedIn sobre dificuldade em documentar processos com time crescendo. Estão contratando 3 engenheiros novos este mês.
Produto: VRAXIA OS — agentes IA para automação de processos operacionais
Dor: Time de produto sobrecarregado com tarefas repetitivas e documentação manual

### Output
**Subject A:** "documentação de processos quando o time dobra de tamanho"
**Subject B:** "Ricardo — como a FinPay está gerenciando o onboarding de 3 engenheiros novos?"

**Corpo:**
Vi seu post sobre documentar processos com o time crescendo — é exatamente quando isso vira um gargalo.

Trabalhamos com fintechs de 80-300 funcionários que usaram VRAXIA OS para automatizar a camada operacional: documentação, onboarding, revisões de processo — tudo rodando com agentes IA sem aumentar headcount.

Um dos nossos clientes (80 func., série A) reduziu 60% das tarefas manuais do time de produto em 6 semanas.

Faz sentido uma call de 15 minutos para te mostrar como aplicamos isso especificamente para stacks de fintech?

---
**Tags:** Avançado | Template | Comercial, Cold Email, Outbound
