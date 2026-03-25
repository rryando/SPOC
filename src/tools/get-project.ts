import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatError, invalidDocType, projectNotFound } from "../utils/errors.js";
import { getProjectDir } from "../utils/paths.js";
import { PROJECT_DOC_FILES } from "../utils/project-documents.js";

export function registerGetProject(server: McpServer) {
  server.tool(
    "get_project",
    "Get a project's metadata and optionally its documents. Returns the project meta.json by default. Use the `doc` parameter to fetch a specific document (overview, tasks, dependencies, knowledge).",
    {
      slug: z.string().describe("Project slug (e.g. my-project)"),
      doc: z
        .enum(["overview", "tasks", "dependencies", "knowledge"])
        .optional()
        .describe("Optional: fetch a specific document instead of the project metadata"),
    },
    async (params) => {
      try {
        const projectDir = getProjectDir(params.slug);

        if (params.doc) {
          const fileName = PROJECT_DOC_FILES[params.doc];
          if (!fileName) {
            return formatError(invalidDocType(params.doc));
          }
          const filePath = resolve(projectDir, fileName);

          if (!existsSync(filePath)) {
            return formatError(invalidDocType(params.doc));
          }

          const content = await readFile(filePath, "utf-8");
          return {
            content: [
              {
                type: "text" as const,
                text: content,
              },
            ],
          };
        }

        // Default: return project meta
        const metaPath = resolve(projectDir, "meta.json");

        if (!existsSync(metaPath)) {
          return formatError(projectNotFound(params.slug));
        }

        const content = await readFile(metaPath, "utf-8");
        return {
          content: [
            {
              type: "text" as const,
              text: content,
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
