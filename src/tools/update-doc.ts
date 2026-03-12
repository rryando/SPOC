import { z } from "zod";
import { writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { projectNotFound, invalidDocType, formatError } from "../utils/errors.js";
import { getDataDir } from "../utils/paths.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const VALID_DOCS = ["overview", "tasks", "dependencies", "knowledge"] as const;
const DOC_FILES: Record<string, string> = {
  overview: "overview.md",
  tasks: "tasks.md",
  dependencies: "dependencies.md",
  knowledge: "knowledge.md",
};

export const UpdateDocSchema = {
  slug: z.string().describe("Project slug"),
  doc: z.enum(VALID_DOCS).describe("Document type to update"),
  content: z.string().describe("New document content (full replacement)"),
};

export function registerUpdateDoc(server: McpServer) {
  server.tool(
    "update_project_doc",
    "Update a project document. Reads the existing doc, replaces with new content.",
    UpdateDocSchema,
    async (params) => {
      try {
        const projectDir = resolve(getDataDir(), "projects", params.slug);

        if (!existsSync(projectDir)) {
          return formatError(projectNotFound(params.slug));
        }

        const fileName = DOC_FILES[params.doc];
        if (!fileName) {
          return formatError(invalidDocType(params.doc));
        }

        const filePath = resolve(projectDir, fileName);
        writeFileSync(filePath, params.content, "utf-8");

        return {
          content: [
            {
              type: "text" as const,
              text: `✅ Updated ${params.doc} for project "${params.slug}".`,
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
