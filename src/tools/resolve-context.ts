import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  extractBacklogTasks,
  extractInProgressTasks,
  extractOverviewContent,
} from "../utils/content-assembly.js";
import { readRootMeta } from "../utils/dag.js";
import {
  ambiguousProjectMatch,
  formatError,
  invalidWorkspacePath,
  noProjectMatch,
} from "../utils/errors.js";
import { getDataDir, getProjectDir } from "../utils/paths.js";
import type { ProjectMeta } from "../utils/project-documents.js";
import type { FileRef } from "../utils/project-memory.js";
import { readKnowledgeIndex, readPlanIndex } from "../utils/project-memory.js";
import { deriveOperatingBrief, safeTime } from "../utils/workflow-policy.js";
import { findBestMatch, type WorkspaceProject } from "../utils/workspace-match.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatFileRefs(sourceFiles?: FileRef[]): string {
  if (!sourceFiles || sourceFiles.length === 0) return "";
  const formatted = sourceFiles
    .map((f) => (f.anchor ? `${f.path}#${f.anchor}` : f.path))
    .join(", ");
  return `\n  Files: ${formatted}`;
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerResolveContext(server: McpServer) {
  server.tool(
    "resolve_project_context",
    "Resolve project context from a workspace directory path. Matches the path against registered workspace paths and returns assembled project context (overview, active tasks, knowledge, plans).",
    {
      workspacePath: z.string().describe("Absolute path to the workspace directory"),
    },
    async (params) => {
      try {
        const queryPath = params.workspacePath;

        // Validate absolute path
        if (!queryPath.startsWith("/")) {
          return formatError(invalidWorkspacePath(queryPath));
        }

        const dataDir = getDataDir();
        const rootMeta = await readRootMeta(dataDir);

        // Build workspace project list by reading each project's meta.json
        const workspaceProjects: WorkspaceProject[] = [];
        const projectMetas = new Map<string, ProjectMeta>();

        for (const node of rootMeta.projects) {
          const metaPath = resolve(dataDir, "projects", node.id, "meta.json");
          if (!existsSync(metaPath)) continue;

          const meta = JSON.parse(await readFile(metaPath, "utf-8")) as ProjectMeta;
          const paths = Array.isArray(meta.workspacePaths) ? meta.workspacePaths : [];

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
            return formatError(ambiguousProjectMatch(queryPath, matchResult.slugs));
          case "match":
            // Continue with assembly below
            break;
        }

        const slug = matchResult.slug;
        const projectDir = getProjectDir(slug);
        const meta = projectMetas.get(slug);

        const name = meta?.name ?? slug;
        const description = meta?.description ?? "";

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
          const overviewRaw = await readFile(overviewPath, "utf-8");
          const overviewContent = extractOverviewContent(overviewRaw);
          if (overviewContent) {
            sections.push(`\n## Overview\n\n${overviewContent}`);
          }
        }

        const tasksPath = resolve(projectDir, "tasks.md");
        const tasksRaw = existsSync(tasksPath) ? await readFile(tasksPath, "utf-8") : "";

        // Key Knowledge (last 10 entries by updatedAt)
        const knowledgeIndex = await readKnowledgeIndex(projectDir);
        if (knowledgeIndex.entries.length > 0) {
          const sorted = [...knowledgeIndex.entries].sort(
            (a, b) => safeTime(b.updatedAt) - safeTime(a.updatedAt),
          );
          const top = sorted.slice(0, 10); // Intentionally hardcoded limit for v1
          const bullets = top
            .map((e) => {
              const summary = e.summary ? `: ${e.summary}` : "";
              return `- **${e.title}**${summary}${formatFileRefs(e.sourceFiles)}`;
            })
            .join("\n");
          sections.push(`\n## Key Knowledge\n\n${bullets}`);
        }

        // Active Plans (in_progress or planned)
        const planIndex = await readPlanIndex(projectDir);
        const activePlans = planIndex.plans.filter(
          (p) => p.status === "in_progress" || p.status === "planned",
        );

        const inProgressTasks = extractInProgressTasks(tasksRaw);
        const backlogTasks = extractBacklogTasks(tasksRaw);
        const brief = deriveOperatingBrief({
          plans: planIndex.plans,
          inProgressTasks,
          backlogTasks,
          hasDurableKnowledgeSignal: knowledgeIndex.entries.length > 0,
        });

        sections.push(
          "\n## Operating Brief\n",
          `**Current Focus:** ${brief.currentFocus}`,
          `**Recommended Surface:** ${brief.recommendedSurface}`,
          `**Why:** ${brief.why}`,
          `**Next Action:** ${brief.nextAction}`,
        );

        if (brief.currentFocus !== "None") {
          sections.push(`\n## Current Focus\n\n- ${brief.currentFocus}`);
        }

        if (activePlans.length > 0) {
          const bullets = activePlans
            .map((p) => {
              const summary = p.summary ? `: ${p.summary}` : "";
              return `- **${p.title}** (${p.status})${summary}${formatFileRefs(p.sourceFiles)}`;
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
    },
  );
}
