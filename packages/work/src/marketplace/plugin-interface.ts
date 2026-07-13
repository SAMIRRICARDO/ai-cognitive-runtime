// packages/work/src/marketplace/plugin-interface.ts
// Contrato que todo agente do marketplace deve implementar

import { CandidateTwin, QuickAction } from '../types/index.js';

export interface AgentContext {
  twin: CandidateTwin;
  apiKey?: string;
  input: string;           // mensagem natural do usuário
  intent: string;          // intent classificado pelo orchestrator
  jobId?: string;
  jobTitle?: string;
  company?: string;
  jobDescription?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentResult {
  reply: string;           // resposta em linguagem natural
  data?: unknown;          // dados estruturados opcionais
  actions?: QuickAction[]; // botões de ação rápida
  pluginId: string;        // quem gerou o resultado
}

export interface AgentPlugin {
  readonly id: string;
  readonly name: string;
  readonly description: string;          // 1 linha — exibida no card
  readonly longDescription: string;      // 2-3 linhas — exibida no modal
  readonly version: string;
  readonly author: string;
  readonly category: PluginCategory;
  readonly intents: string[];            // intents que este plugin pode enriquecer
  readonly price: 'free' | number;      // 'free' ou valor em BRL/mês
  readonly iconEmoji: string;
  readonly tags: string[];
  execute(context: AgentContext): Promise<AgentResult>;
}

export type PluginCategory =
  | 'hunt'
  | 'resume'
  | 'interview'
  | 'salary'
  | 'network'
  | 'analytics'
  | 'productivity';

export const CATEGORY_LABEL: Record<PluginCategory, string> = {
  hunt:         '🎯 Hunt',
  resume:       '📄 Currículo',
  interview:    '🎓 Entrevista',
  salary:       '💰 Salário',
  network:      '🤝 Networking',
  analytics:    '📊 Analytics',
  productivity: '⚡ Produtividade',
};
