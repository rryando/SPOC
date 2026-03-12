import { z } from "zod";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { getDataDir } from "../utils/paths.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const DOC_FILES: Record<string, string> = {
  overview: "overview.md",
  tasks: "tasks.md",
  dependencies: "dependencies.md",
  knowledge: "knowledge.md",
};

export function registerGetProject(server: McpServer) {
  server.tool(
    "get_project",
    "Get a project's metadata and optionally its documents. Returns the project meta.json by default. Use the `doc` parameter to fetch a specific document (overview, tasks, dependencies, knowledge).",
    {
      slug: z.string().describe("Project slug (e.g. my-project)"),
      doc: z
        .enum(["overview", "tasks", "dependencies", "knowledge"])
        .optional()
        .describe(
          "Optional: fetch a specific document instead of the project metadata"
        ),
    },
    async (params) => {
      try {
        const dataDir = getDataDir();
        const projectDir = resolve(dataDir, "projects", params.slug);

        if (params.doc) {
          const fileName = DOC_FILES[params.doc];
          const filePath = resolve(projectDir, fileName);

          if (!existsSync(filePath)) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Error: Document "${params.doc}" not found for project "${params.slug}".`,
                },
              ],
              isError: true,
            };
          }

          const content = readFileSync(filePath, "utf-8");
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
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: Project "${params.slug}" not found.`,
              },
            ],
            isError: true,
          };
        }

        const content = readFileSync(metaPath, "utf-8");
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
    }
  );
}
