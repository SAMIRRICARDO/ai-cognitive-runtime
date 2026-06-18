import { createDepartmentAgent } from "../_base/agent-factory.js";
import type { ModuleAgentOptions } from "../_base/agent-factory.js";

export const LiderancaAgent = {
  create: (opts: ModuleAgentOptions = {}) => createDepartmentAgent("lideranca", opts),
};
