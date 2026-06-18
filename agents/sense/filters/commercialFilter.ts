// NÍVEL 0 — Filtro determinístico. Custo zero de API.
// Responsabilidade única: decidir se vale a pena gastar tokens nisso.
// 70-80% dos eventos devem ser descartados aqui antes de qualquer chamada LLM.

import { SENSE_CONFIG } from '../../../config/senseConfig.js';

export interface RawEvent {
  prospect_name: string;
  company: string;
  job_title: string;
  linkedin_url: string;
  message_content: string;
}

export interface FilterResult {
  passed: boolean;
  reason: string;
}

export function commercialFilter(event: RawEvent): FilterResult {
  const { minMessageLength, noiseWords } = SENSE_CONFIG.commercial;
  const text = event.message_content.trim().toLowerCase();

  if (!event.prospect_name || !event.message_content) {
    return { passed: false, reason: 'payload incompleto' };
  }

  if (text.length < minMessageLength) {
    return { passed: false, reason: 'mensagem muito curta' };
  }

  const isOnlyNoise = noiseWords.some(w => text === w || text === w + '!' || text === w + '.');
  if (isOnlyNoise) {
    return { passed: false, reason: 'mensagem apenas social, sem conteúdo acionável' };
  }

  return { passed: true, reason: 'passou no filtro determinístico' };
}
