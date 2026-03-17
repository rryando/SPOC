#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { handleCli } from "./cli/index.js";
import { registerInitProject } from "./tools/init-project.js";
import { registerUpdateDoc } from "./tools/update-doc.js";
import { registerUpdateStatus } from "./tools/update-status.js";
import { registerManageDependency } from "./tools/manage-dependency.js";
import { registerListProjects } from "./tools/list-projects.js";
import { registerGetProject } from "./tools/get-project.js";
import { registerProjectPlanTools } from "./tools/project-plans.js";
import { registerProjectKnowledgeTools } from "./tools/project-knowledge.js";
import { registerUpdatePaths } from "./tools/update-paths.js";
import { registerResolveContext } from "./tools/resolve-context.js";
import { registerProjectResources } from "./resources/projects.js";
import { registerSkillResources } from "./resources/skills.js";
import { registerAllPrompts } from "./prompts/index.js";
import { ensureDataDir, getDataDir } from "./utils/paths.js";

// ---------------------------------------------------------------------------
// CLI subcommand routing: `npx cc-dag init` / `npx cc-dag config`
// If a subcommand is handled, exit. Otherwise, start the MCP server.
// ---------------------------------------------------------------------------

async function run(): Promise<void> {
  const args = process.argv.slice(2);

  // Handle CLI subcommands (init, config)
  if (args.length > 0) {
    const handled = await handleCli(args);
    if (handled) return;
    // Unknown subcommand — fall through to MCP server
  }

  // Bootstrap data directory
  try {
    ensureDataDir();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  // Create MCP server
  const server = new McpServer({
    name: "cc-dag",
    version: "1.0.0",
  });

  // Register tools
  registerInitProject(server);
  registerUpdateDoc(server);
  registerUpdateStatus(server);
  registerManageDependency(server);
  registerListProjects(server);
  registerGetProject(server);
  registerProjectPlanTools(server);
  registerProjectKnowledgeTools(server);
  registerUpdatePaths(server);
  registerResolveContext(server);

  // Register resources
  registerProjectResources(server);
  registerSkillResources(server);

  // Register prompts (slash commands) — conditionally based on config
  registerAllPrompts(server);

  // Connect via stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`cc-dag MCP server running on stdio (data: ${getDataDir()})`);
}

run().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
