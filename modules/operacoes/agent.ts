import { createDepartmentAgent } from "../_base/agent-factory.js";
import type { ModuleAgentOptions } from "../_base/agent-factory.js";

export const OperacoesAgent = {
  create: (opts: ModuleAgentOptions = {}) => createDepartmentAgent("operacoes", opts),
};
