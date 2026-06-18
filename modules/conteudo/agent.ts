import { createDepartmentAgent } from "../_base/agent-factory.js";
import type { ModuleAgentOptions } from "../_base/agent-factory.js";

export const ConteudoAgent = {
  create: (opts: ModuleAgentOptions = {}) => createDepartmentAgent("conteudo", opts),
};
