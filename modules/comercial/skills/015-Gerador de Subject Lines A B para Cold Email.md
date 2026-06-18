---
name: gerador-de-subject-lines-ab-para-cold-email
description: Gerar 10 subject lines A/B para cold email B2B testando diferentes ângulos — curiosidade, personalização, resultado, pergunta direta, urgência, prova social — com taxa de abertura estimada e critérios de qual testar primeiro baseados no perfil do prospect.
tags: [subject line, a/b test, cold email, abertura, copywriting, email-sender, personalização, taxa de abertura]
---

# Gerador de Subject Lines A/B para Cold Email

## Objetivo
Gerar 10 variações de subject line para cold email B2B testando diferentes frameworks de copy — e recomendar qual testar primeiro com base no cargo e setor do prospect. Subject lines determinam 50%+ da taxa de abertura. Um teste A/B sistemático permite calibrar o copy por vertical ao longo do tempo.

## Quando usar
- Antes de disparar uma campanha de cold email para nova lista
- Para calibrar o copy por vertical ou cargo (subject para CTO ≠ subject para CFO)
- Quando a taxa de abertura atual está abaixo de 35%
- Para criar banco de subject lines por segmento reutilizáveis

## Como usar
1. Passe o cargo do decisor, setor e proposta de valor principal
2. O Comercial AI gera as 10 variações com framework e score estimado
3. Teste 2-3 variações em paralelo (A/B split com o email-sender)
4. O Analytics Agent registra a taxa de abertura por variação
5. Escale a vencedora e descarte as perdedoras

## O Prompt
```
Você é especialista em cold email copywriting B2B. A subject line não existe para "vender" — existe para gerar uma abertura. É uma promessa de que o email vale 30 segundos de atenção. Nada mais.

FRAMEWORKS A TESTAR:
1. Personalização direta: usa nome da empresa ou detalhe específico
2. Pergunta de dor: provoca o problema sem revelar a solução
3. Resultado concreto: número + contexto = curiosidade
4. Nome + pergunta direta: mais simples, muito eficaz para C-level
5. Referência a algo deles: post, notícia, mudança recente
6. Quebra de padrão: curto, inesperado, fora do template óbvio
7. FOMO/Urgência (sutil): timing de mercado, não artificial
8. Prova social: empresa similar que conhecem
9. Provocação intelectual: afirmação que eles vão querer refutar
10. "Re:" falso (ético): simula thread existente — alta abertura, usar com cautela

**PRODUTO/SERVIÇO:** [descreva em 1 linha]
**PROPOSTA DE VALOR PRINCIPAL:** [o que muda para o prospect]
**CARGO DO DESTINATÁRIO:** [cargo]
**SETOR:** [setor]
**EMPRESA DO PROSPECT:** [nome]
**DETALHE ESPECÍFICO SOBRE ELES:** [o que o RAG coletou]

Gere as 10 subject lines:

| # | Framework | Subject Line | Chars | Abertura Estimada | Recomendação |
|---|---|---|---|---|---|
| 1 | Personalização | | | | |
| 2 | Pergunta de dor | | | | |
| 3 | Resultado concreto | | | | |
| 4 | Nome + pergunta | | | | |
| 5 | Referência direta | | | | |
| 6 | Quebra de padrão | | | | |
| 7 | FOMO sutil | | | | |
| 8 | Prova social | | | | |
| 9 | Provocação | | | | |
| 10 | Re: (ético) | | | | |

**TOP 3 PARA TESTAR PRIMEIRO (com justificativa):**
1. [subject] — porque [razão baseada no cargo/setor]
2. [subject] — porque
3. [subject] — porque

**REGRAS APLICADAS:**
- Máximo 60 caracteres (preview mobile)
- Sem spam words: grátis, oferta, exclusivo, promoção, urgente
- Nenhuma em maiúsculas (parece spam)
- Sem emoji em cold email B2B executivo
```

## Exemplo de uso

### Input
Produto: VRAXIA OS — automação de operações com agentes IA
Proposta de valor: reduz 20h/semana de tarefas manuais do time
Cargo: COO | Setor: SaaS B2B | Empresa: FlowDesk
Detalhe: anunciaram expansão para o México no mês passado

### Output
| # | Framework | Subject Line | Chars | Abertura Est. | Rec. |
|---|---|---|---|---|---|
| 1 | Personalização | FlowDesk + México: sua operação está pronta? | 45 | 38% | ✅ Top 1 |
| 2 | Pergunta de dor | Quantas horas manuais seu time perde por semana? | 49 | 35% | ✅ Top 2 |
| 3 | Resultado | 20h/semana de operações — eliminamos para 3 SaaS B2B | 53 | 33% | |
| 4 | Nome + pergunta | Rafael, o que você automatizaria primeiro na FlowDesk? | 54 | 31% | ✅ Top 3 |
| 5 | Referência | Sobre a expansão para o México | 31 | 29% | |
| 6 | Quebra padrão | desculpa a direto | 18 | 27% | |
| 7 | FOMO sutil | Expansão Q2 sem automação: risco calculado? | 44 | 26% | |
| 8 | Prova social | O que a DataPay fez com o mesmo desafio | 40 | 25% | |
| 9 | Provocação | COOs de SaaS estão errados sobre automação | 43 | 23% | |
| 10 | Re: (ético) | Re: FlowDesk operações | 21 | 22% | ⚠️ usar com cautela |

---
**Tags:** Iniciante | Copywriting | Comercial, Email, A/B, Taxa de Abertura
