// packages/work/src/chat/orchestrator.ts
// Career OS — Chat Orchestrator com IntentParser Haiku

import Anthropic from '@anthropic-ai/sdk';
import { ChatIntent, ChatResponse, QuickAction } from '../types/index.js';
import { TwinStore } from '../twin/candidate-twin.js';

const INTENTS: ChatIntent[] = [
  'HUNT', 'RESUME', 'INTERVIEW', 'SALARY', 'ANALYTICS',
  'NETWORK', 'CAREER', 'EXPLAIN', 'SETTINGS',
];

const INTENT_EXAMPLES: Record<ChatIntent, string[]> = {
  HUNT:      ['buscar vagas', 'candidatar', 'aplicar', 'procurar emprego', 'hunt', 'linkedin'],
  RESUME:    ['currículo', 'cv', 'atualizar perfil', 'melhorar cv', 'adaptar currículo'],
  INTERVIEW: ['entrevista', 'preparar', 'perguntas', 'coach', 'praticar', 'simular'],
  SALARY:    ['salário', 'pretensão', 'remuneração', 'negociação', 'quanto ganhar'],
  ANALYTICS: ['analytics', 'métricas', 'estatísticas', 'relatório', 'dashboard', 'números'],
  NETWORK:   ['networking', 'contato', 'conexão', 'recrutador', 'linkedin message'],
  CAREER:    ['carreira', 'plano', 'próximo passo', 'objetivos', 'crescimento'],
  EXPLAIN:   ['por que', 'explique', 'detalhe', 'motivo', 'razão', 'como funciona'],
  SETTINGS:  ['configurar', 'ajustar', 'definir', 'preferência', 'perfil'],
};

const INTENT_ACTIONS: Record<ChatIntent, QuickAction[]> = {
  HUNT:      [
    { label: '🚀 Candidatar 5 vagas', action: 'hunt:run:5', icon: 'play' },
    { label: '🔍 Dry-run (só filtrar)', action: 'hunt:dry-run', icon: 'eye' },
    { label: '📊 Ver fila', action: 'nav:queue', icon: 'list' },
  ],
  RESUME:    [
    { label: '📄 Ver CV atual', action: 'resume:view', icon: 'file-text' },
    { label: '✏️ Adaptar para vaga', action: 'resume:adapt', icon: 'edit' },
    { label: '📊 ATS Score', action: 'ats:analyze', icon: 'bar-chart' },
  ],
  INTERVIEW: [
    { label: '🎯 Simular entrevista', action: 'interview:start', icon: 'mic' },
    { label: '📋 Ver perguntas', action: 'interview:list', icon: 'list' },
    { label: '💡 Dicas rápidas', action: 'interview:tips', icon: 'lightbulb' },
  ],
  SALARY:    [
    { label: '💰 Atualizar pretensão', action: 'settings:salary', icon: 'dollar-sign' },
    { label: '📈 Benchmark de mercado', action: 'salary:benchmark', icon: 'trending-up' },
  ],
  ANALYTICS: [
    { label: '📊 Ver dashboard', action: 'nav:analytics', icon: 'bar-chart-2' },
    { label: '📅 Relatório semanal', action: 'analytics:weekly', icon: 'calendar' },
  ],
  NETWORK:   [
    { label: '👥 Ver conexões', action: 'network:list', icon: 'users' },
    { label: '✉️ Mensagem padrão', action: 'network:template', icon: 'mail' },
  ],
  CAREER:    [
    { label: '🎯 Plano de carreira', action: 'career:plan', icon: 'target' },
    { label: '📚 Skills gap', action: 'career:skills', icon: 'book' },
  ],
  EXPLAIN:   [
    { label: '🔍 Última candidatura', action: 'explain:last', icon: 'search' },
    { label: '📊 Ver todos os scores', action: 'explain:scores', icon: 'bar-chart' },
  ],
  SETTINGS:  [
    { label: '👤 Editar perfil', action: 'settings:profile', icon: 'user' },
    { label: '💰 Salário alvo', action: 'settings:salary', icon: 'dollar-sign' },
    { label: '📍 Localização', action: 'settings:location', icon: 'map-pin' },
  ],
};

export class ChatOrchestrator {
  private client: Anthropic;
  private store: TwinStore;
  private history: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  constructor(store: TwinStore, apiKey?: string) {
    this.client = new Anthropic({ apiKey });
    this.store  = store;
  }

  async chat(userInput: string, statsContext?: string): Promise<ChatResponse> {
    const intent = await this.classifyIntent(userInput);
    const twin   = this.store.get();
    const reply  = await this.generateReply(userInput, intent, twin, statsContext);
    const actions = INTENT_ACTIONS[intent];

    this.history.push({ role: 'user', content: userInput });
    this.history.push({ role: 'assistant', content: reply });
    if (this.history.length > 20) this.history = this.history.slice(-20);

    return { reply, intent, actions };
  }

  private async classifyIntent(input: string): Promise<ChatIntent> {
    const lower = input.toLowerCase();
    // Fast CPU classification before calling API
    for (const [intent, examples] of Object.entries(INTENT_EXAMPLES)) {
      if (examples.some(ex => lower.includes(ex))) {
        return intent as ChatIntent;
      }
    }

    try {
      const res = await this.client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 20,
        messages: [{
          role: 'user',
          content: `Classifique a mensagem abaixo em UMA das categorias: ${INTENTS.join(', ')}.
Retorne APENAS a categoria, sem explicação.
Mensagem: "${input}"`,
        }],
      });
      const text = (res.content[0].type === 'text' ? res.content[0].text : '').trim().toUpperCase();
      return (INTENTS.find(i => text.startsWith(i)) ?? 'EXPLAIN') as ChatIntent;
    } catch {
      return 'EXPLAIN';
    }
  }

  private async generateReply(
    input: string,
    intent: ChatIntent,
    twin: ReturnType<TwinStore['get']>,
    statsContext?: string,
  ): Promise<string> {
    const context = [
      `Candidato: ${twin.identity.name} — ${twin.professional.currentTitle}, ${twin.professional.yearsExp} anos de exp.`,
      `Stack principal: ${twin.professional.stack.slice(0, 6).join(', ')}`,
      `Objetivo: ${twin.preferences.workTypes.join('/')} — R$ ${twin.financial.targetSalary.toLocaleString('pt-BR')}`,
      statsContext ? `Status atual: ${statsContext}` : '',
    ].filter(Boolean).join('\n');

    const historyBlock = this.history.slice(-6).map(m =>
      `${m.role === 'user' ? 'Samir' : 'VRAXIA'}: ${m.content}`
    ).join('\n');

    const res = await this.client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: `Você é o assistente Career OS da plataforma VRAXIA WORK.
Responda de forma direta, útil e concisa ao candidato Samir Ricardo.
Intenção detectada: ${intent}

CONTEXTO DO CANDIDATO:
${context}

HISTÓRICO RECENTE:
${historyBlock || '(início da conversa)'}

MENSAGEM ATUAL: "${input}"

Responda em português, máximo 3 parágrafos curtos. Seja prático e acionável.`,
      }],
    });

    return res.content[0].type === 'text' ? res.content[0].text.trim() : 'Desculpe, não consegui processar.';
  }

  clearHistory(): void { this.history = []; }
}
