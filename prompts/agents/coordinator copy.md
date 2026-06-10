OBJECTIVE:
Executar pipeline de prospecção para a campanha de lançamento do livro "O Maior Ativo da Sua Empresa" de Samir Ricardo (lançamento oficial 09/07/2026).

Meta diária: 50 emails entregues via Resend para decision-makers de empresas de tecnologia.

---

PIPELINE DAG:

TASK_1 → FuturecomResearcher
TASK_2 → LeadEnrichmentAgent (depende de TASK_1)
TASK_3 → OutreachAgent (depende de TASK_2)
TASK_4 → EmailSenderAgent (depende de TASK_3)

---

TASK_1 — FuturecomResearcher

Buscar leads qualificados com os seguintes critérios:

TARGET_PROFILES:
  - CEO
  - Diretor Executivo
  - Diretor de Tecnologia
  - CTO (Chief Technology Officer)
  - CIO (Chief Information Officer)
  - Diretor de Operações
  - Diretor de RH / People & Culture
  - Head of AI / Head of Data

TARGET_COMPANIES:
  Setor: Tecnologia / SaaS / Software Enterprise
  Porte: acima de 200 funcionários (preferencialmente 500+)
  Localização: Brasil (prioridade São Paulo e sudeste)
  
  Exemplos de empresas-alvo (não limitado a):
  - TOTVS, Linx, Stefanini, CI&T, Boa Compra, Locaweb
  - Movile, Wildlife, Olist, Vtex, Nuvemshop, Dock
  - Empresas listadas no ranking Great Place to Work Tech Brasil
  - Empresas com vagas abertas de SDR, Analista de RH, Analista Financeiro
    (sinal: estão contratando → potencial ICP VRAXIA)

SEARCH_SOURCES:
  1. LinkedIn (busca por cargo + empresa + setor)
  2. Site da empresa (página "Sobre" / "Equipe" / "Liderança")
  3. Google: "CEO [empresa] LinkedIn" / "CTO [empresa] site:linkedin.com"
  4. Crunchbase (founders e C-level de scale-ups tech)

OUTPUT por lead:
  - nome_completo
  - cargo
  - empresa
  - setor
  - tamanho_empresa (estimado)
  - linkedin_url
  - site_empresa
  - cidade
  - sinal_de_compra (se identificado)
  - confianca: high | medium | low

DAILY_QUOTA: 60 leads pesquisados (buffer para validação de email)
QUALITY_GATE: descartar leads com confiança "low"

---

TASK_2 — LeadEnrichmentAgent

Para cada lead aprovado em TASK_1:

1. DESCOBRIR EMAIL via:
   a. Padrão de email da empresa (ex: nome@empresa.com.br)
      - Testar padrões: {primeiro}@, {primeiro}.{ultimo}@, {f}{ultimo}@
      - Validar padrão via Hunter.io API (se disponível) ou via MX lookup
   b. LinkedIn profile → extrair email público se visível
   c. Site da empresa → página de contato / press
   d. Google: "email [nome] [empresa]"

2. VALIDAR EMAIL via:
   - Syntax check (regex)
   - MX record lookup (domínio existe e aceita email)
   - SMTP verification sem envio (se disponível)
   - Classificar: valid | risky | invalid
   - Descartar: invalid
   - Manter: valid + risky (com flag)

3. OUTPUT por lead enriquecido:
   - todos os campos de TASK_1
   - email (validado)
   - email_status: valid | risky
   - email_pattern_used
   - linkedin_url (confirmado)
   - decisao_maker_score: 1-10
     (10 = CEO/CTO empresa 500+ com email válido confirmado)

DAILY_QUOTA: enriquecer até 55 leads (descartar inválidos para chegar a 50)

---

TASK_3 — OutreachAgent

CAMPAIGN_CONTEXT:
  Remetente: Samir Ricardo
  Cargo: Engenheiro de IA | Fundador VRAXIA | Autor
  Livro: "O Maior Ativo da Sua Empresa — E por que ele está indo embora?"
  Lançamento: 09/07/2026
  Amazon: [inserir link após publicação]
  Landing page: https://vrashows.com.br/livro
  
FASE_ATUAL: FASE 1 — Ativação de Autoridade (03–15 jun)
ABORDAGEM: NÃO mencionar o livro ainda. Despertar a dor. Tom reflexivo e executivo.

Para cada lead enriquecido, gerar email personalizado:

REGRAS DE PERSONALIZAÇÃO:
  - Usar nome_completo (apenas primeiro nome no corpo)
  - Referenciar empresa do lead de forma específica (não genérica)
  - Referenciar cargo/setor quando relevante
  - Se sinal_de_compra identificado → usar como gancho de abertura
  - Tom: executivo, direto, sem formalidade excessiva
  - Sem pitch de produto na Fase 1
  - Comprimento: máximo 150 palavras no corpo

EMAIL_TEMPLATE_FASE_1:
  Assunto (variar entre estas opções):
    A) "A cadeira vazia na sala de reuniões"
    B) "O ativo que [Empresa] não consegue repor"
    C) "Uma pergunta sobre [Empresa]"
    D) "O problema que ninguém nomeia"

  Corpo base (adaptar por lead):
  ---
  Olá [Primeiro Nome],

  Toda organização tem pelo menos um profissional cujo conhecimento
  é insubstituível — não pelo cargo, mas pelo que está na cabeça dele.

  Os contextos, os julgamentos, as decisões acumuladas em 10, 15, 20 anos.

  Quando esse profissional sai, [Empresa] não perde um colaborador.
  Perde décadas de inteligência organizacional construída a um custo imenso.

  Chamo isso de Hemorragia Cognitiva.

  Nos próximos dias vou compartilhar o que aprendi sobre como
  as organizações mais inteligentes estão resolvendo esse problema.

  Abraço,
  Samir Ricardo
  ---

  Assinatura:
  ---
  Samir Ricardo
  Engenheiro de IA | Fundador VRAXIA
  vrashows.com.br/livro
  linkedin.com/in/samir-ricardo-almeida-b23b3825b
  ---

OUTPUT por email:
  - lead_id
  - assunto_escolhido
  - corpo_final (personalizado)
  - personalizacao_aplicada (lista dos campos usados)
  - fase: 1

---

TASK_4 — EmailSenderAgent

Entregar via Resend API:

SEND_CONFIG:
  from: "Samir Ricardo <samir@vrashows.com.br>"
  reply_to: "samir@vrashows.com.br"
  daily_limit: 50
  send_window: 08:00–18:00 (horário de Brasília)
  interval_between_sends: randomizado entre 8–15 minutos
    (evitar padrão de automação detectável por filtros)
  
TRACKING:
  - Registrar: lead_id, email, assunto, timestamp_sent, status
  - Salvar log em: /data/outreach/campanha_livro/fase_1/{data}.json

STOP_CONDITIONS:
  - Se bounce_rate > 5% no dia → pausar e alertar
  - Se email_status = risky e bounce → marcar lead como inválido
  - Nunca reenviar para o mesmo email no mesmo dia

---

QUALITY_GATES GLOBAIS:
  - Nenhum email sai sem email_status = valid ou risky
  - Nenhum email sai com corpo genérico (personalização obrigatória)
  - Nenhum email menciona VRAXIA, livro ou produto na Fase 1
  - Coordinator deve validar amostra de 5 emails antes do disparo diário

---

EXECUTION_MODE: autonomous
DAILY_REPORT: ao final do dia, Memory Manager salva resumo:
  - leads_pesquisados
  - leads_enriquecidos
  - emails_validados
  - emails_enviados
  - bounces
  - custo_estimado_tokens