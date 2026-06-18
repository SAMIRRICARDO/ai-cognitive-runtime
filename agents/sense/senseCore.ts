// Orquestrador central do VRAXIA Sense.
// Único ponto de entrada que o webhook deve chamar.
// Nunca modifica classifierAgent.ts, telegram.ts ou linkedinWebhook.ts — só os importa.

import Anthropic from '@anthropic-ai/sdk';
import { commercialFilter, type RawEvent } from './filters/commercialFilter.js';
import { commercialTriage } from './triage/commercialTriage.js';
import { notifyTelegram } from '../../tools/telegram.js';
import { stripJsonFences } from './jsonStrip.js';
import type { ClassifierResult } from '../classifierAgent.js';

// Inline classifier that strips markdown fences before parsing.
// Replicates the classifierAgent prompt without duplicating business logic.
const _client = new Anthropic();
const _CLASSIFIER_PROMPT = `Qualificador B2B de respostas LinkedIn. JSON puro, sem markdown.

VARIANTES: A=equipe própria B=agência/parceiro C=híbrido D=baixa frequência E=interesse direto
INTENT: high=pediu info/reunião/dor clara medium=curiosidade leve low=desviou none=fora do ICP

CARGO→DECISION_POWER+SCORE (inferir do campo Cargo):
high 8-10: Diretor, VP, Head, C-Level, CEO, CFO, CTO, Presidente
mid  5-7:  Gerente, Coordenador Sênior, Supervisor
low  1-4:  Analista, Assistente, Estagiário, Coordenador Júnior

HANDOFF true: (intent=high E power=high|mid) OU (intent=medium E power=high)
HANDOFF false: power=low (qualquer intent) OU intent=low|none

{"variant":"A"|"B"|"C"|"D"|"E","intent":"high"|"medium"|"low"|"none","decision_power":"high"|"mid"|"low","score":1-10,"handoff":true|false,"reason":"≤15 palavras","suggested_next_action":"string"}`;

async function classifyForSense(reply: string, prospect: { name: string; company: string; role: string }): Promise<ClassifierResult> {
  const response = await _client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    system: _CLASSIFIER_PROMPT,
    messages: [{ role: 'user', content: `Decisor: ${prospect.name} | Cargo: ${prospect.role} | Empresa: ${prospect.company}\nResposta: "${reply}"` }],
  });
  const raw = response.content[0].type === 'text' ? response.content[0].text : '{}';
  return JSON.parse(stripJsonFences(raw)) as ClassifierResult;
}

export interface SenseResult {
  processed: boolean;
  stage: 'filtered_out' | 'triaged_out' | 'classified' | 'handoff' | 'error';
  detail: string;
}

export async function runCommercialSense(event: RawEvent): Promise<SenseResult> {
  // ── NÍVEL 0 — custo zero ──────────────────────────────────────────────────
  const filterResult = commercialFilter(event);
  if (!filterResult.passed) {
    console.log(`[Sense] Nível 0 descartado: ${filterResult.reason}`);
    return { processed: false, stage: 'filtered_out', detail: filterResult.reason };
  }
  console.log(`[Sense] Nível 0 passou: ${filterResult.reason}`);

  // ── NÍVEL 1 — Haiku triagem (~80 tokens) ─────────────────────────────────
  const triageResult = await commercialTriage(event);
  if (!triageResult.relevant) {
    console.log(`[Sense] Nível 1 descartado: sinal=${triageResult.quick_signal}`);
    return { processed: false, stage: 'triaged_out', detail: `baixa relevância na triagem (sinal: ${triageResult.quick_signal})` };
  }
  console.log(`[Sense] Nível 1 relevante: sinal=${triageResult.quick_signal}`);

  // ── NÍVEL 2 — classifierAgent existente (não duplicar lógica) ─────────────
  let classification: ClassifierResult;
  try {
    classification = await classifyForSense(event.message_content, {
      name: event.prospect_name,
      company: event.company,
      role: event.job_title,
    });
  } catch (err) {
    console.error(`[Sense] Nível 2 erro: ${err}`);
    return { processed: false, stage: 'triaged_out', detail: 'erro no classificador — retry recomendado' };
  }

  console.log(`[Sense] Nível 2 classificado: variant=${classification.variant} intent=${classification.intent} handoff=${classification.handoff}`);

  if (classification.handoff) {
    const report = buildHandoffReport(event, classification);
    await notifyTelegram(report);
    return { processed: true, stage: 'handoff', detail: `notificação enviada — ${classification.variant}/${classification.intent}` };
  }

  return { processed: true, stage: 'classified', detail: `processado sem handoff — intent: ${classification.intent}` };
}

function buildHandoffReport(event: RawEvent, classification: ClassifierResult): string {
  return `🔔 <b>VRAXIA SENSE — LEAD DETECTADO</b>

👤 <b>${event.prospect_name}</b>
💼 ${event.job_title}
🏢 ${event.company}
🔗 ${event.linkedin_url}

💬 <b>Resposta recebida:</b>
<i>"${event.message_content}"</i>

🧠 <b>Análise IA:</b>
Perfil: <b>${classification.variant}</b> | Intent: <b>${classification.intent.toUpperCase()}</b> | Score: <b>${classification.score}/10</b>
${classification.reason}

▶️ <b>Próximo passo:</b>
${classification.suggested_next_action}

<code>Detectado automaticamente · VRAXIA Sense · ${new Date().toLocaleString('pt-BR')}</code>`.trim();
}
