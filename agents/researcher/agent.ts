import { readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { BaseAgent } from "../_base/agent.js";
import { webSearchTool, memoryReadTool, memoryWriteTool } from "../../tools/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadPrompt(): Promise<string> {
  const path = join(__dirname, "../../prompts/agents/researcher.md");
  return readFile(path, "utf8");
}

export class ResearcherAgent extends BaseAgent {
  constructor() {
    super({
      name: "researcher",
      description: "Researches topics using web search and stores findings in memory",
      systemPrompt: "", // loaded async — see create()
    });
  }

  static async create(): Promise<ResearcherAgent> {
    const agent = new ResearcherAgent();
    agent.config.systemPrompt = await loadPrompt();
    agent.registerTool(webSearchTool);
    agent.registerTool(memoryReadTool);
    agent.registerTool(memoryWriteTool);
    return agent;
  }
}
