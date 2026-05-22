import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readRootMeta, writeRootMeta } from "../utils/dag.js";
import { formatError, projectNotFound } from "../utils/errors.js";
import { getDataDir } from "../utils/paths.js";
import { errorResult, toolError } from "../utils/tool-response.js";
import { requireWriteGate, WriteGateError } from "../utils/write-gate.js";

const VALID_STATUSES = ["draft", "active", "completed", "archived"] as const;

export const UpdateStatusSchema = {
  slug: z.string().describe("Project slug"),
  status: z.enum(VALID_STATUSES).describe("New project status"),
  confirmationToken: z.string().optional().describe("Write-gate confirmation token"),
};

export function registerUpdateStatus(server: McpServer) {
  server.tool(
    "update_project_status",
    "Update a project's status in the root DAG meta.",
    UpdateStatusSchema,
    async (params) => {
      try {
        requireWriteGate(params.confirmationToken, params.slug, "tool:update_project_status");

        const dataDir = getDataDir();
        const rootMeta = await readRootMeta(dataDir);

        const project = rootMeta.projects.find((p) => p.id === params.slug);
        if (!project) {
          return formatError(projectNotFound(params.slug));
        }

        const oldStatus = project.status;
        project.status = params.status;
        await writeRootMeta(dataDir, rootMeta);

        return {
          content: [
            {
              type: "text" as const,
              text: `✅ Project "${params.slug}" status: ${oldStatus} → ${params.status}`,
            },
          ],
        };
      } catch (err) {
        if (err instanceof WriteGateError) return toolError("WRITE_GATE", err.message);
        return errorResult(err);
      }
    },
  );
}
