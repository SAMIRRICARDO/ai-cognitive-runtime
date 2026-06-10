import Anthropic from '@anthropic-ai/sdk';
import { CLASSIFIER_SYSTEM_PROMPT } from './constants.js';
import { parseClassification, FALLBACK_CLASSIFICATION } from './schemas.js';
import type { ClassificationResult } from './types.js';

const client = new Anthropic();

export async function classifyLeadResponse(
  prospectReply: string,
  prospectContext: {
    name: string;
    company: string;
    role: string;
  }
): Promise<ClassificationResult> {

  const userPrompt = `
Contexto do decisor:
- Nome: ${prospectContext.name}
- Empresa: ${prospectContext.company}
- Cargo: ${prospectContext.role}

Resposta recebida no LinkedIn:
"${prospectReply}"

Classifique essa resposta.
  `.trim();

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001', // cheap mode
    max_tokens: 256,                     // resposta curta, economiza token
    system: CLASSIFIER_SYSTEM_PROMPT,
    messages: [
      { role: 'user', content: userPrompt }
    ]
  });

  const raw = response.content[0].type === 'text'
    ? response.content[0].text.trim()
    : '';

  return parseClassification(raw) ?? FALLBACK_CLASSIFICATION;
}
