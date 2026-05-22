#!/usr/bin/env node
import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { handleCli } from "./cli/index.js";
import { registerAllPrompts } from "./prompts/index.js";
import { registerProjectResources } from "./resources/projects.js";
import { registerSkillResources } from "./resources/skills.js";
import { registerAuditKnowledge } from "./tools/audit-knowledge.js";
import { registerDeployOpencodeSuperpowers } from "./tools/deploy-opencode-superpowers.js";
import { registerDiagramPreview } from "./tools/diagram-preview.js";
import { registerLintBundle } from "./tools/lint-bundle.js";
import { registerDeleteProject } from "./tools/delete-project.js";
import { registerProjectDiff } from "./tools/project-diff.js";
import { registerGetProject } from "./tools/get-project.js";
import { registerProjectLoopTools } from "./tools/project-loop.js";
import { registerInitProject } from "./tools/init-project.js";
import { registerListProjects } from "./tools/list-projects.js";
import { registerManageDependency } from "./tools/manage-dependency.js";
import { registerProjectKnowledgeTools } from "./tools/project-knowledge.js";
import { registerProjectPlanTools } from "./tools/project-plans.js";
import { registerProjectTaskTools } from "./tools/project-tasks.js";
import { registerResolveContext } from "./tools/resolve-context.js";
import { registerSearchKnowledge } from "./tools/search-knowledge.js";
import { registerSyncAgentsMd } from "./tools/sync-agents-md.js";
import { registerTransitionProjectTask } from "./tools/transition-task.js";
import { registerUpdateDoc } from "./tools/update-doc.js";
import { registerUpdatePaths } from "./tools/update-paths.js";
import { registerUpdateStatus } from "./tools/update-status.js";
import { registerValidateProjectState } from "./tools/validate-project-state.js";
import { registerWriteGateTools } from "./tools/write-gate.js";
import { ensureDataDir, getDataDir, PACKAGE_ROOT } from "./utils/paths.js";
import { readJsonSafeSync, validateJson } from "./utils/json.js";
import { packageJsonSchema } from "./utils/json-schemas.js";

// ---------------------------------------------------------------------------
// CLI subcommand routing: `spoc init` / `spoc config`
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
  const pkgPath = resolve(PACKAGE_ROOT, "package.json");
  const pkgRaw = readJsonSafeSync<unknown>(pkgPath);
  if (pkgRaw === undefined) {
    console.error(`Failed to read ${pkgPath}`);
    process.exit(1);
  }
  const pkg = validateJson(pkgRaw, packageJsonSchema, pkgPath);
  const server = new McpServer({
    name: "spoc",
    version: pkg.version,
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
  registerAuditKnowledge(server);
  registerSearchKnowledge(server);
  registerProjectTaskTools(server);
  registerUpdatePaths(server);
  registerResolveContext(server);
  registerSyncAgentsMd(server);
  registerDeleteProject(server);
  registerProjectDiff(server);
  registerProjectLoopTools(server);
  registerWriteGateTools(server);
  registerValidateProjectState(server);
  registerTransitionProjectTask(server);
  registerLintBundle(server);
  registerDeployOpencodeSuperpowers(server);
  registerDiagramPreview(server);

  // Register resources
  registerProjectResources(server);
  registerSkillResources(server);

  // Register prompts (slash commands) — conditionally based on config
  registerAllPrompts(server);

  // Connect via stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`SPOC MCP server running on stdio (data: ${getDataDir()})`);
}

run().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
