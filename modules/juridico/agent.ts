import { createDepartmentAgent } from "../_base/agent-factory.js";
import type { ModuleAgentOptions } from "../_base/agent-factory.js";

export const JuridicoAgent = {
  create: (opts: ModuleAgentOptions = {}) => createDepartmentAgent("juridico", opts),
};
