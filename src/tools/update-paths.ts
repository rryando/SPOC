import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatError, invalidWorkspacePath, projectNotFound } from "../utils/errors.js";
import { getProjectDir } from "../utils/paths.js";
import type { ProjectMeta } from "../utils/project-documents.js";
import { normalizeWorkspacePath } from "../utils/workspace-match.js";

export function registerUpdatePaths(server: McpServer) {
  server.tool(
    "update_project_paths",
    "Add, remove, or set workspace directory paths for a project. Used to map local directories to SPOC projects for context resolution.",
    {
      slug: z.string().describe("Project slug"),
      action: z
        .enum(["add", "remove", "set"])
        .describe('How to modify paths: "add", "remove", or "set"'),
      paths: z.array(z.string()).describe("Absolute directory paths to add/remove/set"),
    },
    async (params) => {
      try {
        const projectDir = getProjectDir(params.slug);
        const metaPath = resolve(projectDir, "meta.json");

        if (!existsSync(metaPath)) {
          return formatError(projectNotFound(params.slug));
        }

        // Validate all paths are absolute
        for (const p of params.paths) {
          if (!p.startsWith("/")) {
            return formatError(invalidWorkspacePath(p));
          }
        }

        // Normalize incoming paths
        const normalized = params.paths.map(normalizeWorkspacePath);

        // Read current meta
        const meta = JSON.parse(await readFile(metaPath, "utf-8")) as ProjectMeta;
        const current: string[] = Array.isArray(meta.workspacePaths) ? meta.workspacePaths : [];

        let updated: string[];

        switch (params.action) {
          case "add": {
            const existing = new Set(current);
            updated = [...current, ...normalized.filter((p) => !existing.has(p))];
            break;
          }
          case "remove": {
            const toRemove = new Set(normalized);
            updated = current.filter((p) => !toRemove.has(normalizeWorkspacePath(p)));
            break;
          }
          case "set": {
            updated = [...new Set(normalized)];
            break;
          }
        }

        meta.workspacePaths = updated;
        await writeFile(metaPath, JSON.stringify(meta, null, 2), "utf-8");

        return {
          content: [
            {
              type: "text" as const,
              text: `✅ Workspace paths for "${params.slug}" updated (${params.action}).\n\nCurrent paths:\n${
                updated.length > 0 ? updated.map((p) => `- ${p}`).join("\n") : "- (none)"
              }`,
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
