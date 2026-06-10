import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

export type VariantKey = 'A' | 'B' | 'C' | 'D' | 'E';

export interface ClassifierResult {
  variant: VariantKey;
  intent: 'high' | 'medium' | 'low' | 'none';
  handoff: boolean;
  reason: string;
  suggested_next_action: string;
}

const SYSTEM_PROMPT = `
Você é um agente de qualificação de leads B2B especializado em eventos corporativos.
Analise a resposta de um decisor no LinkedIn e classifique o nível de interesse.
Retorne SEMPRE JSON válido, sem texto adicional, sem markdown.

{
  "variant": "A"|"B"|"C"|"D"|"E",
  "intent": "high"|"medium"|"low"|"none",
  "handoff": true|false,
  "reason": "string curta max 15 palavras",
  "suggested_next_action": "string"
}

VARIANTES:
A = opera internamente com equipe própria
B = trabalha com agência ou fornecedor parceiro
C = modelo híbrido ou situacional
D = baixa frequência de eventos
E = interesse direto, pediu mais info, sugeriu reunião

INTENT:
high   = pediu info, mencionou dor, sugeriu reunião
medium = respondeu sem engajamento forte
low    = respondeu mas desviou
none   = negativo, fora do ICP

HANDOFF = true SOMENTE se intent === "high" ou variant === "E"
`;

export async function classifyLeadResponse(
  reply: string,
  prospect: { name: string; company: string; role: string }
): Promise<ClassifierResult> {
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Decisor: ${prospect.name} | ${prospect.role} | ${prospect.company}\nResposta: "${reply}"`
    }]
  });

  const raw = response.content[0].type === 'text' ? response.content[0].text.trim() : '{}';
  return JSON.parse(raw) as ClassifierResult;
}
