---
name: proposta-comercial-b2b-personalizada
description: Gerar uma proposta comercial B2B personalizada para um prospect qualificado — com diagnóstico da situação atual, solução proposta, ROI projetado, investimento e próximos passos — pronta para enviar como PDF via email-sender do VRAXIA.
tags: [proposta, comercial, b2b, roi, pdf, fechamento, negociação, email-sender]
---

# Proposta Comercial B2B Personalizada

## Objetivo
Gerar uma proposta comercial B2B personalizada para um prospect que já passou pela qualificação e demonstrou interesse — com diagnóstico da situação atual, solução proposta, ROI projetado, planos e investimento, e próximos passos claros. Saída formatada para ser convertida em PDF e enviada como attachment via `email-sender` do VRAXIA.

## Quando usar
- Após uma call de discovery ou demonstração com o prospect
- Quando o prospect pediu uma proposta formal
- Para criar o template de proposta por segmento/vertical (uma vez, reusar N vezes)
- Como material de follow-up após uma demo bem-sucedida

## Como usar
1. Passe as notas da call de discovery e o contexto do prospect
2. O Comercial AI gera a proposta estruturada em markdown
3. Converta para PDF com a identidade visual configurada
4. Envie via `email-sender` do VRAXIA com o PDF como attachment
5. O Analytics Agent monitora abertura do email e do PDF

## O Prompt
```
Você é um consultor de vendas B2B sênior. Uma proposta que converte não é um catálogo de produtos — é um espelho da situação do cliente com a solução específica para o problema dele. O cliente deve ler e pensar "eles entenderam exatamente o que precisamos".

ESTRUTURA DA PROPOSTA (priorizar clareza sobre volume):

**DADOS DA PROPOSTA:**
- Empresa prospect: [nome]
- Decisor(es): [nomes e cargos]
- Data: [data]
- Validade da proposta: [prazo]

**NOTAS DA CALL/DISCOVERY:**
[cole aqui tudo que foi levantado na reunião — dores, contexto, objeções, urgência]

**PRODUTO/SERVIÇO OFERECIDO:**
[descreva o que está sendo proposto]

**PLANOS/OPÇÕES DE PREÇO DISPONÍVEIS:**
[liste os planos e valores]

Gere a proposta completa:

---
## 1. DIAGNÓSTICO — "Onde vocês estão hoje"
[2-3 parágrafos descrevendo a situação atual do cliente com as próprias palavras deles]
- Principal dor identificada
- Custo atual do problema (tempo, dinheiro, risco)
- O que acontece se nada mudar

## 2. SOLUÇÃO PROPOSTA — "O que entregamos"
[Descrição específica do que será implementado — NÃO descrição genérica do produto]
- Módulos/componentes ativados para este cliente
- Cronograma de implementação
- O que muda em 30, 60, 90 dias

## 3. RESULTADOS ESPERADOS
- ROI projetado (com premissas explícitas)
- Métricas de sucesso definidas
- Benchmark de clientes similares

## 4. INVESTIMENTO
| Plano | O que inclui | Investimento mensal | Setup |
|---|---|---|---|
| [Starter] | [...] | R$ [...] | R$ [...] |
| [Recomendado] | [...] | R$ [...] | R$ [...] |
| [Enterprise] | [...] | [...] | [...] |

*Recomendamos o plano [X] porque [justificativa baseada no contexto deles]*

## 5. PRÓXIMOS PASSOS
1. [Data]: Aprovação da proposta
2. [Data]: Reunião de kickoff
3. [Data]: Início da implementação
4. [Data]: Primeiro resultado mensurável

## 6. POR QUE AGORA
[Urgência real — não fabricada — baseada no contexto levantado]

---
```

## Exemplo de uso

### Input
Prospect: FinPay (Ricardo, CTO) | Série A recente | Time crescendo | Dor: processos manuais e documentação
Produto: VRAXIA OS (plano Professional, R$4.900/mês)
Discovery: "Perdemos 20h/semana de engenheiros em tarefas que poderiam ser automatizadas. Com a série A precisamos escalar sem aumentar custo operacional proporcionalmente."

### Output
**Diagnóstico:** A FinPay está em um momento de crescimento acelerado pós-série A — e a principal ameaça não é falta de produto, mas falta de escala operacional. Com 4 novos engenheiros chegando, as 20h semanais em tarefas manuais que Ricardo mencionou vão triplicar sem uma solução estrutural. O custo atual: ~R$48K/mês em horas de engenharia senior consumidas por processos que não geram produto.

**Solução:** Ativar o VRAXIA OS com os módulos Operações + Produto + Código — automatizando documentação de processos, onboarding técnico e revisões de código com agentes IA especializados.

**ROI:** Recuperando 15h/semana de 6 engenheiros (premissa conservadora) = 90h/mês = ~R$45K de valor liberado/mês. Payback em 11 dias de uso.

---
**Tags:** Avançado | Template | Comercial, Proposta, Fechamento, ROI
