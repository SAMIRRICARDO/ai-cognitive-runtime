import { readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { BaseAgent } from "../_base/agent.js";
import { vaultSearchTool } from "../../tools/vault-search.js";
import { memoryReadTool, memoryWriteTool } from "../../tools/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export class VaultAgent extends BaseAgent {
  constructor() {
    super({
      name: "vault",
      description: "Retrieves and synthesizes knowledge from the Obsidian vault",
      systemPrompt: "",
      model: "auto",
      enableResponseCache: false, // vault queries need freshness
      contextTokenLimit: 60_000,
    });
  }

  static async create(): Promise<VaultAgent> {
    const agent = new VaultAgent();
    const promptPath = join(__dirname, "../../prompts/agents/vault.md");
    agent.config.systemPrompt = await readFile(promptPath, "utf8");
    agent.registerTool(vaultSearchTool);
    agent.registerTool(memoryReadTool);
    agent.registerTool(memoryWriteTool);
    return agent;
  }
}
