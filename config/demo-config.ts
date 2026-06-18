/**
 * Configuração centralizada do DEMO_MODE.
 * Módulos ativos executam LLM normalmente.
 * Módulos preview aparecem no dashboard mas bloqueiam execução
 * com a mensagem "Disponível na versão Enterprise."
 */

export const DEMO_ACTIVE_MODULES = [
  "comercial",   // Comercial Agent + Lead Intelligence (prospect_leads, classify_linkedin_reply)
] as const;

export const DEMO_PREVIEW_MODULES = [
  "lideranca",   // Executive Agent
  "financeiro",  // Finance Agent
  "marketing",   // Marketing Agent
  "juridico",    // Legal Agent
  "operacoes",   // Operations Agent
  "conteudo",    // Content Agent
  "produto",     // Product Agent
  "codigo",      // Tech Agent
] as const;

export const DEMO_ENTERPRISE_MESSAGE =
  "⭐ Disponível na versão Enterprise. Acesse: www.vrashows.com.br/vraxia";

export type DemoActiveModule  = typeof DEMO_ACTIVE_MODULES[number];
export type DemoPreviewModule = typeof DEMO_PREVIEW_MODULES[number];

export function isDemoPreview(moduleId: string): boolean {
  return (DEMO_PREVIEW_MODULES as readonly string[]).includes(moduleId);
}

export function isDemoActive(moduleId: string): boolean {
  return (DEMO_ACTIVE_MODULES as readonly string[]).includes(moduleId);
}
