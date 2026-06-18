import { createDepartmentAgent } from "./_base/agent-factory.js";
import type { ModuleAgentOptions } from "./_base/agent-factory.js";

export { FinanceiroAgent } from "./financeiro/agent.js";
export { JuridicoAgent }   from "./juridico/agent.js";
export { MarketingAgent }  from "./marketing/agent.js";
export { OperacoesAgent }  from "./operacoes/agent.js";
export { ConteudoAgent }   from "./conteudo/agent.js";
export { LiderancaAgent }  from "./lideranca/agent.js";
export { ProdutoAgent }    from "./produto/agent.js";
export { CodigoAgent }     from "./codigo/agent.js";
export { ComercialAgent }  from "./comercial/agent.js";

export { createDepartmentAgent } from "./_base/agent-factory.js";
export type { ModuleAgentOptions } from "./_base/agent-factory.js";

// All available module IDs
export const AVAILABLE_MODULES = [
  "comercial",
  "financeiro",
  "juridico",
  "marketing",
  "operacoes",
  "conteudo",
  "lideranca",
  "produto",
  "codigo",
] as const;

export type ModuleId = typeof AVAILABLE_MODULES[number];

export function createModule(id: ModuleId, opts: ModuleAgentOptions = {}) {
  return createDepartmentAgent(id, opts);
}
