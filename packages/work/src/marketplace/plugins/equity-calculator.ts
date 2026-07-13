// equity-calculator — calcula compensação total real (salário + equity + benefícios)
import Anthropic from '@anthropic-ai/sdk';
import { AgentPlugin, AgentContext, AgentResult } from '../plugin-interface.js';

export const equityCalculator: AgentPlugin = {
  id:              'equity-calculator',
  name:            'Equity Calculator',
  description:     'Calcula o valor real do pacote (salário + equity + benefícios) e compara com sua pretensão.',
  longDescription: 'Extrai menções de equity, stock options, vesting e benefícios da JD e calcula o valor total do pacote de compensação. Compara com o salário alvo do candidato e dá um veredito claro.',
  version:         '1.0.0',
  author:          'VRAXIA',
  category:        'salary',
  intents:         ['SALARY', 'EXPLAIN', 'HUNT'],
  price:           'free',
  iconEmoji:       '📈',
  tags:            ['equity', 'stock options', 'vesting', 'compensação', 'total comp'],

  async execute(ctx: AgentContext): Promise<AgentResult> {
    const jd     = ctx.jobDescription ?? ctx.input;
    const target = ctx.twin.financial.targetSalary;

    // CPU: detecta sinais de equity
    const jdLower  = jd.toLowerCase();
    const hasEquity = ['equity', 'stock', 'options', 'vesting', 'esop', 'ações', 'participação'].some(k => jdLower.includes(k));
    const hasBenefits = ['plano de saúde', 'vale', 'gympass', 'wellhub', 'home office', 'férias', 'bônus'].some(k => jdLower.includes(k));

    if (!ctx.apiKey) {
      return {
        pluginId: 'equity-calculator',
        reply: `📈 **Equity Calculator**\n${hasEquity ? '✅ Equity detectado na JD' : '❌ Sem menção de equity'}\n${hasBenefits ? '✅ Benefícios mencionados' : '⚠️ Benefícios não especificados'}`,
      };
    }

    const client = new Anthropic({ apiKey: ctx.apiKey });
    const r = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: `Analise o pacote de compensação desta vaga.
Salário alvo do candidato: R$ ${target.toLocaleString('pt-BR')}

JD: ${jd.slice(0, 2000)}

Retorne JSON:
{
  "salarioEstimado": <número ou null>,
  "equityAnual": <valor estimado anual em BRL ou 0>,
  "beneficiosAnual": <valor estimado em BRL ou 0>,
  "totalCompAnual": <soma total>,
  "vsTarget": <"acima"|"igual"|"abaixo"|"indeterminado">,
  "highlights": ["<benefício 1>", "<benefício 2>"],
  "verdict": "<Excelente pacote|Bom pacote|Pacote ok|Pacote fraco|Indeterminado>",
  "recomendacao": "<1 frase>"
}`,
      }],
    });

    const text   = r.content[0].type === 'text' ? r.content[0].text : '{}';
    const d      = JSON.parse(text.replace(/```json|```/g, '').trim());
    const fmt    = (n: number) => n ? `R$ ${Number(n).toLocaleString('pt-BR')}` : '?';
    const color  = { 'Excelente pacote': '🟢', 'Bom pacote': '🟢', 'Pacote ok': '🟡', 'Pacote fraco': '🔴', 'Indeterminado': '⚪' }[d.verdict as string] ?? '⚪';

    return {
      pluginId: 'equity-calculator',
      reply: `📈 **Equity Calculator** — ${color} ${d.verdict ?? 'Indeterminado'}
💼 Salário estimado: ${fmt(d.salarioEstimado)}
📊 Equity (anual): ${fmt(d.equityAnual)}
🎁 Benefícios (anual): ${fmt(d.beneficiosAnual)}
💰 **Total Comp Anual: ${fmt(d.totalCompAnual)}**
${d.recomendacao ?? ''}`,
      data: d,
      actions: [],
    };
  },
};
