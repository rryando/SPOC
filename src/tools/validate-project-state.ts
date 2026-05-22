import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DagError, formatError, projectNotFound } from "../utils/errors.js";
import { isGitRepo, getFilesChanged, getHeadCommit } from "../utils/git.js";
import { readJsonSafe, validateJson } from "../utils/json.js";
import { projectMetaSchema } from "../utils/json-schemas.js";
import { getProjectDir } from "../utils/paths.js";
import { listTasks, readKnowledgeIndex, readPlanIndex } from "../utils/project-memory.js";
import { errorResult, jsonResult } from "../utils/tool-response.js";

interface ValidationIssue {
  severity: "error" | "warning" | "info";
  kind: string;
  message: string;
  file?: string;
  repair?: string;
  safeToAutoRepair: boolean;
}

export function registerValidateProjectState(server: McpServer) {
  server.tool(
    "validate_project_state",
    "Validate project state consistency. Reports drift across tasks, plans, diagrams, knowledge sourceFiles, and AGENTS.md freshness.",
    {
      slug: z.string().describe("Project slug"),
    },
    async (params) => {
      try {
        const projectDir = getProjectDir(params.slug);
        if (!existsSync(projectDir)) {
          return formatError(projectNotFound(params.slug));
        }

        const metaPath = resolve(projectDir, "meta.json");
        const rawMeta = await readJsonSafe<unknown>(metaPath);
        if (rawMeta === undefined) {
          return errorResult(new Error(`Failed to read project meta at ${metaPath}`));
        }
        const projectMeta = validateJson(rawMeta, projectMetaSchema, metaPath);
        const workspacePaths = projectMeta.workspacePaths ?? [];

        const issues: ValidationIssue[] = [];
        let totalChecks = 0;

        // --- Check 1: Knowledge sourceFiles exist ---
        const knowledgeIndex = await readKnowledgeIndex(projectDir);
        for (const entry of knowledgeIndex.entries) {
          const sourceFiles = entry.sourceFiles ?? [];
          for (const ref of sourceFiles) {
            totalChecks++;
            const found = workspacePaths.some((ws) => existsSync(resolve(ws, ref.path)));
            if (!found && workspacePaths.length > 0) {
              issues.push({
                severity: "warning",
                kind: "stale_knowledge_source",
                message: `Knowledge entry "${entry.title}" references missing file: ${ref.path}`,
                file: ref.path,
                repair: `Remove stale sourceFile reference from knowledge entry "${entry.id}"`,
                safeToAutoRepair: false,
              });
            }
          }
        }

        // --- Check 1b: Git-based changed files since last sync ---
        let changedSinceLastSync: string[] | undefined;
        try {
          const primaryWorkspace = workspacePaths[0];
          if (primaryWorkspace && isGitRepo(primaryWorkspace)) {
            if (projectMeta.lastSyncGitCommit) {
              changedSinceLastSync = getFilesChanged(primaryWorkspace, projectMeta.lastSyncGitCommit);
            }
          }
        } catch {
          // Git unavailable — skip silently
        }

        // --- Check 2: AGENTS.md exists in workspace paths ---
        for (const ws of workspacePaths) {
          totalChecks++;
          const agentsPath = resolve(ws, "AGENTS.md");
          if (!existsSync(agentsPath)) {
            issues.push({
              severity: "info",
              kind: "missing_agents_md",
              message: `No AGENTS.md found at workspace path: ${ws}`,
              file: agentsPath,
              repair: `Run sync_agents_md for project "${params.slug}"`,
              safeToAutoRepair: true,
            });
          }
        }

        // --- Check 3: Plan diagrams ---
        const planIndex = await readPlanIndex(projectDir);
        const plansDir = resolve(projectDir, "plans");
        const activeStatuses = ["planned", "in_progress", "blocked"];

        // --- Check 3a: Plan sourceFiles exist ---
        for (const plan of planIndex.plans) {
          const sourceFiles = plan.sourceFiles ?? [];
          for (const ref of sourceFiles) {
            totalChecks++;
            const found = workspacePaths.some((ws) => existsSync(resolve(ws, ref.path)));
            if (!found && workspacePaths.length > 0) {
              issues.push({
                severity: "warning",
                kind: "stale_plan_source",
                message: `Plan "${plan.title}" references missing file: ${ref.path}`,
                file: ref.path,
                repair: `Remove stale sourceFile reference from plan "${plan.id}"`,
                safeToAutoRepair: false,
              });
            }
          }
        }

        for (const plan of planIndex.plans) {
          if (!activeStatuses.includes(plan.status)) continue;

          totalChecks++;
          const diagramPath = resolve(plansDir, `${plan.normalizedId}.diagram.mmd`);

          if (!existsSync(diagramPath)) {
            issues.push({
              severity: "info",
              kind: "missing_plan_diagram",
              message: `Active plan "${plan.title}" has no diagram file`,
              file: diagramPath,
              repair: `Create diagram for plan "${plan.id}" using to-diagram skill`,
              safeToAutoRepair: false,
            });
          } else {
            // Validate diagram content minimally
            totalChecks++;
            const content = readFileSync(diagramPath, "utf-8");
            const diagramErrors = validateDiagramContent(content);
            if (diagramErrors.length > 0) {
              issues.push({
                severity: "warning",
                kind: "invalid_diagram",
                message: `Basic diagram validation failed for plan "${plan.title}": ${diagramErrors.join("; ")}`,
                file: diagramPath,
                repair: `Fix diagram errors or regenerate using to-diagram skill (run manage-diagram.mjs validate for full check)`,
                safeToAutoRepair: false,
              });
            }
          }
        }

        // --- Check 4: Plan status vs task completion ---
        const allTasks = await listTasks(projectDir);
        for (const plan of planIndex.plans) {
          if (!activeStatuses.includes(plan.status)) continue;

          const planTasks = allTasks.filter((t) => t.planId === plan.id);
          if (planTasks.length === 0) continue;

          totalChecks++;
          // Policy: plan_status_drift fires only when every linked task is
          // "done" and none is "cancelled". A mix of done+cancelled means the
          // plan needs manual review, not auto-completion.
          const allDone =
            planTasks.every((t) => t.status === "done") &&
            !planTasks.some((t) => t.status === "cancelled");

          if (allDone) {
            issues.push({
              severity: "warning",
              kind: "plan_status_drift",
              message: `Plan "${plan.title}" is "${plan.status}" but all ${planTasks.length} tasks are done`,
              file: resolve(plansDir, `${plan.normalizedId}.meta.json`),
              repair: `Update plan "${plan.id}" status to "done"`,
              safeToAutoRepair: false,
            });
          }
        }

        // --- Compute totalByKind ---
        const tasksByStatus = { backlog: 0, in_progress: 0, done: 0, cancelled: 0 };
        for (const t of allTasks) {
          if (t.status in tasksByStatus) {
            tasksByStatus[t.status as keyof typeof tasksByStatus]++;
          }
        }

        const docFiles = ["overview.md", "tasks.md", "dependencies.md", "knowledge"] as const;
        let docsCount = 0;
        for (const doc of docFiles) {
          if (existsSync(resolve(projectDir, doc))) docsCount++;
        }

        const totalByKind = {
          docs: docsCount,
          knowledgeEntries: knowledgeIndex.entries.length,
          plans: planIndex.plans.length,
          tasksByStatus,
        };

        // --- Compute staleSince ---
        const staleSince = computeStaleSince(projectMeta.lastSyncedAt);

        // --- Compute driftByType ---
        const driftByType = {
          classDefMismatch: 0,
          phantomNode: 0,
          missingNode: 0,
          topologyMismatch: 0,
          stalePlanComments: 0,
          incompleteMetadata: 0,
        };
        for (const issue of issues) {
          if (issue.kind in driftByType) {
            driftByType[issue.kind as keyof typeof driftByType]++;
          }
        }

        const summary: Record<string, unknown> = {
          totalChecks,
          issueCount: issues.length,
          bySeverity: {
            error: issues.filter((i) => i.severity === "error").length,
            warning: issues.filter((i) => i.severity === "warning").length,
            info: issues.filter((i) => i.severity === "info").length,
          },
          totalByKind,
          driftByType,
        };
        if (staleSince !== undefined) {
          summary.staleSince = staleSince;
        }

        const result: Record<string, unknown> = { issues, summary };
        if (changedSinceLastSync !== undefined) {
          result.changedSinceLastSync = changedSinceLastSync;
        }
        return jsonResult(result);
      } catch (err) {
        if (err instanceof DagError) return formatError(err);
        return errorResult(err);
      }
    },
  );
}

/**
 * Compute a human-readable duration string from an ISO 8601 timestamp to now.
 * Returns undefined if the input is undefined or invalid.
 */
function computeStaleSince(lastSyncedAt: string | undefined): string | undefined {
  if (!lastSyncedAt) return undefined;
  const then = new Date(lastSyncedAt).getTime();
  if (Number.isNaN(then)) return undefined;
  const diffMs = Date.now() - then;
  if (diffMs < 0) return undefined;

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const remainingDays = days % 7;

  if (weeks > 0) {
    const parts: string[] = [`${weeks} week${weeks > 1 ? "s" : ""}`];
    if (remainingDays > 0) parts.push(`${remainingDays} day${remainingDays > 1 ? "s" : ""}`);
    return parts.join(" ");
  }
  if (days > 0) return `${days} day${days > 1 ? "s" : ""}`;
  if (hours > 0) return `${hours} hour${hours > 1 ? "s" : ""}`;
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? "s" : ""}`;
  return `${seconds} second${seconds !== 1 ? "s" : ""}`;
}

/**
 * Basic diagram validation — checks minimal structural requirements only
 * (flowchart TD presence, at least one node). Does NOT invoke full
 * manage-diagram.mjs validate logic.
 */
function validateDiagramContent(content: string): string[] {
  const errors: string[] = [];

  // Must contain flowchart TD
  if (!content.includes("flowchart TD")) {
    errors.push("No flowchart TD found in file");
    return errors;
  }

  // Check for at least one node
  const nodeRe = /\b(T\d+)\[([^\]]+)\]/;
  if (!nodeRe.test(content)) {
    errors.push("No task nodes (T###[...]) found");
  }

  return errors;
}
