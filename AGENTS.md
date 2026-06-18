# IALEADS Runtime Rules

Governanca permanente do runtime IALEADS. Todos os agentes, automacoes, workers e pipelines devem seguir estas regras para manter baixo custo operacional, evitar consumo excessivo de tokens e impedir loops desnecessarios.

## Cheap Mode Global

- Usar `claude-haiku-4-5-20251001` para sourcing e enrichment simples (modelo cheap Claude-nativo).
- Evitar prompts longos.
- Evitar chain-of-thought.
- Evitar reasoning desnecessario.
- Usar respostas curtas.
- Usar JSON only quando possivel.
- Fazer enrichment leve.
- Usar `max_output_tokens` baixo.
- Evitar retries excessivos.
- Evitar loops infinitos.
- Evitar polling continuo.
- Encerrar processos apos finalizar batch.
- Usar cache/hash para empresas ja processadas.
- Evitar reprocessamento de leads.

## Acquisition Rules

- Maximo 25 leads por execucao.
- Maximo 1 execucao por dia util.
- Executar apenas segunda a sexta.
- Horario fixo: 07:30 AM.
- Bloquear finais de semana.
- Salvar logs obrigatoriamente.
- Salvar JSON final.
- Impedir duplicacoes.
- Deduplicar contra historico local antes de persistir novos leads.
- Encerrar o worker imediatamente apos finalizar o batch.

## Outbound Rules

- Usar batches pequenos.
- Aplicar throttling humano.
- Evitar comportamento spam.
- Executar apenas em horario comercial.
- Limite maximo ate 16h.
- Bloquear fins de semana quando configurado.
- Attachment obrigatorio:
  `C:\Users\Administrador\Downloads\vrashows_media_kit_optimized.pdf`
- Registrar logs de envio e falha.
- Nao disparar novo batch antes do batch atual finalizar.

## Runtime Governance

- Priorizar baixo custo operacional.
- Monitorar consumo OpenAI e Claude.
- Registrar analytics de tokens.
- Registrar custos IA.
- Manter observabilidade operacional.
- Persistir estado de execucao, cache e historico em arquivos/configuracoes versionaveis.
- Evitar estado critico apenas em memoria.
- Centralizar parametros persistentes em `config/runtime-config.json`.

## Scheduler Governance

- Acquisition deve rodar de segunda a sexta as 07:30.
- O scheduler deve bloquear finais de semana.
- O scheduler deve impedir mais de uma execucao por dia util.
- O scheduler deve salvar JSON final e logs.
- O scheduler nao deve manter daemon infinito para acquisition.
- Processos operacionais devem finalizar apos concluir o batch.

## Runtime Config

Os parametros persistentes obrigatorios ficam em `config/runtime-config.json`:

- `cheapMode`: true
- `maxLeadsPerBatch`: 25
- `maxDailyRuns`: 1
- `runTime`: "07:30"
- `weekendBlocked`: true
- `preferredModel`: "claude-haiku-4-5-20251001"
- `maxOutputTokens`: 300
- `poolRotationDays`: 90

## SaaS Readiness

- Manter arquitetura preparada para escalar como plataforma SaaS enterprise.
- Toda nova automacao deve respeitar cheap mode por padrao.
- Toda expansao de agentes deve declarar limites de tokens, batch e execucao.
- Toda rotina recorrente deve ter guard de custo, guard de duplicacao e condicao clara de saida.
