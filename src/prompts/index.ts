import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCancelLoopPrompt, registerLoopPrompt } from "./loop.js";

/**
 * Registers MCP prompts.
 * Loop prompts are always registered for self-referential development loops.
 * Agent workflows are delivered via IDE-native agent configuration,
 * not as MCP slash commands.
 */
export function registerAllPrompts(server: McpServer): void {
  registerLoopPrompt(server);
  registerCancelLoopPrompt(server);
}
