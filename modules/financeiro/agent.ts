import { createDepartmentAgent } from "../_base/agent-factory.js";
import type { ModuleAgentOptions } from "../_base/agent-factory.js";

export const FinanceiroAgent = {
  create: (opts: ModuleAgentOptions = {}) => createDepartmentAgent("financeiro", opts),
};
