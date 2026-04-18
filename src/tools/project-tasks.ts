import { existsSync } from "node:fs";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DagError, formatError, planNotFound, projectNotFound } from "../utils/errors.js";
import { getProjectDir } from "../utils/paths.js";
import {
  createTask,
  deleteTask,
  getTask,
  listTasks,
  readPlanIndex,
  TASK_PRIORITIES,
  TASK_STATUSES,
  updateTask,
} from "../utils/project-memory.js";
import { fileRefSchema } from "../utils/schemas.js";
import { errorResult, jsonResult } from "../utils/tool-response.js";

export function registerProjectTaskTools(server: McpServer) {
  // ---- create_project_task ----
  server.tool(
    "create_project_task",
    "Create a new task within a project.",
    {
      slug: z.string().describe("Project slug"),
      title: z.string().describe("Task title"),
      priority: z
        .enum(TASK_PRIORITIES)
        .optional()
        .default("medium")
        .describe("Task priority (default: medium)"),
      status: z
        .enum(TASK_STATUSES)
        .optional()
        .default("backlog")
        .describe("Task status (default: backlog)"),
      sourceFiles: z
        .array(fileRefSchema)
        .optional()
        .describe("Source file references (path + optional anchor)"),
      planId: z.string().optional().describe("Link task to a governing plan by plan ID"),
    },
    async (params) => {
      try {
        const projectDir = getProjectDir(params.slug);
        if (!existsSync(projectDir)) {
          return formatError(projectNotFound(params.slug));
        }

        if (params.planId) {
          const planIndex = await readPlanIndex(projectDir);
          if (!planIndex.plans.some((p) => p.normalizedId === params.planId)) {
            return formatError(planNotFound(params.slug, params.planId));
          }
        }

        const meta = await createTask(projectDir, {
          title: params.title,
          status: params.status,
          priority: params.priority,
          planId: params.planId,
          sourceFiles: params.sourceFiles,
        });

        return jsonResult({ meta });
      } catch (err) {
        if (err instanceof DagError) return formatError(err);
        return errorResult(err);
      }
    },
  );

  // ---- list_project_tasks ----
  server.tool(
    "list_project_tasks",
    "List tasks for a project, optionally filtered by status and/or priority.",
    {
      slug: z.string().describe("Project slug"),
      status: z.enum(TASK_STATUSES).optional().describe("Filter by status"),
      priority: z.enum(TASK_PRIORITIES).optional().describe("Filter by priority"),
    },
    async (params) => {
      try {
        const projectDir = getProjectDir(params.slug);
        if (!existsSync(projectDir)) {
          return formatError(projectNotFound(params.slug));
        }

        const tasks = await listTasks(projectDir, {
          status: params.status,
          priority: params.priority,
        });

        return jsonResult({ tasks });
      } catch (err) {
        if (err instanceof DagError) return formatError(err);
        return errorResult(err);
      }
    },
  );

  // ---- get_project_task ----
  server.tool(
    "get_project_task",
    "Get a task's metadata by ID.",
    {
      slug: z.string().describe("Project slug"),
      taskId: z.string().describe("Task identifier"),
    },
    async (params) => {
      try {
        const projectDir = getProjectDir(params.slug);
        if (!existsSync(projectDir)) {
          return formatError(projectNotFound(params.slug));
        }

        const meta = await getTask(projectDir, params.taskId);

        return jsonResult({ meta });
      } catch (err) {
        if (err instanceof DagError) return formatError(err);
        return errorResult(err);
      }
    },
  );

  // ---- update_project_task ----
  server.tool(
    "update_project_task",
    "Update a task's metadata (title, status, priority).",
    {
      slug: z.string().describe("Project slug"),
      taskId: z.string().describe("Task identifier"),
      title: z.string().optional().describe("New title"),
      status: z.enum(TASK_STATUSES).optional().describe("New status"),
      priority: z.enum(TASK_PRIORITIES).optional().describe("New priority"),
      sourceFiles: z
        .array(fileRefSchema)
        .optional()
        .describe("New source file references (replaces existing; empty array clears)"),
      planId: z.string().nullable().optional().describe("Link task to a governing plan by plan ID (null to unset)"),
    },
    async (params) => {
      try {
        const projectDir = getProjectDir(params.slug);
        if (!existsSync(projectDir)) {
          return formatError(projectNotFound(params.slug));
        }

        if (params.planId) {
          const planIndex = await readPlanIndex(projectDir);
          if (!planIndex.plans.some((p) => p.normalizedId === params.planId)) {
            return formatError(planNotFound(params.slug, params.planId));
          }
        }

        const meta = await updateTask(projectDir, {
          id: params.taskId,
          title: params.title,
          status: params.status,
          priority: params.priority,
          planId: params.planId,
          sourceFiles: params.sourceFiles,
        });

        return jsonResult({ meta });
      } catch (err) {
        if (err instanceof DagError) return formatError(err);
        return errorResult(err);
      }
    },
  );

  // ---- delete_project_task ----
  server.tool(
    "delete_project_task",
    "Delete a task from a project.",
    {
      slug: z.string().describe("Project slug"),
      taskId: z.string().describe("Task identifier"),
    },
    async (params) => {
      try {
        const projectDir = getProjectDir(params.slug);
        if (!existsSync(projectDir)) {
          return formatError(projectNotFound(params.slug));
        }
        await deleteTask(projectDir, params.taskId);
        return {
          content: [
            {
              type: "text" as const,
              text: `Deleted task "${params.taskId}" from project "${params.slug}".`,
            },
          ],
        };
      } catch (err) {
        if (err instanceof DagError) return formatError(err);
        return errorResult(err);
      }
    },
  );
}
