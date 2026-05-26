// ---------------------------------------------------------------------------
// Task commands — list, get, create, transition, update (registry-based)
// ---------------------------------------------------------------------------

import { existsSync } from "node:fs";
import { defineCommand, type CLIResult, type CommandFlags, ERROR_CODES } from "../command-registry.js";
import { success, failure } from "../output-envelope.js";
import { getProjectDir } from "../../utils/paths.js";
import { requireWriteGate, WriteGateError } from "../../utils/write-gate.js";
import {
  listTasks,
  getTask,
  createTask,
  updateTask,
  deleteTask,
  type TaskStatus,
  type TaskPriority,
} from "../../utils/project-memory.js";

// ---------------------------------------------------------------------------
// task list
// ---------------------------------------------------------------------------

defineCommand({
  path: "task list",
  description: "List tasks for a project",
  params: {
    slug: { type: "string", required: true, positional: 0, description: "Project slug" },
    status: { type: "string", description: "Filter by status", enum: ["backlog", "in_progress", "done", "cancelled"] },
    planId: { type: "string", description: "Filter by plan ID" },
  },
  handler: handleTaskList,
});

async function handleTaskList(params: Record<string, unknown>, _flags: CommandFlags): Promise<CLIResult> {
  const slug = params.slug as string;
  const status = params.status as TaskStatus | undefined;
  const planId = params.planId as string | undefined;

  const projectDir = getProjectDir(slug);
  if (!existsSync(projectDir)) {
    return failure(ERROR_CODES.PROJECT_NOT_FOUND, `Project "${slug}" not found`, {
      hint: "Run 'spoc project list' to see available projects.",
    });
  }

  let tasks = await listTasks(projectDir, { status });

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

async function handleTaskGet(params: Record<string, unknown>, _flags: CommandFlags): Promise<CLIResult> {
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
  gated: true,
  gateName: "task-create",
  params: {
    slug: { type: "string", required: true, positional: 0, description: "Project slug" },
    title: { type: "string", required: true, positional: 1, description: "Task title" },
    planId: { type: "string", description: "Associated plan ID" },
    priority: { type: "string", default: "medium", description: "Priority level", enum: ["high", "medium", "low"] },
    status: { type: "string", default: "backlog", description: "Initial status", enum: ["backlog", "in_progress", "done", "cancelled"] },
    token: { type: "string", description: "Write-gate token" },
  },
  handler: handleTaskCreate,
});

async function handleTaskCreate(params: Record<string, unknown>, flags: CommandFlags): Promise<CLIResult> {
  const slug = params.slug as string;
  const title = params.title as string;
  const planId = params.planId as string | undefined;
  const priority = (params.priority as TaskPriority) ?? "medium";
  const status = (params.status as TaskStatus) ?? "backlog";
  const token = params.token as string | undefined;

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
    requireWriteGate(token, slug, "tool:create_project_task");
  } catch (err) {
    if (err instanceof WriteGateError) {
      return failure(err.code, err.message, { hint: err.hint });
    }
    throw err;
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
  gated: true,
  gateName: "task-transition",
  params: {
    slug: { type: "string", required: true, positional: 0, description: "Project slug" },
    taskId: { type: "string", required: true, positional: 1, description: "Task ID" },
    status: { type: "string", required: true, positional: 2, description: "New status", enum: ["backlog", "in_progress", "done", "cancelled"] },
    token: { type: "string", description: "Write-gate token" },
  },
  handler: handleTaskTransition,
});

async function handleTaskTransition(params: Record<string, unknown>, flags: CommandFlags): Promise<CLIResult> {
  const slug = params.slug as string;
  const taskId = params.taskId as string;
  const status = params.status as TaskStatus;
  const token = params.token as string | undefined;

  const projectDir = getProjectDir(slug);
  if (!existsSync(projectDir)) {
    return failure(ERROR_CODES.PROJECT_NOT_FOUND, `Project "${slug}" not found`, {
      hint: "Run 'spoc project list' to see available projects.",
    });
  }

  if (flags.dryRun) {
    return success({ dryRun: true, wouldTransition: { slug, taskId, status } });
  }

  try {
    requireWriteGate(token, slug, "tool:transition_project_task");
  } catch (err) {
    if (err instanceof WriteGateError) {
      return failure(err.code, err.message, { hint: err.hint });
    }
    throw err;
  }

  try {
    const currentTask = await getTask(projectDir, taskId);
    const previousStatus = currentTask.status;
    await updateTask(projectDir, { id: taskId, status });
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
  gated: true,
  gateName: "task-update",
  params: {
    slug: { type: "string", required: true, positional: 0, description: "Project slug" },
    taskId: { type: "string", required: true, positional: 1, description: "Task ID" },
    title: { type: "string", description: "New title" },
    priority: { type: "string", description: "New priority", enum: ["high", "medium", "low"] },
    status: { type: "string", description: "New status", enum: ["backlog", "in_progress", "done", "cancelled"] },
    planId: { type: "string", description: "Associated plan ID" },
    token: { type: "string", description: "Write-gate token" },
  },
  handler: handleTaskUpdate,
});

async function handleTaskUpdate(params: Record<string, unknown>, flags: CommandFlags): Promise<CLIResult> {
  const slug = params.slug as string;
  const taskId = params.taskId as string;
  const title = params.title as string | undefined;
  const priority = params.priority as TaskPriority | undefined;
  const status = params.status as TaskStatus | undefined;
  const planId = params.planId as string | undefined;
  const token = params.token as string | undefined;

  const projectDir = getProjectDir(slug);
  if (!existsSync(projectDir)) {
    return failure(ERROR_CODES.PROJECT_NOT_FOUND, `Project "${slug}" not found`, {
      hint: "Run 'spoc project list' to see available projects.",
    });
  }

  if (flags.dryRun) {
    return success({ dryRun: true, wouldUpdate: { slug, taskId, title, priority, status, planId } });
  }

  try {
    requireWriteGate(token, slug, "tool:update_project_task");
  } catch (err) {
    if (err instanceof WriteGateError) {
      return failure(err.code, err.message, { hint: err.hint });
    }
    throw err;
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
  gated: true,
  gateName: "task-delete",
  params: {
    slug: { type: "string", required: true, positional: 0, description: "Project slug" },
    taskId: { type: "string", required: true, positional: 1, description: "Task ID" },
    token: { type: "string", required: true, description: "Write-gate token" },
  },
  handler: handleTaskDelete,
});

async function handleTaskDelete(params: Record<string, unknown>, flags: CommandFlags): Promise<CLIResult> {
  const slug = params.slug as string;
  const taskId = params.taskId as string;
  const token = params.token as string | undefined;

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
    requireWriteGate(token, slug, "tool:delete_project_task");
  } catch (err) {
    if (err instanceof WriteGateError) {
      return failure(err.code, err.message, { hint: err.hint });
    }
    throw err;
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
