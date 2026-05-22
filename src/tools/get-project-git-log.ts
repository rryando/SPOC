import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getProjectDir } from "../utils/paths.js";
import { isGitRepo, getGitLog } from "../utils/git.js";
import { errorResult } from "../utils/tool-response.js";
import { formatError, projectNotFound } from "../utils/errors.js";

export function registerGetProjectGitLog(server: McpServer) {
  server.tool(
    "get_project_git_log",
    "Get git commit history for a tracked project. Returns structured commit data including SHA, message, date, and files changed.",
    {
      slug: z.string().describe("Project slug"),
      since: z
        .string()
        .optional()
        .describe("ISO timestamp or commit SHA to filter from"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(200)
        .default(20)
        .describe("Max commits to return (default: 20)"),
    },
    async (params) => {
      try {
        const projectDir = getProjectDir(params.slug);
        const metaPath = resolve(projectDir, "meta.json");

        if (!existsSync(metaPath)) {
          return formatError(projectNotFound(params.slug));
        }

        const meta = JSON.parse(await readFile(metaPath, "utf-8"));
        const workspacePaths: string[] = meta.workspacePaths ?? [];

        if (workspacePaths.length === 0) {
          return errorResult(
            new Error(`Project "${params.slug}" has no workspace paths configured`),
          );
        }

        const cwd = workspacePaths[0];

        if (!isGitRepo(cwd)) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  { commits: [], info: "Workspace path is not a git repository" },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        const commits = getGitLog(cwd, {
          since: params.since,
          limit: params.limit,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(commits, null, 2),
            },
          ],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
