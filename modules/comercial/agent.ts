import { createDepartmentAgent } from "../_base/agent-factory.js";
import type { ModuleAgentOptions } from "../_base/agent-factory.js";

export const ComercialAgent = {
  create: (opts: ModuleAgentOptions = {}) => createDepartmentAgent("comercial", opts),
};
