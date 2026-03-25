import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readRootMeta, writeRootMeta } from "../utils/dag.js";
import { formatError, projectNotFound } from "../utils/errors.js";
import { getDataDir } from "../utils/paths.js";

export function registerDeleteProject(server: McpServer) {
  server.tool(
    "delete_project",
    "Delete a project from the DAG. Removes the project directory, its entry in root meta, and any dependency edges pointing to it from other projects. This action is irreversible.",
    {
      slug: z.string().describe("Project slug to delete"),
    },
    async (params) => {
      try {
        const dataDir = getDataDir();
        const rootMeta = await readRootMeta(dataDir);

        const projectIdx = rootMeta.projects.findIndex((p) => p.id === params.slug);
        if (projectIdx === -1) {
          return formatError(projectNotFound(params.slug));
        }

        // Remove project directory
        const projectDir = resolve(dataDir, "projects", params.slug);
        await rm(projectDir, { recursive: true, force: true });

        // Remove from root meta
        rootMeta.projects.splice(projectIdx, 1);

        // Remove dependency edges pointing to this project
        for (const p of rootMeta.projects) {
          p.dependsOn = p.dependsOn.filter((dep) => dep !== params.slug);
        }

        await writeRootMeta(dataDir, rootMeta);

        return {
          content: [
            {
              type: "text" as const,
              text: `✅ Deleted project "${params.slug}" and removed all dependency edges pointing to it.`,
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
