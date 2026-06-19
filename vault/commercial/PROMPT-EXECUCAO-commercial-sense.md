# PROMPT DE EXECUÇÃO — Claude Code (VSCode)
# VRAXIA Commercial Sense — Implementação Completa

Cole este prompt no Claude Code dentro do diretório:
C:\AI-LAB\ai-cognitive-runtime

═══════════════════════════════════════════════════════════

Vamos implementar o VRAXIA Commercial Sense — um operador comercial
autônomo que infere o objetivo real por trás de pedidos do usuário
e executa o pipeline completo (Buscar → Enriquecer → Pontuar →
Outreach → CRM) sem precisar de instrução manual a cada passo.

ANTES DE ESCREVER QUALQUER CÓDIGO:
Leia todos os arquivos .md dentro de vault/commercial/
Eles contêm a arquitetura completa, tipos e código de referência.
Siga a especificação exatamente — não invente estruturas novas.

REGRA MAIS IMPORTANTE: economia de tokens.
- Camadas determinísticas (Context Resolver, State Machine, CRM)
  NUNCA chamam API — custo zero.
- Triagem e scoring usam Haiku (claude-haiku-4-5-20251001).
- APENAS o agente de Outreach usa Sonnet (claude-sonnet-4-6).
- Nenhum output de agente é texto livre — sempre JSON estruturado.

CRIE OS ARQUIVOS NESTA ORDEM EXATA:

1. types/commercial.ts
   Interfaces: Lead, SearchFilters, ExecutionPlan, PipelineStep, AgentOutput
   (ver seção 6 de commercial-sense-spec.md)

2. config/autonomyConfig.ts
   AUTONOMY_CONFIG com: level=1, score_threshold=60,
   max_leads_per_search=5, summary_interval=10

3. memory/sessionMemory.ts
   Interface SessionMemory + enum CommercialState + createEmptySession()
   + canTransition() + transition() + updateMemory() + summarizeIfNeeded()
   (ver session-memory-spec.md completo)

4. agents/commercial/contextResolver.ts
   resolveReferences() — ZERO chamadas de API
   (ver seção 5 de session-memory-spec.md)

5. agents/commercial/stateMachine.ts
   VALID_TRANSITIONS + canTransition() + transition()
   Extrair da sessionMemory.ts como módulo separado
   ZERO chamadas de API

6. prompts/commercial/goalInferencePrompt.ts
   GOAL_INFERENCE_PROMPT — string exportada, max 150 tokens output

7. prompts/commercial/actionPlannerPrompt.ts
   ACTION_PLANNER_PROMPT — string exportada, max 200 tokens output

8. prompts/commercial/scoringPrompt.ts
   SCORING_PROMPT — string exportada, max 100 tokens output

9. prompts/commercial/outreachPrompt.ts
   OUTREACH_PROMPT — string exportada, max 800 tokens output

10. agents/sense/goalInference.ts
    inferGoal() — Haiku, max_tokens: 150
    (ver seção 4 de goal-inference-spec.md)

11. agents/commercial/actionPlanner.ts
    createExecutionPlan() — Haiku, max_tokens: 200
    filterStepsByAutonomy() por nível 1/2/3
    (ver seção 6 de goal-inference-spec.md)

12. agents/commercial/prospector.ts
    runProspector() — Haiku, max_tokens: 256
    (ver seção 3 de execution-pipeline-spec.md)

13. agents/commercial/enrichment.ts
    runEnrichment() — Haiku, max_tokens: 400
    (ver seção 4 de execution-pipeline-spec.md)

14. agents/commercial/scoring.ts
    runScoring() — Haiku, max_tokens: 100
    descarta leads com score < 60
    (ver seção 5 de execution-pipeline-spec.md)

15. agents/commercial/outreach.ts
    runOutreach() — Sonnet (único com Sonnet), max_tokens: 800
    só executa se score >= 60
    (ver seção 6 de execution-pipeline-spec.md)

16. agents/commercial/crm.ts
    runCRM() — ZERO chamadas de API, só estrutura e loga
    (ver seção 7 de execution-pipeline-spec.md)

17. workers/executionQueue.ts
    runExecutionQueue() — orquestra os 5 agentes em sequência
    respeita autonomyLevel: 1 para após primeiro step se nível 1
    (ver seção 2 de execution-pipeline-spec.md)

18. agents/sense/senseOrchestrator.ts
    runCommercialSense() — ponto de entrada central
    orquestra: contextResolver → goalInference → actionPlanner
    → executionQueue → updateMemory → summarizeIfNeeded
    (ver seção 5 de goal-inference-spec.md)

19. Adicionar rota em workers/webhookServer.ts (SEM remover existentes):
    POST /sense/commercial/chat
    Recebe: { sessionId, message }
    Carrega ou cria SessionMemory para o sessionId
    Chama runCommercialSense()
    Retorna resultado + memória atualizada

APÓS CADA ARQUIVO: rodar npx tsc --noEmit antes de seguir.

NÃO MODIFICAR:
- agents/classifierAgent.ts
- workers/linkedinWebhook.ts
- tools/telegram.ts
- scripts/classifyReply.ts

TESTE FINAL após todos os arquivos criados:

# Iniciar servidor
npx tsx workers/webhookServer.ts

# Em outro terminal — simular pedido do usuário
curl -X POST http://localhost:3001/sense/commercial/chat \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "test-session-001",
    "message": "Me traga um diretor de marketing em telecom em São Paulo"
  }'

Resultado esperado no console:
[Sense] Referências resolvidas: {}
[Sense] Objetivo inferido: create_sales_opportunity confidence: 0.9
[Queue] Executando: prospector.search_lead
E no response: JSON estruturado com lead + awaiting_confirmation (nível 1)

═══════════════════════════════════════════════════════════
FIM DO PROMPT
