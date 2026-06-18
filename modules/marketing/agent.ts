import { createDepartmentAgent } from "../_base/agent-factory.js";
import type { ModuleAgentOptions } from "../_base/agent-factory.js";

export const MarketingAgent = {
  create: (opts: ModuleAgentOptions = {}) => createDepartmentAgent("marketing", opts),
};
