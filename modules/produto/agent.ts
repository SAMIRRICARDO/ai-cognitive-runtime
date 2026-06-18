import { createDepartmentAgent } from "../_base/agent-factory.js";
import type { ModuleAgentOptions } from "../_base/agent-factory.js";

export const ProdutoAgent = {
  create: (opts: ModuleAgentOptions = {}) => createDepartmentAgent("produto", opts),
};
