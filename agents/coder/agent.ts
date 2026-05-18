import { readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { BaseAgent } from "../_base/agent.js";
import { codeExecTool, memoryReadTool, memoryWriteTool } from "../../tools/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadPrompt(): Promise<string> {
  const path = join(__dirname, "../../prompts/agents/coder.md");
  return readFile(path, "utf8");
}

export class CoderAgent extends BaseAgent {
  constructor() {
    super({
      name: "coder",
      description: "Writes, reviews, and executes code to solve programming tasks",
      systemPrompt: "",
    });
  }

  static async create(): Promise<CoderAgent> {
    const agent = new CoderAgent();
    agent.config.systemPrompt = await loadPrompt();
    agent.registerTool(codeExecTool);
    agent.registerTool(memoryReadTool);
    agent.registerTool(memoryWriteTool);
    return agent;
  }
}
