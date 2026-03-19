import { z } from "zod";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { slugify } from "../utils/slug.js";
import { renderTemplate, getTemplatePath } from "../utils/template.js";
import { normalizeWorkspacePath } from "../utils/workspace-match.js";
import { readRootMeta, wouldCreateCycle, validateDependencies } from "../utils/dag.js";
import {
  projectAlreadyExists,
  dependencyNotFound,
  cycleDetected,
  formatError,
} from "../utils/errors.js";
import { getDataDir } from "../utils/paths.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const InitProjectSchema = {
  name: z.string().describe("Human-readable project name"),
  description: z.string().describe("One-line project description"),
  repoUrl: z.string().optional().describe("Repository URL"),
  dependsOn: z
    .array(z.string())
    .optional()
    .describe("Array of project slugs this project depends on"),
  workspacePaths: z
    .array(z.string())
    .optional()
    .describe("Workspace directory paths where this project is checked out"),
};

export function registerInitProject(server: McpServer) {
  server.tool(
    "init_project",
    "Initialize a new project in the DAG. Creates project directory, renders all templates, and updates the root meta. If workspacePaths is omitted, defaults to the current working directory (process.cwd()) so the project is always resolvable by path.",
    InitProjectSchema,
    async (params) => {
      try {
        const slug = slugify(params.name);
        const dataDir = getDataDir();
        const projectDir = resolve(dataDir, "projects", slug);
        const metaPath = resolve(dataDir, "meta.json");
        const dependsOn = params.dependsOn ?? [];

        // Read current DAG
        const rootMeta = readRootMeta(dataDir);

        // Check for duplicates
        if (rootMeta.projects.some((p) => p.id === slug)) {
          return formatError(projectAlreadyExists(slug));
        }

        // Validate dependencies exist
        if (dependsOn.length > 0) {
          const missing = validateDependencies(rootMeta.projects, dependsOn);
          if (missing.length > 0) {
            return formatError(dependencyNotFound(missing));
          }

          // Check for cycles
          for (const dep of dependsOn) {
            if (wouldCreateCycle(rootMeta.projects, slug, dep)) {
              return formatError(cycleDetected(slug, dep));
            }
          }
        }

        // Create project directory
        mkdirSync(projectDir, { recursive: true });

        const now = new Date().toISOString();
        const repoUrl = params.repoUrl ?? "";
        const variables: Record<string, string> = {
          id: slug,
          name: params.name,
          description: params.description,
          repoUrl,
          status: "draft",
          createdAt: now,
          dependsOnList: dependsOn.length > 0 ? dependsOn.join(", ") : "—",
          statusBlock: `**Status:** draft\n`,
          repoBlock: repoUrl ? `**Repo:** ${repoUrl}\n` : "",
          upstreamBlock: dependsOn.length > 0
            ? dependsOn.map((d) => `- ${d}`).join("\n")
            : "- None",
        };

        // Render templates
        const templates = [
          { tmpl: "project-meta.json.tmpl", out: "meta.json" },
          { tmpl: "project.md.tmpl", out: "overview.md" },
          { tmpl: "task.md.tmpl", out: "tasks.md" },
          { tmpl: "dependency.md.tmpl", out: "dependencies.md" },
          { tmpl: "knowledge.md.tmpl", out: "knowledge.md" },
        ];

        for (const { tmpl, out } of templates) {
          const content = renderTemplate(
            getTemplatePath(tmpl),
            variables
          );
          writeFileSync(resolve(projectDir, out), content, "utf-8");
        }

        // Post-render: inject workspacePaths into meta.json
        // (array type not supported by {{var}} template engine)
        // If workspacePaths was not provided at all (undefined), fall back to
        // process.cwd() — the directory OpenCode (or any MCP client) was launched
        // from, which is the project root. An explicit empty array ([]) is respected
        // as-is so callers can intentionally register a path-less project.
        const rawWorkspacePaths =
          params.workspacePaths !== undefined
            ? params.workspacePaths
            : [process.cwd()];
        const normalizedPaths = rawWorkspacePaths.map(normalizeWorkspacePath);
        const metaJsonPath = resolve(projectDir, "meta.json");
        const metaObj = JSON.parse(readFileSync(metaJsonPath, "utf-8")) as Record<string, unknown>;
        metaObj.workspacePaths = normalizedPaths;
        writeFileSync(metaJsonPath, JSON.stringify(metaObj, null, 2), "utf-8");

        // Create empty plan and knowledge indexes
        mkdirSync(resolve(projectDir, "plans"), { recursive: true });
        mkdirSync(resolve(projectDir, "knowledge"), { recursive: true });
        writeFileSync(
          resolve(projectDir, "plans", "index.json"),
          JSON.stringify({ plans: [] }, null, 2),
          "utf-8"
        );
        writeFileSync(
          resolve(projectDir, "knowledge", "index.json"),
          JSON.stringify({ entries: [] }, null, 2),
          "utf-8"
        );

        // Update root meta
        rootMeta.projects.push({
          id: slug,
          name: params.name,
          status: "draft",
          dependsOn,
        });
        writeFileSync(metaPath, JSON.stringify(rootMeta, null, 2), "utf-8");

        return {
          content: [
            {
              type: "text" as const,
              text: `✅ Project "${params.name}" initialized at projects/${slug}/\n\nCreated files:\n- meta.json\n- overview.md\n- tasks.md\n- dependencies.md\n- knowledge.md\n- plans/index.json\n- knowledge/index.json`,
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
