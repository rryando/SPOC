import { z } from "zod";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { getDataDir } from "../utils/paths.js";
import { readRootMeta } from "../utils/dag.js";
import {
  findBestMatch,
  type WorkspaceProject,
} from "../utils/workspace-match.js";
import { readPlanIndex, readKnowledgeIndex } from "../utils/project-memory.js";
import {
  noProjectMatch,
  ambiguousProjectMatch,
  invalidWorkspacePath,
  formatError,
} from "../utils/errors.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// ---------------------------------------------------------------------------
// Content assembly helpers
// ---------------------------------------------------------------------------

/**
 * Check if overview content is still the default template (no real content).
 * Template has: `# Name\n\n> Description\n\n...## Summary\n\n## Goals\n\n## Current Focus`
 * If all subsections beneath the headers are empty, it's default.
 *
 * NOTE: This parser is coupled to the template format in project.md.tmpl.
 * If the template changes, this function may need updating.
 */
function extractOverviewContent(raw: string): string | null {
  const lines = raw.split("\n");
  let startIdx = 0;

  // Skip leading H1
  if (lines[startIdx]?.startsWith("# ")) startIdx++;
  // Skip blank lines after H1
  while (startIdx < lines.length && lines[startIdx]?.trim() === "") startIdx++;
  // Skip blockquote
  if (lines[startIdx]?.startsWith("> ")) startIdx++;
  // Skip blank lines after blockquote
  while (startIdx < lines.length && lines[startIdx]?.trim() === "") startIdx++;
  // Skip status/repo blocks
  while (
    startIdx < lines.length &&
    (lines[startIdx]?.startsWith("**Status:**") ||
      lines[startIdx]?.startsWith("**Repo:**") ||
      lines[startIdx]?.trim() === "")
  ) {
    startIdx++;
  }

  const remaining = lines.slice(startIdx).join("\n").trim();

  // Check if it's just empty section headers with no content beneath them
  const withoutHeaders = remaining
    .replace(/^##\s+.+$/gm, "")
    .trim();

  if (withoutHeaders === "") return null;
  return remaining;
}

/**
 * Extract in-progress task lines (matching `- [/]` pattern).
 */
function extractInProgressTasks(raw: string): string | null {
  const lines = raw.split("\n").filter((line) => /^- \[\/\]/.test(line.trim()));
  return lines.length > 0 ? lines.join("\n") : null;
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerResolveContext(server: McpServer) {
  server.tool(
    "resolve_project_context",
    "Resolve project context from a workspace directory path. Matches the path against registered workspace paths and returns assembled project context (overview, active tasks, knowledge, plans).",
    {
      workspacePath: z
        .string()
        .describe("Absolute path to the workspace directory"),
    },
    async (params) => {
      try {
        const queryPath = params.workspacePath;

        // Validate absolute path
        if (!queryPath.startsWith("/")) {
          return formatError(invalidWorkspacePath(queryPath));
        }

        const dataDir = getDataDir();
        const rootMeta = readRootMeta(dataDir);

        // Build workspace project list by reading each project's meta.json
        const workspaceProjects: WorkspaceProject[] = [];
        const projectMetas = new Map<
          string,
          Record<string, unknown>
        >();

        for (const node of rootMeta.projects) {
          const metaPath = resolve(
            dataDir,
            "projects",
            node.id,
            "meta.json"
          );
          if (!existsSync(metaPath)) continue;

          const meta = JSON.parse(
            readFileSync(metaPath, "utf-8")
          ) as Record<string, unknown>;
          const paths = Array.isArray(meta.workspacePaths)
            ? (meta.workspacePaths as string[])
            : [];

          if (paths.length > 0) {
            workspaceProjects.push({ slug: node.id, workspacePaths: paths });
            projectMetas.set(node.id, meta);
          }
        }

        // Find best match — returns discriminated union
        const matchResult = findBestMatch(queryPath, workspaceProjects);

        switch (matchResult.kind) {
          case "none":
            return formatError(noProjectMatch(queryPath));
          case "ambiguous":
            return formatError(
              ambiguousProjectMatch(queryPath, matchResult.slugs)
            );
          case "match":
            // Continue with assembly below
            break;
        }

        const slug = matchResult.slug;
        const projectDir = resolve(dataDir, "projects", slug);
        const meta = projectMetas.get(slug) ?? {};

        const name = (meta.name as string) ?? slug;
        const description = (meta.description as string) ?? "";

        // --- Assemble sections ---
        const sections: string[] = [];

        // Header
        sections.push(`# Project Context: ${name}`);
        if (description) {
          sections.push(`\n> ${description}`);
        }

        // Overview
        const overviewPath = resolve(projectDir, "overview.md");
        if (existsSync(overviewPath)) {
          const overviewRaw = readFileSync(overviewPath, "utf-8");
          const overviewContent = extractOverviewContent(overviewRaw);
          if (overviewContent) {
            sections.push(`\n## Overview\n\n${overviewContent}`);
          }
        }

        // Current Focus (in-progress tasks)
        const tasksPath = resolve(projectDir, "tasks.md");
        if (existsSync(tasksPath)) {
          const tasksRaw = readFileSync(tasksPath, "utf-8");
          const inProgress = extractInProgressTasks(tasksRaw);
          if (inProgress) {
            sections.push(`\n## Current Focus\n\n${inProgress}`);
          }
        }

        // Key Knowledge (last 10 entries by updatedAt)
        const knowledgeIndex = readKnowledgeIndex(projectDir);
        if (knowledgeIndex.entries.length > 0) {
          const sorted = [...knowledgeIndex.entries].sort(
            (a, b) =>
              new Date(b.updatedAt).getTime() -
              new Date(a.updatedAt).getTime()
          );
          const top = sorted.slice(0, 10); // Intentionally hardcoded limit for v1
          const bullets = top
            .map((e) => {
              const summary = e.summary ? `: ${e.summary}` : "";
              return `- **${e.title}**${summary}`;
            })
            .join("\n");
          sections.push(`\n## Key Knowledge\n\n${bullets}`);
        }

        // Active Plans (in_progress or planned)
        const planIndex = readPlanIndex(projectDir);
        const activePlans = planIndex.plans.filter(
          (p) => p.status === "in_progress" || p.status === "planned"
        );
        if (activePlans.length > 0) {
          const bullets = activePlans
            .map((p) => {
              const summary = p.summary ? `: ${p.summary}` : "";
              return `- **${p.title}** (${p.status})${summary}`;
            })
            .join("\n");
          sections.push(`\n## Active Plans\n\n${bullets}`);
        }

        return {
          content: [
            {
              type: "text" as const,
              text: sections.join("\n"),
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
