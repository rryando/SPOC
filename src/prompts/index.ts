import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSpocInitPrompt } from "./spoc-init.js";
import { registerSpocBrainstormPrompt } from "./spoc-brainstorm.js";
import { registerSpocExecutePrompt } from "./spoc-execute.js";
import { registerSpocSyncPrompt } from "./spoc-sync.js";
import { registerSpocOrchestratePrompt } from "./spoc-orchestrate.js";
import { readConfig, type AgentId } from "../cli/config.js";

type PromptRegistrar = (server: McpServer) => void;

const REGISTRARS: Record<AgentId, PromptRegistrar> = {
  orchestrate: registerSpocOrchestratePrompt,
  "init-project": registerSpocInitPrompt,
  brainstorm: registerSpocBrainstormPrompt,
  execute: registerSpocExecutePrompt,
  "sync-knowledge": registerSpocSyncPrompt,
};

/**
 * Reads ~/.spoc/config.json and registers MCP prompts for enabled agents.
 * If no config exists, all agents are registered by default.
 */
export function registerAllPrompts(server: McpServer): void {
  const config = readConfig();

  for (const [id, register] of Object.entries(REGISTRARS)) {
    if (config.agents[id as AgentId].enabled) {
      register(server);
    }
  }
}
