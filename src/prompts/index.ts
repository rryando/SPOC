import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCcDagInitPrompt } from "./cc-dag-init.js";
import { registerCcDagBrainstormPrompt } from "./cc-dag-brainstorm.js";
import { registerCcDagExecutePrompt } from "./cc-dag-execute.js";
import { registerCcDagSyncPrompt } from "./cc-dag-sync.js";
import { readConfig, type AgentId } from "../cli/config.js";

type PromptRegistrar = (server: McpServer) => void;

const REGISTRARS: Record<AgentId, PromptRegistrar> = {
  "init-project": registerCcDagInitPrompt,
  brainstorm: registerCcDagBrainstormPrompt,
  execute: registerCcDagExecutePrompt,
  "sync-knowledge": registerCcDagSyncPrompt,
};

/**
 * Reads ~/.cc-dag/config.json and registers MCP prompts for enabled agents.
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
