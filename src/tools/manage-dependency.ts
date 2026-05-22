import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readRootMeta, wouldCreateCycle, writeRootMeta } from "../utils/dag.js";
import { DagError, cycleDetected, formatError, projectNotFound } from "../utils/errors.js";
import { getDataDir } from "../utils/paths.js";
import { errorResult, jsonResult, toolError } from "../utils/tool-response.js";
import { requireWriteGate, WriteGateError } from "../utils/write-gate.js";

export const ManageDependencySchema = {
  slug: z.string().describe("Project slug"),
  action: z.enum(["add", "remove"]).describe("Add or remove dependency"),
  targetSlug: z.string().describe("Target project slug to add/remove as dependency"),
  confirmationToken: z.string().optional().describe("Write-gate confirmation token"),
};

export function registerManageDependency(server: McpServer) {
  server.tool(
    "manage_dependency",
    "Add or remove a dependency edge in the DAG. Validates against cycles when adding.",
    ManageDependencySchema,
    async (params) => {
      try {
        requireWriteGate(params.confirmationToken, params.slug, "tool:manage_dependency");

        const dataDir = getDataDir();
        const rootMeta = await readRootMeta(dataDir);

        const project = rootMeta.projects.find((p) => p.id === params.slug);
        if (!project) {
          return formatError(projectNotFound(params.slug));
        }

        const target = rootMeta.projects.find((p) => p.id === params.targetSlug);
        if (!target) {
          return formatError(projectNotFound(params.targetSlug));
        }

        if (params.action === "add") {
          // Check if already exists
          if (project.dependsOn.includes(params.targetSlug)) {
            return jsonResult({ message: `Dependency "${params.slug}" → "${params.targetSlug}" already exists.` });
          }

          // Check for cycles
          if (wouldCreateCycle(rootMeta.projects, params.slug, params.targetSlug)) {
            return formatError(cycleDetected(params.slug, params.targetSlug));
          }

          project.dependsOn.push(params.targetSlug);
        } else {
          // Remove
          const idx = project.dependsOn.indexOf(params.targetSlug);
          if (idx === -1) {
            return jsonResult({ message: `Dependency "${params.slug}" → "${params.targetSlug}" does not exist.` });
          }
          project.dependsOn.splice(idx, 1);
        }

        await writeRootMeta(dataDir, rootMeta);

        const verb = params.action === "add" ? "Added" : "Removed";
        return jsonResult({ message: `✅ ${verb} dependency: "${params.slug}" → "${params.targetSlug}"` });
      } catch (err) {
        if (err instanceof WriteGateError) return toolError("WRITE_GATE", err.message);
        if (err instanceof DagError) return formatError(err);
        return errorResult(err);
      }
    },
  );
}
