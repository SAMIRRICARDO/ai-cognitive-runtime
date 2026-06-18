import { createDepartmentAgent } from "../_base/agent-factory.js";
import type { ModuleAgentOptions } from "../_base/agent-factory.js";

export const CodigoAgent = {
  create: (opts: ModuleAgentOptions = {}) => createDepartmentAgent("codigo", opts),
};
