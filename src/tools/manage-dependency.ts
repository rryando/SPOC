import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readRootMeta, wouldCreateCycle, writeRootMeta } from "../utils/dag.js";
import { cycleDetected, formatError, projectNotFound } from "../utils/errors.js";
import { getDataDir } from "../utils/paths.js";

export const ManageDependencySchema = {
  slug: z.string().describe("Project slug"),
  action: z.enum(["add", "remove"]).describe("Add or remove dependency"),
  targetSlug: z.string().describe("Target project slug to add/remove as dependency"),
};

export function registerManageDependency(server: McpServer) {
  server.tool(
    "manage_dependency",
    "Add or remove a dependency edge in the DAG. Validates against cycles when adding.",
    ManageDependencySchema,
    async (params) => {
      try {
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
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Dependency "${params.slug}" → "${params.targetSlug}" already exists.`,
                },
              ],
            };
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
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Dependency "${params.slug}" → "${params.targetSlug}" does not exist.`,
                },
              ],
            };
          }
          project.dependsOn.splice(idx, 1);
        }

        await writeRootMeta(dataDir, rootMeta);

        const verb = params.action === "add" ? "Added" : "Removed";
        return {
          content: [
            {
              type: "text" as const,
              text: `✅ ${verb} dependency: "${params.slug}" → "${params.targetSlug}"`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
