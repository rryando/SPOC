// ---------------------------------------------------------------------------
// Task commands — list, get, create, transition, update (registry-based)
// ---------------------------------------------------------------------------

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { getDataDir, getProjectDir } from "../../utils/paths.js";
import {
  createTask,
  deleteTask,
  getTask,
  listTasks,
  type TaskPriority,
  type TaskStatus,
  updateTask,
} from "../../utils/project-memory.js";
import {
  type CLIResult,
  type CommandFlags,
  defineCommand,
  ERROR_CODES,
} from "../command-registry.js";
import { failure, success } from "../output-envelope.js";

// ---------------------------------------------------------------------------
// task list
// ---------------------------------------------------------------------------

defineCommand({
  path: "task list",
  description: "List tasks for a project",
  params: {
    slug: { type: "string", required: true, positional: 0, description: "Project slug" },
    status: {
      type: "string",
      description: "Filter by status",
      enum: ["backlog", "in_progress", "done", "cancelled"],
    },
    priority: {
      type: "string",
      description: "Filter by priority",
      enum: ["low", "medium", "high", "critical"],
    },
    planId: { type: "string", description: "Filter by plan ID" },
  },
  handler: handleTaskList,
});

async function handleTaskList(
  params: Record<string, unknown>,
  _flags: CommandFlags,
): Promise<CLIResult> {
  const slug = params.slug as string;
  const status = params.status as TaskStatus | undefined;
  const priority = params.priority as TaskPriority | undefined;
  const planId = params.planId as string | undefined;

  const projectDir = getProjectDir(slug);
  if (!existsSync(projectDir)) {
    return failure(ERROR_CODES.PROJECT_NOT_FOUND, `Project "${slug}" not found`, {
      hint: "Run 'spoc project list' to see available projects.",
    });
  }

  let tasks = await listTasks(projectDir, { status });

  if (priority) {
    tasks = tasks.filter((t) => t.priority === priority);
  }

  if (planId) {
    tasks = tasks.filter((t) => t.planId === planId);
  }

  return success(tasks);
}

// ---------------------------------------------------------------------------
// task get
// ---------------------------------------------------------------------------

defineCommand({
  path: "task get",
  description: "Get task details",
  params: {
    slug: { type: "string", required: true, positional: 0, description: "Project slug" },
    taskId: { type: "string", required: true, positional: 1, description: "Task ID" },
  },
  handler: handleTaskGet,
});

async function handleTaskGet(
  params: Record<string, unknown>,
  _flags: CommandFlags,
): Promise<CLIResult> {
  const slug = params.slug as string;
  const taskId = params.taskId as string;

  const projectDir = getProjectDir(slug);
  if (!existsSync(projectDir)) {
    return failure(ERROR_CODES.PROJECT_NOT_FOUND, `Project "${slug}" not found`, {
      hint: "Run 'spoc project list' to see available projects.",
    });
  }

  try {
    const task = await getTask(projectDir, taskId);
    return success(task);
  } catch (err) {
    return failure(ERROR_CODES.ENTITY_NOT_FOUND, err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// task create
// ---------------------------------------------------------------------------

defineCommand({
  path: "task create",
  description: "Create a new task",
  mutation: true,
  params: {
    slug: { type: "string", required: true, positional: 0, description: "Project slug" },
    title: { type: "string", required: true, positional: 1, description: "Task title" },
    planId: { type: "string", description: "Associated plan ID" },
    priority: {
      type: "string",
      default: "medium",
      description: "Priority level",
      enum: ["high", "medium", "low"],
    },
    status: {
      type: "string",
      default: "backlog",
      description: "Initial status",
      enum: ["backlog", "in_progress", "done", "cancelled"],
    },
  },
  handler: handleTaskCreate,
});

async function handleTaskCreate(
  params: Record<string, unknown>,
  flags: CommandFlags,
): Promise<CLIResult> {
  const slug = params.slug as string;
  const title = params.title as string;
  const planId = params.planId as string | undefined;
  const priority = (params.priority as TaskPriority) ?? "medium";
  const status = (params.status as TaskStatus) ?? "backlog";

  const projectDir = getProjectDir(slug);
  if (!existsSync(projectDir)) {
    return failure(ERROR_CODES.PROJECT_NOT_FOUND, `Project "${slug}" not found`, {
      hint: "Run 'spoc project list' to see available projects.",
    });
  }

  if (flags.dryRun) {
    return success({ dryRun: true, wouldCreate: { title, slug, planId, priority, status } });
  }

  try {
    const task = await createTask(projectDir, {
      title,
      ...(planId && { planId }),
      priority,
      status,
    });
    return success(task);
  } catch (err) {
    return failure("task_create_error", err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// task transition
// ---------------------------------------------------------------------------

defineCommand({
  path: "task transition",
  description: "Transition task status",
  mutation: true,
  params: {
    slug: { type: "string", required: true, positional: 0, description: "Project slug" },
    taskId: { type: "string", required: true, positional: 1, description: "Task ID" },
    status: {
      type: "string",
      required: true,
      positional: 2,
      description: "New status",
      enum: ["backlog", "in_progress", "done", "cancelled"],
    },
    planId: { type: "string", description: "Plan ID (enables atomic diagram update)" },
    diagramNodeId: { type: "string", description: "Diagram node ID to update (e.g. T001)" },
  },
  handler: handleTaskTransition,
});

/**
 * Map task status (snake_case in the SPOC task model) to diagram classDef
 * status (camelCase in the Mermaid script). The two namespaces are
 * intentionally distinct — task statuses follow Python/JSON convention,
 * diagram statuses match the classDef identifiers.
 */
function taskStatusToDiagramStatus(status: TaskStatus): string {
  switch (status) {
    case "in_progress":
      return "inProgress";
    case "done":
      return "done";
    case "cancelled":
      return "blocked";
    case "backlog":
      return "backlog";
  }
}

function findDiagramScript(): string | undefined {
  const localPath = resolve(
    import.meta.dirname,
    "../../../opencode/spoc/skills/to-diagram/scripts/manage-diagram.mjs",
  );
  if (existsSync(localPath)) return localPath;

  const configPath = resolve(
    homedir(),
    ".config/opencode/skills/spoc/to-diagram/scripts/manage-diagram.mjs",
  );
  if (existsSync(configPath)) return configPath;

  return undefined;
}

export function attemptDiagramUpdate(
  slug: string,
  planId: string,
  nodeId: string,
  status: TaskStatus,
): { diagramUpdated: boolean; diagramError?: string } {
  const dataDir = getDataDir();
  const diagramPath = resolve(dataDir, "projects", slug, "plans", `${planId}.diagram.mmd`);

  if (!existsSync(diagramPath)) {
    return { diagramUpdated: false, diagramError: "Diagram file not found" };
  }

  const scriptPath = findDiagramScript();
  if (!scriptPath) {
    return { diagramUpdated: false, diagramError: "manage-diagram.mjs script not found" };
  }

  const diagramStatus = taskStatusToDiagramStatus(status);
  try {
    execSync(`node "${scriptPath}" status "${diagramPath}" "${nodeId}" "${diagramStatus}"`, {
      encoding: "utf-8",
      timeout: 10000,
      // Capture child stderr so script error output never leaks to the parent's
      // stderr — keeps --json output clean and parseable for agents.
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { diagramUpdated: true };
  } catch (err) {
    const msg =
      err instanceof Error ? (err as { stderr?: string }).stderr || err.message : String(err);
    return { diagramUpdated: false, diagramError: msg };
  }
}

async function handleTaskTransition(
  params: Record<string, unknown>,
  flags: CommandFlags,
): Promise<CLIResult> {
  const slug = params.slug as string;
  const taskId = params.taskId as string;
  const status = params.status as TaskStatus;
  const planId = params.planId as string | undefined;
  const diagramNodeId = params.diagramNodeId as string | undefined;

  const projectDir = getProjectDir(slug);
  if (!existsSync(projectDir)) {
    return failure(ERROR_CODES.PROJECT_NOT_FOUND, `Project "${slug}" not found`, {
      hint: "Run 'spoc project list' to see available projects.",
    });
  }

  if (flags.dryRun) {
    return success({
      dryRun: true,
      wouldTransition: { slug, taskId, status, planId, diagramNodeId },
    });
  }

  try {
    const currentTask = await getTask(projectDir, taskId);
    const previousStatus = currentTask.status;
    await updateTask(projectDir, { id: taskId, status });

    // Atomic diagram update if both planId and diagramNodeId provided
    if (planId && diagramNodeId) {
      const diagramResult = attemptDiagramUpdate(slug, planId, diagramNodeId, status);
      return success({
        taskId,
        previousStatus,
        newStatus: status,
        diagramNodeId,
        ...diagramResult,
      });
    }

    return success({ taskId, previousStatus, newStatus: status });
  } catch (err) {
    return failure(ERROR_CODES.ENTITY_NOT_FOUND, err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// task update
// ---------------------------------------------------------------------------

defineCommand({
  path: "task update",
  description: "Update task metadata",
  mutation: true,
  params: {
    slug: { type: "string", required: true, positional: 0, description: "Project slug" },
    taskId: { type: "string", required: true, positional: 1, description: "Task ID" },
    title: { type: "string", description: "New title" },
    priority: { type: "string", description: "New priority", enum: ["high", "medium", "low"] },
    status: {
      type: "string",
      description: "New status",
      enum: ["backlog", "in_progress", "done", "cancelled"],
    },
    planId: { type: "string", description: "Associated plan ID" },
  },
  handler: handleTaskUpdate,
});

async function handleTaskUpdate(
  params: Record<string, unknown>,
  flags: CommandFlags,
): Promise<CLIResult> {
  const slug = params.slug as string;
  const taskId = params.taskId as string;
  const title = params.title as string | undefined;
  const priority = params.priority as TaskPriority | undefined;
  const status = params.status as TaskStatus | undefined;
  const planId = params.planId as string | undefined;

  const projectDir = getProjectDir(slug);
  if (!existsSync(projectDir)) {
    return failure(ERROR_CODES.PROJECT_NOT_FOUND, `Project "${slug}" not found`, {
      hint: "Run 'spoc project list' to see available projects.",
    });
  }

  if (flags.dryRun) {
    return success({
      dryRun: true,
      wouldUpdate: { slug, taskId, title, priority, status, planId },
    });
  }

  try {
    const task = await updateTask(projectDir, {
      id: taskId,
      ...(title && { title }),
      ...(status && { status }),
      ...(priority && { priority }),
      ...(planId && { planId }),
    });
    return success(task);
  } catch (err) {
    return failure(ERROR_CODES.ENTITY_NOT_FOUND, err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// task delete
// ---------------------------------------------------------------------------

defineCommand({
  path: "task delete",
  description: "Delete a task",
  mutation: true,
  params: {
    slug: { type: "string", required: true, positional: 0, description: "Project slug" },
    taskId: { type: "string", required: true, positional: 1, description: "Task ID" },
  },
  handler: handleTaskDelete,
});

async function handleTaskDelete(
  params: Record<string, unknown>,
  flags: CommandFlags,
): Promise<CLIResult> {
  const slug = params.slug as string;
  const taskId = params.taskId as string;

  const projectDir = getProjectDir(slug);
  if (!existsSync(projectDir)) {
    return failure(ERROR_CODES.PROJECT_NOT_FOUND, `Project "${slug}" not found`, {
      hint: "Run 'spoc project list' to see available projects.",
    });
  }

  if (flags.dryRun) {
    return success({ dryRun: true, wouldDelete: { slug, taskId } });
  }

  try {
    await getTask(projectDir, taskId);
  } catch {
    return failure(ERROR_CODES.ENTITY_NOT_FOUND, `Task "${taskId}" not found`, {
      hint: `Run 'spoc task list ${slug}' to see available tasks.`,
    });
  }

  try {
    await deleteTask(projectDir, taskId);
    return success({ deleted: taskId });
  } catch (err) {
    return failure("task_delete_error", err instanceof Error ? err.message : String(err));
  }
}
