import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DagError, formatError, projectNotFound } from "../utils/errors.js";
import { readJsonSafe, validateJson } from "../utils/json.js";
import { projectMetaSchema } from "../utils/json-schemas.js";
import { getProjectDir } from "../utils/paths.js";
import { readKnowledgeIndex } from "../utils/project-memory.js";
import { errorResult, jsonResult } from "../utils/tool-response.js";

export function registerAuditKnowledge(server: McpServer) {
  server.tool(
    "audit_project_knowledge",
    "Audit knowledge entries for stale sourceFile references. Checks whether referenced paths exist on disk relative to the project's registered workspacePaths.",
    {
      slug: z.string().describe("Project slug"),
    },
    async (params) => {
      try {
        const projectDir = getProjectDir(params.slug);
        if (!existsSync(projectDir)) {
          return formatError(projectNotFound(params.slug));
        }

        // Read project meta to get workspacePaths
        const metaPath = resolve(projectDir, "meta.json");
        const rawMeta = await readJsonSafe<unknown>(metaPath);
        if (rawMeta === undefined) {
          return errorResult(new Error(`Failed to read project meta at ${metaPath}`));
        }
        const projectMeta = validateJson(rawMeta, projectMetaSchema, metaPath);
        const workspacePaths = projectMeta.workspacePaths ?? [];

        // Read all knowledge entries
        const index = await readKnowledgeIndex(projectDir);
        const entries = index.entries;

        let totalSourceFiles = 0;
        let staleCount = 0;
        const staleEntries: {
          entryId: string;
          entryTitle: string;
          staleFiles: { path: string; anchor?: string }[];
        }[] = [];

        for (const entry of entries) {
          const sourceFiles = entry.sourceFiles ?? [];
          const staleFiles: { path: string; anchor?: string }[] = [];

          for (const ref of sourceFiles) {
            totalSourceFiles++;
            const found = workspacePaths.some((ws) => existsSync(resolve(ws, ref.path)));
            if (!found) {
              staleCount++;
              const stale: { path: string; anchor?: string } = { path: ref.path };
              if (ref.anchor) stale.anchor = ref.anchor;
              staleFiles.push(stale);
            }
          }

          if (staleFiles.length > 0) {
            staleEntries.push({
              entryId: entry.id,
              entryTitle: entry.title,
              staleFiles,
            });
          }
        }

        return jsonResult({
          staleEntries,
          counts: {
            totalEntries: entries.length,
            totalSourceFiles,
            staleCount,
          },
        });
      } catch (err) {
        if (err instanceof DagError) return formatError(err);
        return errorResult(err);
      }
    },
  );
}
