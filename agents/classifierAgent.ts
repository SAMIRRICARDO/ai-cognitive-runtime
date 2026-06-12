import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

export type VariantKey = 'A' | 'B' | 'C' | 'D' | 'E';

export interface ClassifierResult {
  variant: VariantKey;
  intent: 'high' | 'medium' | 'low' | 'none';
  decision_power: 'high' | 'mid' | 'low';
  score: number;
  handoff: boolean;
  reason: string;
  suggested_next_action: string;
}

const SYSTEM_PROMPT = `Qualificador B2B de respostas LinkedIn. JSON puro, sem markdown.

VARIANTES: A=equipe própria B=agência/parceiro C=híbrido D=baixa frequência E=interesse direto
INTENT: high=pediu info/reunião/dor clara medium=curiosidade leve low=desviou none=fora do ICP

CARGO→DECISION_POWER+SCORE (inferir do campo Cargo):
high 8-10: Diretor, VP, Head, C-Level, CEO, CFO, CTO, Presidente
mid  5-7:  Gerente, Coordenador Sênior, Supervisor
low  1-4:  Analista, Assistente, Estagiário, Coordenador Júnior

HANDOFF true: (intent=high E power=high|mid) OU (intent=medium E power=high)
HANDOFF false: power=low (qualquer intent) OU intent=low|none

{"variant":"A"|"B"|"C"|"D"|"E","intent":"high"|"medium"|"low"|"none","decision_power":"high"|"mid"|"low","score":1-10,"handoff":true|false,"reason":"≤15 palavras","suggested_next_action":"string"}`;

export async function classifyLeadResponse(
  reply: string,
  prospect: { name: string; company: string; role: string }
): Promise<ClassifierResult> {
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Decisor: ${prospect.name} | Cargo: ${prospect.role} | Empresa: ${prospect.company}\nResposta: "${reply}"`
    }]
  });

  const raw = response.content[0].type === 'text' ? response.content[0].text.trim() : '{}';
  return JSON.parse(raw) as ClassifierResult;
}
