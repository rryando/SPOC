import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatError, invalidDocType, projectNotFound } from "../utils/errors.js";
import { getProjectDir } from "../utils/paths.js";
import { PROJECT_DOC_FILES, type ProjectDocType } from "../utils/project-documents.js";
import { errorResult, toolError } from "../utils/tool-response.js";
import { requireWriteGate, WriteGateError } from "../utils/write-gate.js";

const VALID_DOCS = Object.keys(PROJECT_DOC_FILES) as [ProjectDocType, ...ProjectDocType[]];

export const UpdateDocSchema = {
  slug: z.string().describe("Project slug"),
  doc: z.enum(VALID_DOCS).describe("Document type to update"),
  content: z.string().describe("New document content (full replacement)"),
  dryRun: z.boolean().optional().default(false).describe("Return what would be written without writing to disk"),
  confirmationToken: z.string().optional().describe("Write-gate confirmation token"),
};

export function registerUpdateDoc(server: McpServer) {
  server.tool(
    "update_project_doc",
    "Update a project document. Reads the existing doc, replaces with new content.",
    UpdateDocSchema,
    async (params) => {
      try {
        requireWriteGate(params.confirmationToken, params.slug, "tool:update_project_doc");

        const projectDir = getProjectDir(params.slug);

        if (!existsSync(projectDir)) {
          return formatError(projectNotFound(params.slug));
        }

        const fileName = PROJECT_DOC_FILES[params.doc];
        if (!fileName) {
          return formatError(invalidDocType(params.doc));
        }

        const filePath = resolve(projectDir, fileName);

        if (params.dryRun) {
          const bytes = Buffer.byteLength(params.content, "utf-8");
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  dryRun: true,
                  wouldWrite: {
                    path: filePath,
                    bytes,
                    preview: params.content.slice(0, 200),
                  },
                }),
              },
            ],
          };
        }

        await writeFile(filePath, params.content, "utf-8");

        return {
          content: [
            {
              type: "text" as const,
              text: `✅ Updated ${params.doc} for project "${params.slug}".`,
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
