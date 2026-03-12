import { z } from "zod";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { readRootMeta } from "../utils/dag.js";
import { projectNotFound, formatError } from "../utils/errors.js";
import { getDataDir } from "../utils/paths.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const VALID_STATUSES = ["draft", "active", "completed", "archived"] as const;

export const UpdateStatusSchema = {
  slug: z.string().describe("Project slug"),
  status: z.enum(VALID_STATUSES).describe("New project status"),
};

export function registerUpdateStatus(server: McpServer) {
  server.tool(
    "update_project_status",
    "Update a project's status in the root DAG meta.",
    UpdateStatusSchema,
    async (params) => {
      try {
        const dataDir = getDataDir();
        const metaPath = resolve(dataDir, "meta.json");
        const rootMeta = readRootMeta(dataDir);

        const project = rootMeta.projects.find((p) => p.id === params.slug);
        if (!project) {
          return formatError(projectNotFound(params.slug));
        }

        const oldStatus = project.status;
        project.status = params.status;
        writeFileSync(metaPath, JSON.stringify(rootMeta, null, 2), "utf-8");

        return {
          content: [
            {
              type: "text" as const,
              text: `✅ Project "${params.slug}" status: ${oldStatus} → ${params.status}`,
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
    }
  );
}
