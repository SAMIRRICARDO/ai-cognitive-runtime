import Anthropic from '@anthropic-ai/sdk';
import type { Lead, AgentOutput } from '../../types/commercial.js';
import type { SessionMemory } from '../../memory/sessionMemory.js';

const client = new Anthropic();

const ENRICHMENT_SYSTEM = `
Você é o agente de inteligência comercial do VRAXIA para a VRASHOWS.

A VRASHOWS vende operação completa de eventos corporativos:
stand, transfer executivo, logística, recepção, segurança, foto/vídeo, hospedagem.
Clientes ideais: empresas B2B de médio/grande porte que participam de eventos, feiras e convenções.

Dado um lead, gere um dossiê comercial completo para fechar negócio.
Retorne SOMENTE JSON puro, sem markdown, sem texto adicional.

Esquema obrigatório:
{
  "id": "string",
  "name": "string",
  "company": "string",
  "role": "string",
  "linkedin_url": "string ou null",

  "perfil": {
    "senioridade": "c-level|vp|diretor|gerente|coordenador",
    "poder_decisao": "decisor-final|forte-influencia|influenciador|recomendador",
    "tempo_no_cargo_meses": 0,
    "empresas_anteriores": ["string"],
    "formacao": "string"
  },

  "empresa": {
    "porte": "startup|pme|mid-market|enterprise",
    "funcionarios_estimados": 0,
    "receita_estimada": "string",
    "setor": "string",
    "momento_atual": "crescimento|estavel|reestruturacao|fusao-aquisicao",
    "iniciativas_estrategicas": ["string"],
    "fornecedores_atuais": ["string"]
  },

  "eventos": {
    "participa_eventos": true,
    "eventos_conhecidos": ["string"],
    "papel_nos_eventos": "patrocinador|expositor|palestrante|participante|organizador",
    "budget_eventos_estimado": "string",
    "ultimo_evento_registrado": "string",
    "frequencia_estimada": "anual|semestral|trimestral|mensal"
  },

  "triggers_comerciais": {
    "sinais_de_expansao": ["string"],
    "vagas_abertas_relevantes": ["string"],
    "noticias_recentes": "string",
    "ciclo_orcamentario": "Q1|Q2|Q3|Q4|desconhecido",
    "urgencia_estimada": "alta|media|baixa"
  },

  "inteligencia_social": {
    "atividade_linkedin": "alta|media|baixa|inativa",
    "temas_de_interesse": ["string"],
    "resumo_posts_recentes": "string",
    "tamanho_rede_estimado": "string"
  },

  "estrategia_abordagem": {
    "melhor_canal": "linkedin|email|whatsapp|telefone",
    "melhor_horario": "string",
    "tom_recomendado": "estrategico|tecnico|roi|relacionamento",
    "angulo_de_abertura": "string (frase de abertura específica para esse lead)",
    "objecoes_previstas": ["string"],
    "como_rebater": ["string (resposta direta para cada objeção)"],
    "proposta_de_valor": "string (pitch de 1 linha específico para esse lead)"
  },

  "scores": {
    "fit_icp": 0,
    "urgencia": 0,
    "potencial_de_negocio": 0,
    "acessibilidade": 0,
    "overall": 0,
    "fit": "high|medium|low",
    "justificativa": "string (1 linha)"
  },

  "pain_points": ["string"],
  "tech_stack": ["string"],
  "enriched": true
}

REGRAS:
- Scores de 0 a 100. overall = média ponderada (fit_icp 40% + urgencia 20% + potencial 30% + acessibilidade 10%)
- eventos.participa_eventos deve ser true para empresas com feiras, convenções, lançamentos
- angulo_de_abertura deve mencionar algo específico da empresa ou cargo, nunca genérico
- objecoes_previstas e como_rebater devem ter o mesmo número de itens (index alinhado)
- proposta_de_valor focada nos serviços VRASHOWS que mais se aplicam ao perfil
`.trim();

export async function runEnrichment(
  input: { lead: Lead },
  memory: SessionMemory
): Promise<AgentOutput> {
  if (!input.lead) {
    return { success: false, data: {}, error: 'Lead não fornecido para enriquecimento' };
  }

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2000,
    system: ENRICHMENT_SYSTEM,
    messages: [{
      role: 'user',
      content: `Gere o dossiê comercial completo para: ${JSON.stringify(input.lead)}`
    }]
  });

  const rawText = response.content[0].type === 'text' ? response.content[0].text.trim() : '{}';
  const raw = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  try {
    const dossie = JSON.parse(raw) as Record<string, unknown>;

    // Extrair overall score para o campo score raiz (compatível com o pipeline)
    const scores = dossie['scores'] as Record<string, unknown> | undefined;
    const overallScore = typeof scores?.['overall'] === 'number' ? scores['overall'] : undefined;
    const fit = typeof scores?.['fit'] === 'string' ? scores['fit'] : undefined;

    const enrichedLead = {
      ...input.lead,
      ...dossie,
      score: overallScore ?? input.lead.score,
      fit: fit ?? input.lead.fit,
      enriched: true
    };

    return {
      success: true,
      data: { lead: enrichedLead },
      next_action: 'score_lead'
    };
  } catch (e) {
    console.error('[Enrichment] Parse falhou. Tentando recuperação parcial. Raw:', raw.slice(0, 400));
    // Fallback: retorna lead original com flag de erro, não quebra o pipeline
    return {
      success: true,
      data: { lead: { ...input.lead, enriched: true, enrichment_partial: true } },
      next_action: 'score_lead'
    };
  }
}
