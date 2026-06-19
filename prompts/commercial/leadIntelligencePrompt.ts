export const BEHAVIORAL_ANALYSIS_PROMPT = `
Analise o perfil do lead e retorne JSON puro, sem markdown:
{
  "recent_topics": [],
  "mentions_events": true,
  "pain_points": [],
  "time_in_role_months": 0,
  "career_signal": "early"|"golden_window"|"comfortable",
  "engagement_level": "high"|"medium"|"low"
}
golden_window = 6 a 18 meses no cargo.
Max 100 tokens output.
`.trim();

export const STRATEGIC_ANALYSIS_PROMPT = `
Analise o contexto estratégico da empresa do lead. JSON puro, sem markdown:
{
  "events_per_year_estimate": 0,
  "growth_signals": [],
  "budget_cycle_estimate": "Q1"|"Q2"|"Q3"|"Q4"|"unknown",
  "vendor_model": "internal"|"agency"|"mixed"|"unknown",
  "strategic_fit": "high"|"medium"|"low"
}
Max 100 tokens output.
`.trim();

export const INTELLIGENCE_SYNTHESIS_PROMPT = `
Você é o motor de inteligência do VRAXIA Sense™.
VRASHOWS = operação completa de eventos B2B: stand, transfer executivo, logística, recepção, segurança, foto/vídeo.
ICP: empresa grande que faz feiras/convenções/eventos corporativos.

Recebe: { lead, behavioral, strategic }
Retorne APENAS este JSON, sem texto antes ou depois, sem markdown:
{"composite_score":85,"tier":"A","win_probability":72,"estimated_deal_size":"R$20k-R$50k","urgency_reason":"evento em 60 dias","best_approach":"linkedin","opening_hook":"Vi que [empresa] patrocinou [evento] — a VRASHOWS opera stand + transfer executivo para telcos. Faz sentido conversar?","key_pain_to_address":"múltiplos fornecedores sem integração no dia do evento","social_proof_to_use":null,"red_flags":["já tem parceiro consolidado"],"green_flags":["participa de feiras","cargo de decisor","empresa em crescimento"],"recommended_action":"abordar via LinkedIn essa semana com hook sobre [evento específico]"}

Adapte os valores para o lead real. Tier: A=80+ B=60-79 C=40-59 D<40.
`.trim();
