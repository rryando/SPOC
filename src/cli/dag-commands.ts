// ---------------------------------------------------------------------------
// DAG CLI Command Handlers
// ---------------------------------------------------------------------------

import { execSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import {
  extractBacklogTasks,
  extractInProgressTasks,
  extractOverviewContent,
} from "../utils/content-assembly.js";
import { readRootMeta, validateDependencies, wouldCreateCycle, writeRootMeta } from "../utils/dag.js";
import { isGitRepo, getGitLog } from "../utils/git.js";
import { readJsonSafe, validateJson } from "../utils/json.js";
import { knowledgeMetaSchema, projectMetaSchema } from "../utils/json-schemas.js";
import { getDataDir, getProjectDir } from "../utils/paths.js";
import {
  createKnowledgeEntry,
  createPlan,
  deletePlan,
  createTask,
  deleteTask,
  deleteKnowledgeEntry,
  getTask,
  listTasks,
  readKnowledgeIndex,
  readPlanIndex,
  KNOWLEDGE_KINDS,
  PLAN_STATUSES,
  TASK_STATUSES,
  updateKnowledgeEntry,
  updatePlan,
  updateTask,
  type FileRef,
  type KnowledgeKind,
  type PlanStatus,
  type TaskStatus,
  type TaskPriority,
  TASK_PRIORITIES,
} from "../utils/project-memory.js";
import { normalizeIdentifier, slugify } from "../utils/slug.js";
import { PROJECT_DOC_FILES, type ProjectDocType } from "../utils/project-documents.js";
import { findBestMatch, normalizeWorkspacePath, type WorkspaceProject } from "../utils/workspace-match.js";
import { getTemplatePath, renderTemplate } from "../utils/template.js";
import { buildProjectRetrievalIndex } from "../retrieval/index-builder.js";
import { deriveOperatingBrief, safeTime } from "../utils/workflow-policy.js";
import {
  createWriteProposal,
  consumeWriteProposalToken,
  requireWriteGate,
  WriteGateError,
} from "../utils/write-gate.js";
import { cancelLoop, findActiveLoop, readLoopState, startLoop } from "../utils/loop-state.js";

const DAG_COMMANDS = [
  "context",
  "task",
  "plan",
  "knowledge",
  "search",
  "diagram",
  "batch",
  "validate",
  "project",
  "write",
  "doc",
  "dependency",
  "paths",
  "loop",
  "lint-bundle",
  "deploy-superpowers",
  "sync-agents-md",
  "audit",
  "diff",
  "git-log",
] as const;

type DagCommand = (typeof DAG_COMMANDS)[number];

function printUsage(): void {
  console.log("Usage: spoc <command> [options]\n");
  console.log("DAG Commands:");
  console.log("  context [<path>]                    Resolve project context");
  console.log("  task <slug> [--status=<s>]          List tasks (positional slug)");
  console.log("  task list --slug=<slug>             List tasks (flag syntax)");
  console.log("  task get <slug> <taskId>            Get task details");
  console.log("  task transition <slug> <id> <s>     Transition task status");
  console.log("  plan <slug> [--status=<s>]          List plans (positional slug)");
  console.log("  plan list --slug=<slug>             List plans (flag syntax)");
  console.log("  plan get <slug> <planId> [--body]   Get plan details");
  console.log("  knowledge <slug> [--kind=<k>]       List knowledge (positional slug)");
  console.log("  knowledge list --slug=<slug>        List knowledge (flag syntax)");
  console.log("  knowledge search <slug> <query>     Search knowledge");
  console.log("  knowledge create --slug=<s> ...     Create knowledge entry");
  console.log("  search <slug> <query>               BM25 search across all");
  console.log("  diagram <action> <path>             Inspect/ready diagram");
  console.log("  batch --file=<path>                 Batch operations");
  console.log("  validate <slug>                     Validate project state");
  console.log("\nOptions:");
  console.log("  --json    Output as JSON");
  console.log("  --help    Show command usage");
}

interface ParsedArgs {
  json: boolean;
  rest: string[];
}

function parseFlags(args: string[]): ParsedArgs {
  const rest: string[] = [];
  let json = false;

  for (const arg of args) {
    if (arg === "--json") {
      json = true;
    } else {
      rest.push(arg);
    }
  }

  return { json, rest };
}

function extractFlag(args: string[], flag: string): string | undefined {
  const found = args.find((a) => a.startsWith(`${flag}=`));
  if (!found) return undefined;
  return found.split("=")[1];
}

function cliError(msg: string): void {
  console.error(msg);
}

// ---------------------------------------------------------------------------
// context command
// ---------------------------------------------------------------------------

function formatFileRefs(sourceFiles?: FileRef[]): string {
  if (!sourceFiles || sourceFiles.length === 0) return "";
  const formatted = sourceFiles
    .map((f) => (f.anchor ? `${f.path}#${f.anchor}` : f.path))
    .join(", ");
  return `\n  Files: ${formatted}`;
}

async function handleContext(args: string[], json: boolean): Promise<void> {
  const queryPath = args[0] ?? process.cwd();

  if (!queryPath.startsWith("/")) {
    cliError(`Error: path must be absolute, got "${queryPath}"`);
    return;
  }

  const dataDir = getDataDir();
  let rootMeta;
  try {
    rootMeta = await readRootMeta(dataDir);
  } catch {
    cliError("Error: could not read SPOC data directory");
    return;
  }

  type ProjectMetaValidated = {
    id: string;
    name: string;
    description: string;
    createdAt: string;
    workspacePaths: string[];
    status?: string;
    repoUrl?: string;
  };
  const workspaceProjects: WorkspaceProject[] = [];
  const projectMetas = new Map<string, ProjectMetaValidated>();

  for (const node of rootMeta.projects) {
    const metaPath = resolve(dataDir, "projects", node.id, "meta.json");
    if (!existsSync(metaPath)) continue;

    const raw = await readJsonSafe<unknown>(metaPath);
    if (raw === undefined) continue;
    const meta = validateJson(raw, projectMetaSchema, metaPath) as ProjectMetaValidated;
    const paths = Array.isArray(meta.workspacePaths) ? meta.workspacePaths : [];

    if (paths.length > 0) {
      workspaceProjects.push({ slug: node.id, workspacePaths: paths });
      projectMetas.set(node.id, meta);
    }
  }

  const matchResult = findBestMatch(queryPath, workspaceProjects);

  if (matchResult.kind === "none") {
    cliError(`Error: no project found matching path "${queryPath}"`);
    return;
  }
  if (matchResult.kind === "ambiguous") {
    cliError(`Error: ambiguous match for "${queryPath}" — matches: ${matchResult.slugs.join(", ")}`);
    return;
  }

  const slug = matchResult.slug;
  const projectDir = getProjectDir(slug);
  const meta = projectMetas.get(slug);
  const name = meta?.name ?? slug;
  const description = meta?.description ?? "";

  if (json) {
    // Build JSON output
    const overviewPath = resolve(projectDir, "overview.md");
    let overview: string | null = null;
    if (existsSync(overviewPath)) {
      const overviewRaw = await readFile(overviewPath, "utf-8");
      overview = extractOverviewContent(overviewRaw);
    }
    const knowledgeIndex = await readKnowledgeIndex(projectDir);
    const planIndex = await readPlanIndex(projectDir);
    const allTasks = await listTasks(projectDir);

    console.log(JSON.stringify({
      slug,
      name,
      description,
      overview,
      tasks: allTasks,
      plans: planIndex.plans,
      knowledge: knowledgeIndex.entries,
    }));
    return;
  }

  // Assemble markdown context (same as resolve-context tool)
  const sections: string[] = [];
  sections.push(`# Project Context: ${name}`);
  if (description) sections.push(`\n> ${description}`);

  const overviewPath = resolve(projectDir, "overview.md");
  if (existsSync(overviewPath)) {
    const overviewRaw = await readFile(overviewPath, "utf-8");
    const overviewContent = extractOverviewContent(overviewRaw);
    if (overviewContent) sections.push(`\n## Overview\n\n${overviewContent}`);
  }

  const tasksPath = resolve(projectDir, "tasks.md");
  const tasksRaw = existsSync(tasksPath) ? await readFile(tasksPath, "utf-8") : "";

  const knowledgeIndex = await readKnowledgeIndex(projectDir);
  if (knowledgeIndex.entries.length > 0) {
    const sorted = [...knowledgeIndex.entries].sort(
      (a, b) => safeTime(b.updatedAt) - safeTime(a.updatedAt),
    );
    const top = sorted.slice(0, 10);
    const bullets = top
      .map((e) => {
        const summary = e.summary ? `: ${e.summary}` : "";
        return `- **${e.title}**${summary}${formatFileRefs(e.sourceFiles)}`;
      })
      .join("\n");
    sections.push(`\n## Key Knowledge\n\n${bullets}`);
  }

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

  if (activePlans.length > 0) {
    const bullets = activePlans
      .map((p) => `- **${p.title}** (${p.status})${p.summary ? `: ${p.summary}` : ""}`)
      .join("\n");
    sections.push(`\n## Active Plans\n\n${bullets}`);
  }

  const allTasks = await listTasks(projectDir);
  const activeTasksList = allTasks.filter(
    (t) => t.status === "in_progress" || t.status === "backlog",
  );
  if (activeTasksList.length > 0) {
    const taskLines = activeTasksList.map((task) => {
      const marker = task.status === "in_progress" ? "[/]" : "[ ]";
      return `- ${marker} **[${task.priority}]** ${task.title}`;
    });
    sections.push(`\n## Active Tasks\n\n${taskLines.join("\n")}`);
  }

  console.log(sections.join("\n"));
}

// ---------------------------------------------------------------------------
// task command
// ---------------------------------------------------------------------------

async function handleTask(args: string[], json: boolean): Promise<void> {
  const subcommand = args[0];

  switch (subcommand) {
    case "list":
      return handleTaskList(args.slice(1), json);
    case "get":
      return handleTaskGet(args.slice(1), json);
    case "transition":
      return handleTaskTransition(args.slice(1), json);
    case "create":
      return handleTaskCreate(args.slice(1), json);
    case "update":
      return handleTaskUpdate(args.slice(1), json);
    case "delete":
      return handleTaskDelete(args.slice(1), json);
    default:
      // If subcommand isn't a known command, treat it as a slug for listing
      if (subcommand && !['list', 'get', 'transition', 'create', 'update', 'delete'].includes(subcommand)) {
        return handleTaskList(args.slice(1), json, subcommand);
      }
      cliError(`Error: unknown task subcommand "${subcommand ?? ""}". Use: list, get, transition, create, update, delete`);
  }
}

async function handleTaskList(args: string[], json: boolean, slugOverride?: string): Promise<void> {
  const slug = slugOverride ?? extractFlag(args, "--slug");
  if (!slug) {
    cliError("Error: --slug is required for task list");
    return;
  }

  const projectDir = getProjectDir(slug);
  if (!existsSync(projectDir)) {
    cliError(`Error: project "${slug}" not found`);
    return;
  }

  const status = extractFlag(args, "--status") as TaskStatus | undefined;
  const priority = extractFlag(args, "--priority") as TaskPriority | undefined;

  if (status && !(TASK_STATUSES as readonly string[]).includes(status)) {
    cliError(`Error: invalid status "${status}". Valid: ${TASK_STATUSES.join(", ")}`);
    return;
  }
  if (priority && !(TASK_PRIORITIES as readonly string[]).includes(priority)) {
    cliError(`Error: invalid priority "${priority}". Valid: ${TASK_PRIORITIES.join(", ")}`);
    return;
  }

  const tasks = await listTasks(projectDir, { status, priority });

  if (json) {
    console.log(JSON.stringify(tasks));
    return;
  }

  if (tasks.length === 0) {
    console.log("No tasks found.");
    return;
  }

  // Table format
  console.log("ID\tTitle\tStatus\tPriority");
  for (const t of tasks) {
    console.log(`${t.id}\t${t.title}\t${t.status}\t${t.priority}`);
  }
}

async function handleTaskGet(args: string[], json: boolean): Promise<void> {
  const slug = args[0];
  const taskId = args[1];

  if (!slug || !taskId) {
    cliError("Error: usage: spoc task get <slug> <taskId>");
    return;
  }

  const projectDir = getProjectDir(slug);
  if (!existsSync(projectDir)) {
    cliError(`Error: project "${slug}" not found`);
    return;
  }

  try {
    const task = await getTask(projectDir, taskId);
    if (json) {
      console.log(JSON.stringify(task));
    } else {
      console.log(`ID:       ${task.id}`);
      console.log(`Title:    ${task.title}`);
      console.log(`Status:   ${task.status}`);
      console.log(`Priority: ${task.priority}`);
      if (task.planId) console.log(`Plan:     ${task.planId}`);
      console.log(`Created:  ${task.createdAt}`);
      console.log(`Updated:  ${task.updatedAt}`);
    }
  } catch (err) {
    cliError(`Error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function handleTaskTransition(args: string[], json: boolean): Promise<void> {
  const slug = args[0];
  const taskId = args[1];
  const status = args[2];

  if (!slug || !taskId || !status) {
    cliError("Error: usage: spoc task transition <slug> <taskId> <status> --token=<token>");
    return;
  }

  if (!(TASK_STATUSES as readonly string[]).includes(status)) {
    cliError(`Error: invalid status "${status}". Valid: ${TASK_STATUSES.join(", ")}`);
    return;
  }

  const token = extractFlag(args, "--token");
  try {
    requireWriteGate(token, slug, "tool:transition_project_task");
  } catch (err) {
    if (err instanceof WriteGateError) {
      cliError(`Error: ${err.message}`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  const projectDir = getProjectDir(slug);
  if (!existsSync(projectDir)) {
    cliError(`Error: project "${slug}" not found`);
    return;
  }

  try {
    const currentTask = await getTask(projectDir, taskId);
    const previousStatus = currentTask.status;

    await updateTask(projectDir, { id: taskId, status: status as TaskStatus });

    if (json) {
      console.log(JSON.stringify({ taskId, previousStatus, newStatus: status }));
    } else {
      console.log(`Task "${taskId}" transitioned: ${previousStatus} → ${status}`);
    }
  } catch (err) {
    cliError(`Error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function handleTaskCreate(args: string[], json: boolean): Promise<void> {
  const slug = args[0];
  const title = args[1];

  if (!slug || !title) {
    cliError("Error: usage: spoc task create <slug> <title> [--plan-id=<id>] [--priority=high|medium|low] [--status=backlog|in_progress|done] --token=<token>");
    return;
  }

  const token = extractFlag(args, "--token");
  try {
    requireWriteGate(token, slug, "tool:create_project_task");
  } catch (err) {
    if (err instanceof WriteGateError) {
      cliError(`Error: ${err.message}`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  const projectDir = getProjectDir(slug);
  if (!existsSync(projectDir)) {
    cliError(`Error: project "${slug}" not found`);
    return;
  }

  const planId = extractFlag(args, "--plan-id") ?? undefined;
  const priority = (extractFlag(args, "--priority") ?? undefined) as TaskPriority | undefined;
  const status = (extractFlag(args, "--status") ?? undefined) as TaskStatus | undefined;

  if (priority && !(TASK_PRIORITIES as readonly string[]).includes(priority)) {
    cliError(`Error: invalid priority "${priority}". Valid: ${TASK_PRIORITIES.join(", ")}`);
    return;
  }
  if (status && !(TASK_STATUSES as readonly string[]).includes(status)) {
    cliError(`Error: invalid status "${status}". Valid: ${TASK_STATUSES.join(", ")}`);
    return;
  }

  try {
    const task = await createTask(projectDir, {
      title,
      ...(planId && { planId }),
      ...(priority && { priority }),
      ...(status && { status }),
    });

    if (json) {
      console.log(JSON.stringify(task));
    } else {
      console.log(`Task created: ${task.id} ("${task.title}")`);
    }
  } catch (err) {
    cliError(`Error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function handleTaskUpdate(args: string[], json: boolean): Promise<void> {
  const slug = args[0];
  const taskId = args[1];

  if (!slug || !taskId) {
    cliError("Error: usage: spoc task update <slug> <taskId> [--title=<t>] [--status=<s>] [--priority=<p>] [--plan-id=<id>] --token=<token>");
    return;
  }

  const token = extractFlag(args, "--token");
  try {
    requireWriteGate(token, slug, "tool:update_project_task");
  } catch (err) {
    if (err instanceof WriteGateError) {
      cliError(`Error: ${err.message}`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  const projectDir = getProjectDir(slug);
  if (!existsSync(projectDir)) {
    cliError(`Error: project "${slug}" not found`);
    return;
  }

  const title = extractFlag(args, "--title") ?? undefined;
  const status = (extractFlag(args, "--status") ?? undefined) as TaskStatus | undefined;
  const priority = (extractFlag(args, "--priority") ?? undefined) as TaskPriority | undefined;
  const planId = extractFlag(args, "--plan-id") ?? undefined;

  if (status && !(TASK_STATUSES as readonly string[]).includes(status)) {
    cliError(`Error: invalid status "${status}". Valid: ${TASK_STATUSES.join(", ")}`);
    return;
  }
  if (priority && !(TASK_PRIORITIES as readonly string[]).includes(priority)) {
    cliError(`Error: invalid priority "${priority}". Valid: ${TASK_PRIORITIES.join(", ")}`);
    return;
  }

  try {
    const task = await updateTask(projectDir, {
      id: taskId,
      ...(title && { title }),
      ...(status && { status }),
      ...(priority && { priority }),
      ...(planId && { planId }),
    });

    if (json) {
      console.log(JSON.stringify(task));
    } else {
      console.log(`Task updated: ${task.id}`);
    }
  } catch (err) {
    cliError(`Error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function handleTaskDelete(args: string[], json: boolean): Promise<void> {
  const slug = args[0];
  const taskId = args[1];

  if (!slug || !taskId) {
    cliError("Error: usage: spoc task delete <slug> <taskId> --token=<token>");
    return;
  }

  const token = extractFlag(args, "--token");
  try {
    requireWriteGate(token, slug, "tool:delete_project_task");
  } catch (err) {
    if (err instanceof WriteGateError) {
      cliError(`Error: ${err.message}`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  const projectDir = getProjectDir(slug);
  if (!existsSync(projectDir)) {
    cliError(`Error: project "${slug}" not found`);
    return;
  }

  try {
    await deleteTask(projectDir, taskId);

    if (json) {
      console.log(JSON.stringify({ deleted: taskId }));
    } else {
      console.log(`Task deleted: ${taskId}`);
    }
  } catch (err) {
    cliError(`Error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// search command
// ---------------------------------------------------------------------------

async function handlePlanCreate(args: string[], json: boolean): Promise<void> {
  const slug = args[0];
  const title = args[1];

  if (!slug) {
    cliError("Error: usage: spoc plan create <slug> <title> [--status=<s>] [--summary=<s>] [--keywords=<k1,k2>] [--body-file=<path>] --token=<token>");
    return;
  }
  if (!title) {
    cliError("Error: <title> is required");
    return;
  }

  const token = extractFlag(args, "--token");
  try {
    requireWriteGate(token, slug, "tool:create_project_plan");
  } catch (err) {
    if (err instanceof WriteGateError) {
      cliError(`Error: ${err.message}`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  const projectDir = getProjectDir(slug);
  if (!existsSync(projectDir)) {
    cliError(`Error: project "${slug}" not found`);
    return;
  }

  const status = (extractFlag(args, "--status") ?? "proposed") as PlanStatus;
  if (!(PLAN_STATUSES as readonly string[]).includes(status)) {
    cliError(`Error: invalid status "${status}". Valid: ${PLAN_STATUSES.join(", ")}`);
    return;
  }

  const summary = extractFlag(args, "--summary");
  const keywordsRaw = extractFlag(args, "--keywords");
  const keywords = keywordsRaw ? keywordsRaw.split(",").map((k) => k.trim()) : [];
  const bodyFile = extractFlag(args, "--body-file");
  let content: string | undefined;
  if (bodyFile) {
    if (!existsSync(bodyFile)) {
      cliError(`Error: body file not found: ${bodyFile}`);
      return;
    }
    content = readFileSync(bodyFile, "utf-8");
  }

  const id = normalizeIdentifier(title);

  try {
    const meta = await createPlan(projectDir, {
      id,
      title,
      status,
      keywords,
      summary,
      content,
    });

    if (json) {
      console.log(JSON.stringify(meta));
    } else {
      console.log(`Created plan: ${meta.id}`);
    }
  } catch (err) {
    cliError(`Error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function handlePlanUpdateMeta(args: string[], json: boolean): Promise<void> {
  const slug = args[0];
  const planId = args[1];

  if (!slug || !planId) {
    cliError("Error: usage: spoc plan update-meta <slug> <planId> [--title=<t>] [--status=<s>] [--summary=<s>] [--keywords=<k1,k2>] --token=<token>");
    return;
  }

  const token = extractFlag(args, "--token");
  try {
    requireWriteGate(token, slug, "tool:update_project_plan_meta");
  } catch (err) {
    if (err instanceof WriteGateError) {
      cliError(`Error: ${err.message}`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  const projectDir = getProjectDir(slug);
  if (!existsSync(projectDir)) {
    cliError(`Error: project "${slug}" not found`);
    return;
  }

  const title = extractFlag(args, "--title");
  const status = extractFlag(args, "--status") as PlanStatus | undefined;
  if (status && !(PLAN_STATUSES as readonly string[]).includes(status)) {
    cliError(`Error: invalid status "${status}". Valid: ${PLAN_STATUSES.join(", ")}`);
    return;
  }
  const summary = extractFlag(args, "--summary");
  const keywordsRaw = extractFlag(args, "--keywords");
  const keywords = keywordsRaw ? keywordsRaw.split(",").map((k) => k.trim()) : undefined;

  try {
    const meta = await updatePlan(projectDir, {
      id: planId,
      title,
      status,
      summary,
      keywords,
    });

    if (json) {
      console.log(JSON.stringify(meta));
    } else {
      console.log(`Updated plan: ${meta.id}`);
    }
  } catch (err) {
    cliError(`Error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function handlePlanUpdateBody(args: string[], json: boolean): Promise<void> {
  const slug = args[0];
  const planId = args[1];

  if (!slug || !planId) {
    cliError("Error: usage: spoc plan update-body <slug> <planId> --body-file=<path> --token=<token>");
    return;
  }

  const token = extractFlag(args, "--token");
  try {
    requireWriteGate(token, slug, "tool:update_project_plan_body");
  } catch (err) {
    if (err instanceof WriteGateError) {
      cliError(`Error: ${err.message}`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  const projectDir = getProjectDir(slug);
  if (!existsSync(projectDir)) {
    cliError(`Error: project "${slug}" not found`);
    return;
  }

  const bodyFile = extractFlag(args, "--body-file");
  if (!bodyFile) {
    cliError("Error: --body-file is required");
    return;
  }
  if (!existsSync(bodyFile)) {
    cliError(`Error: body file not found: ${bodyFile}`);
    return;
  }

  const planIndex = await readPlanIndex(projectDir);
  const normalizedId = normalizeIdentifier(planId);
  const plan = planIndex.plans.find((p) => p.id === planId || p.normalizedId === normalizedId);
  if (!plan) {
    cliError(`Error: plan "${planId}" not found`);
    return;
  }

  const body = readFileSync(bodyFile, "utf-8");
  const bodyPath = resolve(projectDir, plan.file);

  try {
    await writeFile(bodyPath, body, "utf-8");

    if (json) {
      console.log(JSON.stringify({ meta: plan, body }));
    } else {
      console.log(`Updated plan body: ${plan.id}`);
    }
  } catch (err) {
    cliError(`Error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function handlePlanDelete(args: string[], json: boolean): Promise<void> {
  const slug = args[0];
  const planId = args[1];

  if (!slug || !planId) {
    cliError("Error: usage: spoc plan delete <slug> <planId> --token=<token>");
    return;
  }

  const token = extractFlag(args, "--token");
  try {
    requireWriteGate(token, slug, "tool:delete_project_plan");
  } catch (err) {
    if (err instanceof WriteGateError) {
      cliError(`Error: ${err.message}`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  const projectDir = getProjectDir(slug);
  if (!existsSync(projectDir)) {
    cliError(`Error: project "${slug}" not found`);
    return;
  }

  try {
    await deletePlan(projectDir, planId);

    if (json) {
      console.log(JSON.stringify({ deleted: planId }));
    } else {
      console.log(`Deleted plan: ${planId}`);
    }
  } catch (err) {
    cliError(`Error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ---------------------------------------------------------------------------

async function handleSearch(args: string[], json: boolean): Promise<void> {
  const slug = args[0];
  if (!slug) {
    cliError("Error: usage: spoc search <slug> <query...> [--kind=<kind>] [--limit=N]");
    return;
  }

  const projectDir = getProjectDir(slug);
  if (!existsSync(projectDir)) {
    cliError(`Error: project "${slug}" not found`);
    return;
  }

  const kind = extractFlag(args, "--kind");
  const limitStr = extractFlag(args, "--limit");
  const limit = limitStr ? Number.parseInt(limitStr, 10) : 10;

  // Remaining args after slug, excluding flags, are the query
  const queryParts = args.slice(1).filter((a) => !a.startsWith("--"));
  if (queryParts.length === 0) {
    cliError("Error: query is required");
    return;
  }
  const query = queryParts.join(" ");

  const index = await buildProjectRetrievalIndex(slug);
  let results = index.searchAll(query, limit);

  // Post-filter by kind if specified
  if (kind) {
    results = results.filter((r) => r.type === kind);
  }

  if (json) {
    console.log(JSON.stringify(results));
    return;
  }

  if (results.length === 0) {
    console.log("No results found.");
    return;
  }

  console.log("ID\tType\tTitle\tScore");
  for (const r of results) {
    console.log(`${r.id}\t${r.type}\t${r.title}\t${r.score.toFixed(4)}`);
  }
}

// ---------------------------------------------------------------------------
// plan command
// ---------------------------------------------------------------------------

async function handlePlan(args: string[], json: boolean): Promise<void> {
  const subcommand = args[0];

  switch (subcommand) {
    case "list":
      return handlePlanList(args.slice(1), json);
    case "get":
      return handlePlanGet(args.slice(1), json);
    case "create":
      return handlePlanCreate(args.slice(1), json);
    case "update-meta":
      return handlePlanUpdateMeta(args.slice(1), json);
    case "update-body":
      return handlePlanUpdateBody(args.slice(1), json);
    case "delete":
      return handlePlanDelete(args.slice(1), json);
    default:
      // If subcommand isn't a known command, treat it as a slug for listing
      if (subcommand && !['list', 'get', 'create', 'update-meta', 'update-body', 'delete'].includes(subcommand)) {
        return handlePlanList(args.slice(1), json, subcommand);
      }
      cliError(`Error: unknown plan subcommand "${subcommand ?? ""}". Use: list, get, create, update-meta, update-body, delete`);
  }
}

async function handlePlanList(args: string[], json: boolean, slugOverride?: string): Promise<void> {
  const slug = slugOverride ?? extractFlag(args, "--slug");
  if (!slug) {
    cliError("Error: --slug is required for plan list");
    return;
  }

  const projectDir = getProjectDir(slug);
  if (!existsSync(projectDir)) {
    cliError(`Error: project "${slug}" not found`);
    return;
  }

  const status = extractFlag(args, "--status") as PlanStatus | undefined;
  if (status && !(PLAN_STATUSES as readonly string[]).includes(status)) {
    cliError(`Error: invalid status "${status}". Valid: ${PLAN_STATUSES.join(", ")}`);
    return;
  }

  const planIndex = await readPlanIndex(projectDir);
  let plans = planIndex.plans;

  if (status) {
    plans = plans.filter((p) => p.status === status);
  }

  if (json) {
    console.log(JSON.stringify(plans));
    return;
  }

  if (plans.length === 0) {
    console.log("No plans found.");
    return;
  }

  console.log("ID\tTitle\tStatus");
  for (const p of plans) {
    console.log(`${p.id}\t${p.title}\t${p.status}`);
  }
}

async function handlePlanGet(args: string[], json: boolean): Promise<void> {
  const slug = args[0];
  const planId = args[1];

  if (!slug || !planId) {
    cliError("Error: usage: spoc plan get <slug> <planId> [--body]");
    return;
  }

  const projectDir = getProjectDir(slug);
  if (!existsSync(projectDir)) {
    cliError(`Error: project "${slug}" not found`);
    return;
  }

  const planIndex = await readPlanIndex(projectDir);
  const plan = planIndex.plans.find((p) => p.id === planId || p.normalizedId === planId);

  if (!plan) {
    cliError(`Error: plan "${planId}" not found`);
    return;
  }

  const includeBody = args.includes("--body");
  let body: string | undefined;
  if (includeBody) {
    const bodyPath = resolve(projectDir, plan.file);
    if (existsSync(bodyPath)) {
      body = await readFile(bodyPath, "utf-8");
    }
  }

  if (json) {
    console.log(JSON.stringify(includeBody ? { ...plan, body } : plan));
    return;
  }

  console.log(`ID:       ${plan.id}`);
  console.log(`Title:    ${plan.title}`);
  console.log(`Status:   ${plan.status}`);
  console.log(`Summary:  ${plan.summary}`);
  console.log(`Keywords: ${plan.keywords.join(", ")}`);
  if (body) {
    console.log(`\n--- Body ---\n${body}`);
  }
}

// ---------------------------------------------------------------------------
// knowledge command
// ---------------------------------------------------------------------------

async function handleKnowledge(args: string[], json: boolean): Promise<void> {
  const subcommand = args[0];

  switch (subcommand) {
    case "list":
      return handleKnowledgeList(args.slice(1), json);
    case "search":
      return handleKnowledgeSearch(args.slice(1), json);
    case "create":
      return handleKnowledgeCreate(args.slice(1), json);
    case "get":
      return handleKnowledgeGet(args.slice(1), json);
    case "update-meta":
      return handleKnowledgeUpdateMeta(args.slice(1), json);
    case "update-body":
      return handleKnowledgeUpdateBody(args.slice(1), json);
    case "delete":
      return handleKnowledgeDelete(args.slice(1), json);
    default:
      // If subcommand isn't a known command, treat it as a slug for listing
      if (subcommand && !['list', 'search', 'create', 'get', 'update-meta', 'update-body', 'delete'].includes(subcommand)) {
        return handleKnowledgeList(args.slice(1), json, subcommand);
      }
      cliError(`Error: unknown knowledge subcommand "${subcommand ?? ""}". Use: list, search, create, get, update-meta, update-body, delete`);
  }
}

async function handleKnowledgeList(args: string[], json: boolean, slugOverride?: string): Promise<void> {
  const slug = slugOverride ?? extractFlag(args, "--slug");
  if (!slug) {
    cliError("Error: --slug is required for knowledge list");
    return;
  }

  const projectDir = getProjectDir(slug);
  if (!existsSync(projectDir)) {
    cliError(`Error: project "${slug}" not found`);
    return;
  }

  const kind = extractFlag(args, "--kind") as KnowledgeKind | undefined;
  if (kind && !(KNOWLEDGE_KINDS as readonly string[]).includes(kind)) {
    cliError(`Error: invalid kind "${kind}". Valid: ${KNOWLEDGE_KINDS.join(", ")}`);
    return;
  }

  const knowledgeIndex = await readKnowledgeIndex(projectDir);
  let entries = knowledgeIndex.entries;

  if (kind) {
    entries = entries.filter((e) => e.kind === kind);
  }

  if (json) {
    console.log(JSON.stringify(entries));
    return;
  }

  if (entries.length === 0) {
    console.log("No knowledge entries found.");
    return;
  }

  console.log("ID\tKind\tTitle");
  for (const e of entries) {
    console.log(`${e.id}\t${e.kind}\t${e.title}`);
  }
}

async function handleKnowledgeSearch(args: string[], json: boolean): Promise<void> {
  const slug = args[0];
  if (!slug) {
    cliError("Error: usage: spoc knowledge search <slug> <query...> [--kind=<kind>] [--limit=N]");
    return;
  }

  const projectDir = getProjectDir(slug);
  if (!existsSync(projectDir)) {
    cliError(`Error: project "${slug}" not found`);
    return;
  }

  const kind = extractFlag(args, "--kind") as KnowledgeKind | undefined;
  const limitStr = extractFlag(args, "--limit");
  const limit = limitStr ? Number.parseInt(limitStr, 10) : 10;

  const queryParts = args.slice(1).filter((a) => !a.startsWith("--"));
  if (queryParts.length === 0) {
    cliError("Error: query is required");
    return;
  }
  const query = queryParts.join(" ");

  const index = await buildProjectRetrievalIndex(slug);
  let results = index.searchKnowledge(query, limit);

  if (kind) {
    // Post-filter by kind using the knowledge index
    const knowledgeIndex = await readKnowledgeIndex(projectDir);
    const kindSet = new Set(
      knowledgeIndex.entries.filter((e) => e.kind === kind).map((e) => e.id),
    );
    results = results.filter((r) => kindSet.has(r.id));
  }

  if (json) {
    console.log(JSON.stringify(results));
    return;
  }

  if (results.length === 0) {
    console.log("No results found.");
    return;
  }

  console.log("ID\tTitle\tScore");
  for (const r of results) {
    console.log(`${r.id}\t${r.title}\t${r.score.toFixed(4)}`);
  }
}

async function handleKnowledgeCreate(args: string[], json: boolean): Promise<void> {
  const slug = extractFlag(args, "--slug");
  const title = extractFlag(args, "--title");
  const kind = extractFlag(args, "--kind") as KnowledgeKind | undefined;
  const body = extractFlag(args, "--body");
  const keywordsRaw = extractFlag(args, "--keywords");

  if (!slug) {
    cliError("Error: --slug is required");
    return;
  }
  if (!title) {
    cliError("Error: --title is required");
    return;
  }
  if (!kind) {
    cliError("Error: --kind is required");
    return;
  }
  if (!(KNOWLEDGE_KINDS as readonly string[]).includes(kind)) {
    cliError(`Error: invalid kind "${kind}". Valid: ${KNOWLEDGE_KINDS.join(", ")}`);
    return;
  }

  const token = extractFlag(args, "--token");
  try {
    requireWriteGate(token, slug, "tool:create_project_knowledge_entry");
  } catch (err) {
    if (err instanceof WriteGateError) {
      cliError(`Error: ${err.message}`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  const projectDir = getProjectDir(slug);
  if (!existsSync(projectDir)) {
    cliError(`Error: project "${slug}" not found`);
    return;
  }

  const keywords = keywordsRaw ? keywordsRaw.split(",").map((k) => k.trim()) : [];
  const id = normalizeIdentifier(title);

  try {
    const entry = await createKnowledgeEntry(projectDir, {
      id,
      title,
      kind,
      keywords,
      content: body,
    });

    if (json) {
      console.log(JSON.stringify(entry));
    } else {
      console.log(`Created knowledge entry: ${entry.id}`);
    }
  } catch (err) {
    cliError(`Error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function handleKnowledgeGet(args: string[], json: boolean): Promise<void> {
  const slug = args[0];
  const entryId = args[1];
  if (!slug || !entryId) {
    cliError("Error: usage: spoc knowledge get <slug> <entryId> [--body] [--json]");
    return;
  }

  const projectDir = getProjectDir(slug);
  if (!existsSync(projectDir)) {
    cliError(`Error: project "${slug}" not found`);
    return;
  }

  const normalizedId = normalizeIdentifier(entryId);
  const metaPath = resolve(projectDir, "knowledge", `${normalizedId}.meta.json`);

  if (!existsSync(metaPath)) {
    cliError(`Error: knowledge entry "${entryId}" not found`);
    return;
  }

  const raw = await readJsonSafe<unknown>(metaPath);
  if (raw === undefined) {
    cliError(`Error: unable to parse meta for "${entryId}"`);
    return;
  }
  const meta = validateJson(raw, knowledgeMetaSchema, metaPath);

  const includeBody = args.includes("--body");
  if (includeBody) {
    const bodyPath = resolve(projectDir, meta.file);
    const body = existsSync(bodyPath) ? readFileSync(bodyPath, "utf-8") : "";
    if (json) {
      console.log(JSON.stringify({ meta, body }));
    } else {
      console.log(`ID: ${meta.id}`);
      console.log(`Title: ${meta.title}`);
      console.log(`Kind: ${meta.kind}`);
      console.log(`Keywords: ${meta.keywords.join(", ")}`);
      if (meta.summary) console.log(`Summary: ${meta.summary}`);
      console.log(`---`);
      console.log(body);
    }
  } else {
    if (json) {
      console.log(JSON.stringify({ meta }));
    } else {
      console.log(`ID: ${meta.id}`);
      console.log(`Title: ${meta.title}`);
      console.log(`Kind: ${meta.kind}`);
      console.log(`Keywords: ${meta.keywords.join(", ")}`);
      if (meta.summary) console.log(`Summary: ${meta.summary}`);
    }
  }
}

async function handleKnowledgeUpdateMeta(args: string[], json: boolean): Promise<void> {
  const slug = args[0];
  const entryId = args[1];
  if (!slug || !entryId) {
    cliError("Error: usage: spoc knowledge update-meta <slug> <entryId> [--title=<t>] [--kind=<k>] [--summary=<s>] [--keywords=<k1,k2>] --token=<token> [--json]");
    return;
  }

  const token = extractFlag(args, "--token");
  try {
    requireWriteGate(token, slug, "tool:update_project_knowledge_meta");
  } catch (err) {
    if (err instanceof WriteGateError) {
      cliError(`Error: ${err.message}`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  const projectDir = getProjectDir(slug);
  if (!existsSync(projectDir)) {
    cliError(`Error: project "${slug}" not found`);
    return;
  }

  const title = extractFlag(args, "--title");
  const kind = extractFlag(args, "--kind") as KnowledgeKind | undefined;
  const summary = extractFlag(args, "--summary");
  const keywordsRaw = extractFlag(args, "--keywords");

  if (kind && !(KNOWLEDGE_KINDS as readonly string[]).includes(kind)) {
    cliError(`Error: invalid kind "${kind}". Valid: ${KNOWLEDGE_KINDS.join(", ")}`);
    return;
  }

  const keywords = keywordsRaw ? keywordsRaw.split(",").map((k) => k.trim()) : undefined;

  try {
    const meta = await updateKnowledgeEntry(projectDir, {
      id: entryId,
      title: title || undefined,
      kind: kind || undefined,
      summary: summary || undefined,
      keywords,
    });

    if (json) {
      console.log(JSON.stringify({ meta }));
    } else {
      console.log(`Updated knowledge entry: ${meta.id}`);
    }
  } catch (err) {
    cliError(`Error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function handleKnowledgeUpdateBody(args: string[], json: boolean): Promise<void> {
  const slug = args[0];
  const entryId = args[1];
  if (!slug || !entryId) {
    cliError("Error: usage: spoc knowledge update-body <slug> <entryId> --body-file=<path> --token=<token> [--json]");
    return;
  }

  const token = extractFlag(args, "--token");
  try {
    requireWriteGate(token, slug, "tool:update_project_knowledge_body");
  } catch (err) {
    if (err instanceof WriteGateError) {
      cliError(`Error: ${err.message}`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  const bodyFile = extractFlag(args, "--body-file");
  if (!bodyFile) {
    cliError("Error: --body-file is required");
    return;
  }

  if (!existsSync(bodyFile)) {
    cliError(`Error: body file not found: ${bodyFile}`);
    return;
  }

  const projectDir = getProjectDir(slug);
  if (!existsSync(projectDir)) {
    cliError(`Error: project "${slug}" not found`);
    return;
  }

  const normalizedId = normalizeIdentifier(entryId);
  const metaPath = resolve(projectDir, "knowledge", `${normalizedId}.meta.json`);

  if (!existsSync(metaPath)) {
    cliError(`Error: knowledge entry "${entryId}" not found`);
    return;
  }

  const rawMeta = await readJsonSafe<unknown>(metaPath);
  if (rawMeta === undefined) {
    cliError(`Error: unable to parse meta for "${entryId}"`);
    return;
  }
  const existingMeta = validateJson(rawMeta, knowledgeMetaSchema, metaPath);
  const bodyPath = resolve(projectDir, existingMeta.file);
  const body = readFileSync(bodyFile, "utf-8");

  await writeFile(bodyPath, body, "utf-8");
  const meta = await updateKnowledgeEntry(projectDir, { id: entryId });

  if (json) {
    console.log(JSON.stringify({ meta, body }));
  } else {
    console.log(`Updated body for knowledge entry: ${meta.id}`);
  }
}

async function handleKnowledgeDelete(args: string[], json: boolean): Promise<void> {
  const slug = args[0];
  const entryId = args[1];
  if (!slug || !entryId) {
    cliError("Error: usage: spoc knowledge delete <slug> <entryId> --token=<token> [--json]");
    return;
  }

  const token = extractFlag(args, "--token");
  try {
    requireWriteGate(token, slug, "tool:delete_project_knowledge_entry");
  } catch (err) {
    if (err instanceof WriteGateError) {
      cliError(`Error: ${err.message}`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  const projectDir = getProjectDir(slug);
  if (!existsSync(projectDir)) {
    cliError(`Error: project "${slug}" not found`);
    return;
  }

  try {
    await deleteKnowledgeEntry(projectDir, entryId);
    if (json) {
      console.log(JSON.stringify({ deleted: entryId, slug }));
    } else {
      console.log(`Deleted knowledge entry: ${entryId}`);
    }
  } catch (err) {
    cliError(`Error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// diagram command
// ---------------------------------------------------------------------------

function resolveSlugFromCwd(): string | null {
  const cwd = process.cwd();
  const dataDir = getDataDir();
  const metaPath = resolve(dataDir, "meta.json");
  if (!existsSync(metaPath)) return null;

  let rootMeta: { projects?: Array<{ id: string }> };
  try {
    rootMeta = JSON.parse(readFileSync(metaPath, "utf-8"));
  } catch {
    return null;
  }
  if (!rootMeta.projects) return null;

  for (const node of rootMeta.projects) {
    const projMetaPath = resolve(dataDir, "projects", node.id, "meta.json");
    if (!existsSync(projMetaPath)) continue;
    try {
      const projMeta = JSON.parse(readFileSync(projMetaPath, "utf-8"));
      const paths: string[] = Array.isArray(projMeta.workspacePaths)
        ? projMeta.workspacePaths
        : [];
      for (const wp of paths) {
        const resolved = wp.startsWith("~")
          ? resolve(homedir(), wp.slice(2))
          : resolve(wp);
        if (cwd === resolved || cwd.startsWith(resolved + "/")) {
          return node.id;
        }
      }
    } catch {
      continue;
    }
  }
  return null;
}

function findDiagramScript(): string | undefined {
  const localPath = resolve(import.meta.dirname, "../../opencode/spoc/skills/to-diagram/scripts/manage-diagram.mjs");
  if (existsSync(localPath)) return localPath;

  const configPath = resolve(homedir(), ".config/opencode/skills/spoc/to-diagram/scripts/manage-diagram.mjs");
  if (existsSync(configPath)) return configPath;

  return undefined;
}

async function handleDiagram(args: string[], json: boolean): Promise<void> {
  const subcommand = args[0];

  // No subcommand: auto-start preview for current project
  if (!subcommand) {
    const slug = resolveSlugFromCwd();
    if (!slug) {
      cliError("Error: no SPOC project found for current directory.");
      return;
    }
    const { handlePreviewCli } = await import("./preview.js");
    await handlePreviewCli(["--project", slug, "--open"]);
    return;
  }

  // `spoc diagram show <path>` — render tree in terminal
  if (subcommand === "show") {
    const path = args[1];
    if (!path) {
      cliError("Error: usage: spoc diagram show <path>");
      return;
    }
    if (!existsSync(path)) {
      cliError(`Error: file not found: ${path}`);
      return;
    }
    try {
      const { renderDiagramShow } = await import("./diagram-renderer.js");
      const output = renderDiagramShow(path);
      console.log(output);
    } catch (err) {
      cliError(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  if (subcommand !== "inspect" && subcommand !== "ready") {
    cliError(`Error: unknown diagram subcommand "${subcommand}". Use: inspect, ready, show`);
    return;
  }

  const path = args[1];
  if (!path) {
    cliError(`Error: usage: spoc diagram ${subcommand} <path>`);
    return;
  }

  if (!existsSync(path)) {
    cliError(`Error: file not found: ${path}`);
    return;
  }

  const scriptPath = findDiagramScript();
  if (!scriptPath) {
    cliError("Error: manage-diagram.mjs not found");
    return;
  }

  try {
    const output = execSync(`node "${scriptPath}" ${subcommand} "${path}"`, {
      encoding: "utf-8",
      timeout: 10000,
    });
    if (json) {
      // Try to parse as JSON, otherwise wrap
      try {
        JSON.parse(output);
        console.log(output.trim());
      } catch {
        console.log(JSON.stringify({ output: output.trim() }));
      }
    } else {
      console.log(output.trim());
    }
  } catch (err) {
    const msg = err instanceof Error ? (err as { stderr?: string }).stderr || err.message : String(err);
    cliError(`Error: diagram ${subcommand} failed: ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// batch command
// ---------------------------------------------------------------------------

interface BatchOp {
  op: string;
  slug: string;
  [key: string]: unknown;
}

interface BatchResult {
  index: number;
  op: string;
  success: boolean;
  result?: unknown;
  error?: string;
}

async function handleBatch(args: string[], json: boolean): Promise<void> {
  const filePath = extractFlag(args, "--file");
  if (!filePath) {
    cliError("Error: --file is required for batch command");
    return;
  }

  if (!existsSync(filePath)) {
    cliError(`Error: batch file not found: ${filePath}`);
    return;
  }

  const token = extractFlag(args, "--token");

  let ops: BatchOp[];
  try {
    const raw = readFileSync(filePath, "utf-8");
    ops = JSON.parse(raw);
    if (!Array.isArray(ops)) {
      cliError("Error: batch file must contain a JSON array");
      return;
    }
  } catch (err) {
    cliError(`Error: failed to parse batch file: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  // Validate write gate once for the entire batch using the first op's slug
  if (ops.length > 0) {
    try {
      requireWriteGate(token, ops[0].slug, `batch`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (json) {
        console.log(JSON.stringify([{ index: 0, op: ops[0].op, success: false, error: msg }]));
      } else {
        cliError(msg);
      }
      return;
    }
  }

  const results: BatchResult[] = [];

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    try {
      switch (op.op) {
        case "task-transition": {
          const projectDir = getProjectDir(op.slug);
          const taskId = op.taskId as string;
          const status = op.status as TaskStatus;
          if (!taskId || !status) throw new Error("taskId and status required");
          await updateTask(projectDir, { id: taskId, status });
          results.push({ index: i, op: op.op, success: true, result: { taskId, status } });
          break;
        }
        case "knowledge-create": {
          const projectDir = getProjectDir(op.slug);
          const title = op.title as string;
          const kind = op.kind as KnowledgeKind;
          if (!title || !kind) throw new Error("title and kind required");
          const id = normalizeIdentifier(title);
          const entry = await createKnowledgeEntry(projectDir, {
            id,
            title,
            kind,
            keywords: (op.keywords as string[]) ?? [],
            content: op.body as string | undefined,
          });
          results.push({ index: i, op: op.op, success: true, result: { id: entry.id } });
          break;
        }
        case "task-create": {
          const projectDir = getProjectDir(op.slug);
          const title = op.title as string;
          if (!title) throw new Error("title required");
          const task = await createTask(projectDir, {
            title,
            status: op.status as TaskStatus | undefined,
            priority: op.priority as TaskPriority | undefined,
            planId: op.planId as string | undefined,
            sourceFiles: op.sourceFiles as FileRef[] | undefined,
          });
          results.push({ index: i, op: op.op, success: true, result: { taskId: task.id } });
          break;
        }
        case "task-update": {
          const projectDir = getProjectDir(op.slug);
          const taskId = op.taskId as string;
          if (!taskId) throw new Error("taskId required");
          const task = await updateTask(projectDir, {
            id: taskId,
            title: op.title as string | undefined,
            status: op.status as TaskStatus | undefined,
            priority: op.priority as TaskPriority | undefined,
            planId: op.planId as string | null | undefined,
            sourceFiles: op.sourceFiles as FileRef[] | undefined,
          });
          results.push({ index: i, op: op.op, success: true, result: { taskId: task.id, status: task.status } });
          break;
        }
        case "plan-create": {
          const projectDir = getProjectDir(op.slug);
          const title = op.title as string;
          if (!title) throw new Error("title required");
          const id = normalizeIdentifier(title);
          const plan = await createPlan(projectDir, {
            id,
            title,
            status: (op.status as PlanStatus) ?? "proposed",
            keywords: (op.keywords as string[]) ?? [],
            summary: op.summary as string | undefined,
            content: op.body as string | undefined,
            sourceFiles: op.sourceFiles as FileRef[] | undefined,
          });
          results.push({ index: i, op: op.op, success: true, result: { planId: plan.id } });
          break;
        }
        case "plan-update-meta": {
          const projectDir = getProjectDir(op.slug);
          const planId = op.planId as string;
          if (!planId) throw new Error("planId required");
          const plan = await updatePlan(projectDir, {
            id: planId,
            title: op.title as string | undefined,
            status: op.status as PlanStatus | undefined,
            summary: op.summary as string | undefined,
            keywords: op.keywords as string[] | undefined,
            sourceFiles: op.sourceFiles as FileRef[] | undefined,
          });
          results.push({ index: i, op: op.op, success: true, result: { planId: plan.id, status: plan.status } });
          break;
        }
        case "knowledge-update-meta": {
          const projectDir = getProjectDir(op.slug);
          const entryId = op.entryId as string;
          if (!entryId) throw new Error("entryId required");
          const entry = await updateKnowledgeEntry(projectDir, {
            id: entryId,
            title: op.title as string | undefined,
            kind: op.kind as KnowledgeKind | undefined,
            summary: op.summary as string | undefined,
            keywords: op.keywords as string[] | undefined,
            sourceFiles: op.sourceFiles as FileRef[] | undefined,
          });
          results.push({ index: i, op: op.op, success: true, result: { entryId: entry.id } });
          break;
        }
        case "knowledge-update-body": {
          const projectDir = getProjectDir(op.slug);
          const entryId = op.entryId as string;
          const body = op.body as string;
          if (!entryId || !body) throw new Error("entryId and body required");
          const normalizedId = normalizeIdentifier(entryId);
          const metaPath = resolve(projectDir, "knowledge", `${normalizedId}.meta.json`);
          if (!existsSync(metaPath)) throw new Error(`knowledge entry not found: ${entryId}`);
          const rawMeta = JSON.parse(readFileSync(metaPath, "utf-8"));
          const bodyPath = resolve(projectDir, rawMeta.file);
          await writeFile(bodyPath, body, "utf-8");
          results.push({ index: i, op: op.op, success: true, result: { entryId } });
          break;
        }
        case "doc-update": {
          const projectDir = getProjectDir(op.slug);
          const doc = op.doc as string;
          const content = op.content as string;
          if (!doc || !content) throw new Error("doc and content required");
          const fileName = PROJECT_DOC_FILES[doc as ProjectDocType];
          if (!fileName) throw new Error(`invalid doc type: ${doc}`);
          const filePath = resolve(projectDir, fileName);
          await writeFile(filePath, content, "utf-8");
          results.push({ index: i, op: op.op, success: true, result: { doc } });
          break;
        }
        default:
          results.push({ index: i, op: op.op, success: false, error: `Unknown op: ${op.op}` });
      }
    } catch (err) {
      results.push({
        index: i,
        op: op.op,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (json) {
    console.log(JSON.stringify(results));
  } else {
    for (const r of results) {
      const status = r.success ? "OK" : "FAIL";
      const detail = r.error ? `: ${r.error}` : "";
      console.log(`[${r.index}] ${r.op} ${status}${detail}`);
    }
  }
}

// ---------------------------------------------------------------------------
// validate command
// ---------------------------------------------------------------------------

interface ValidationIssue {
  severity: "error" | "warning" | "info";
  kind: string;
  message: string;
  file?: string;
  repair?: string;
  safeToAutoRepair: boolean;
}

async function handleValidate(args: string[], json: boolean): Promise<void> {
  const slug = extractFlag(args, "--slug") ?? args[0];
  if (!slug) {
    cliError("Error: --slug is required for validate");
    return;
  }

  const projectDir = getProjectDir(slug);
  if (!existsSync(projectDir)) {
    cliError(`Error: project "${slug}" not found`);
    return;
  }

  const metaPath = resolve(projectDir, "meta.json");
  let workspacePaths: string[] = [];
  try {
    const rawMeta = JSON.parse(readFileSync(metaPath, "utf-8"));
    workspacePaths = rawMeta.workspacePaths ?? [];
  } catch {
    // continue with empty workspace paths
  }

  const issues: ValidationIssue[] = [];
  let totalChecks = 0;

  // Check 1: Knowledge sourceFiles exist
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

  // Check 2: AGENTS.md exists in workspace paths
  for (const ws of workspacePaths) {
    totalChecks++;
    const agentsPath = resolve(ws, "AGENTS.md");
    if (!existsSync(agentsPath)) {
      issues.push({
        severity: "info",
        kind: "missing_agents_md",
        message: `No AGENTS.md found at workspace path: ${ws}`,
        file: agentsPath,
        repair: `Run sync_agents_md for project "${slug}"`,
        safeToAutoRepair: true,
      });
    }
  }

  // Check 3: Plan diagrams
  const planIndex = await readPlanIndex(projectDir);
  const plansDir = resolve(projectDir, "plans");
  const activeStatuses = ["planned", "in_progress", "blocked"];

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
    }
  }

  // Check 4: Plan status vs task completion
  const allTasks = await listTasks(projectDir);
  for (const plan of planIndex.plans) {
    if (!activeStatuses.includes(plan.status)) continue;

    const planTasks = allTasks.filter((t) => t.planId === plan.id);
    if (planTasks.length === 0) continue;

    totalChecks++;
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

  const report = {
    issues,
    summary: {
      totalChecks,
      issueCount: issues.length,
      bySeverity: {
        error: issues.filter((i) => i.severity === "error").length,
        warning: issues.filter((i) => i.severity === "warning").length,
        info: issues.filter((i) => i.severity === "info").length,
      },
    },
  };

  if (json) {
    console.log(JSON.stringify(report));
  } else {
    console.log(`Validation complete: ${report.summary.issueCount} issues found (${report.summary.totalChecks} checks)`);
    for (const issue of issues) {
      console.log(`  [${issue.severity}] ${issue.kind}: ${issue.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// project command
// ---------------------------------------------------------------------------

async function handleProject(args: string[], json: boolean): Promise<void> {
  const subcommand = args[0];

  switch (subcommand) {
    case "list":
      return handleProjectList(json);
    case "get":
      return handleProjectGet(args.slice(1), json);
    case "init":
      return handleProjectInit(args.slice(1), json);
    case "delete":
      return handleProjectDelete(args.slice(1), json);
    case "status":
      return handleProjectStatus(args.slice(1), json);
    case undefined:
      return handleProjectList(json);
    default:
      cliError(`Error: unknown project subcommand "${subcommand}". Use: list, get, init, delete, status`);
  }
}

async function handleProjectList(json: boolean): Promise<void> {
  const dataDir = getDataDir();
  let rootMeta;
  try {
    rootMeta = await readRootMeta(dataDir);
  } catch {
    cliError("Error: could not read SPOC data directory");
    return;
  }

  // Enrich with description from each project's meta.json
  const projects = [];
  for (const node of rootMeta.projects) {
    const metaPath = resolve(dataDir, "projects", node.id, "meta.json");
    let description = "";
    if (existsSync(metaPath)) {
      const raw = await readJsonSafe<Record<string, unknown>>(metaPath);
      if (raw && typeof raw.description === "string") {
        description = raw.description;
      }
    }
    projects.push({
      slug: node.id,
      name: node.name,
      status: node.status,
      description,
      dependsOn: node.dependsOn,
    });
  }

  if (json) {
    console.log(JSON.stringify(projects, null, 2));
    return;
  }

  // Formatted output
  if (projects.length === 0) {
    console.log("No projects found.");
    return;
  }

  for (const p of projects) {
    console.log(`${p.slug} (${p.status})`);
    console.log(`  Name: ${p.name}`);
    if (p.description) console.log(`  Desc: ${p.description}`);
    if (p.dependsOn.length > 0) console.log(`  Deps: ${p.dependsOn.join(", ")}`);
    console.log();
  }
}

// ---------------------------------------------------------------------------
// project get/init/delete/status subcommands
// ---------------------------------------------------------------------------

async function handleProjectGet(args: string[], json: boolean): Promise<void> {
  const slug = args[0];
  if (!slug) {
    cliError("Error: usage: spoc project get <slug> [--doc=<type>]");
    return;
  }

  const projectDir = getProjectDir(slug);
  if (!existsSync(projectDir)) {
    cliError(`Error: project "${slug}" not found`);
    return;
  }

  const doc = extractFlag(args, "--doc") as ProjectDocType | undefined;

  if (doc) {
    const fileName = PROJECT_DOC_FILES[doc];
    if (!fileName) {
      cliError(`Error: invalid doc type "${doc}". Valid: overview, tasks, dependencies, knowledge`);
      return;
    }
    const filePath = resolve(projectDir, fileName);
    if (!existsSync(filePath)) {
      cliError(`Error: doc file not found: ${fileName}`);
      return;
    }
    const content = await readFile(filePath, "utf-8");
    if (json) {
      console.log(JSON.stringify({ slug, doc, content }));
    } else {
      console.log(content);
    }
    return;
  }

  // Return project metadata
  const metaPath = resolve(projectDir, "meta.json");
  const meta = JSON.parse(readFileSync(metaPath, "utf-8"));

  if (json) {
    console.log(JSON.stringify(meta));
  } else {
    console.log(`Slug:        ${meta.id}`);
    console.log(`Name:        ${meta.name}`);
    console.log(`Description: ${meta.description}`);
    console.log(`Status:      ${meta.status}`);
    if (meta.repoUrl) console.log(`Repo:        ${meta.repoUrl}`);
    console.log(`Created:     ${meta.createdAt}`);
    if (meta.workspacePaths?.length > 0) {
      console.log(`Paths:       ${meta.workspacePaths.join(", ")}`);
    }
  }
}

async function handleProjectInit(args: string[], json: boolean): Promise<void> {
  const name = extractFlag(args, "--name");
  const description = extractFlag(args, "--description");
  const repoUrl = extractFlag(args, "--repo-url");
  const dependsOnRaw = extractFlag(args, "--depends-on");

  if (!name) {
    cliError("Error: --name is required");
    return;
  }
  if (!description) {
    cliError("Error: --description is required");
    return;
  }

  const token = extractFlag(args, "--token");
  const slug = slugify(name);
  try {
    requireWriteGate(token, slug, "tool:init_project");
  } catch (err) {
    if (err instanceof WriteGateError) {
      cliError(`Error: ${err.message}`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  const dataDir = getDataDir();
  const projectDir = resolve(dataDir, "projects", slug);
  const dependsOn = dependsOnRaw ? dependsOnRaw.split(",").map((s) => s.trim()) : [];

  try {
    const rootMeta = await readRootMeta(dataDir);

    if (rootMeta.projects.some((p) => p.id === slug)) {
      cliError(`Error: project "${slug}" already exists`);
      return;
    }

    if (dependsOn.length > 0) {
      const missing = validateDependencies(rootMeta.projects, dependsOn);
      if (missing.length > 0) {
        cliError(`Error: dependencies not found: ${missing.join(", ")}`);
        return;
      }
      for (const dep of dependsOn) {
        if (wouldCreateCycle(rootMeta.projects, slug, dep)) {
          cliError(`Error: adding dependency "${dep}" would create a cycle`);
          return;
        }
      }
    }

    await mkdir(projectDir, { recursive: true });

    const now = new Date().toISOString();
    const variables: Record<string, string> = {
      id: slug,
      name,
      description,
      repoUrl: repoUrl ?? "",
      status: "draft",
      createdAt: now,
      dependsOnList: dependsOn.length > 0 ? dependsOn.join(", ") : "—",
      statusBlock: "**Status:** draft\n",
      repoBlock: repoUrl ? `**Repo:** ${repoUrl}\n` : "",
      upstreamBlock: dependsOn.length > 0 ? dependsOn.map((d) => `- ${d}`).join("\n") : "- None",
    };

    const templates = [
      { tmpl: "project-meta.json.tmpl", out: "meta.json" },
      { tmpl: "project.md.tmpl", out: "overview.md" },
      { tmpl: "task.md.tmpl", out: "tasks.md" },
      { tmpl: "dependency.md.tmpl", out: "dependencies.md" },
      { tmpl: "knowledge.md.tmpl", out: "knowledge.md" },
    ];

    for (const { tmpl, out } of templates) {
      const content = renderTemplate(getTemplatePath(tmpl), variables);
      await writeFile(resolve(projectDir, out), content, "utf-8");
    }

    // Inject workspacePaths
    const metaJsonPath = resolve(projectDir, "meta.json");
    const metaObj = JSON.parse(readFileSync(metaJsonPath, "utf-8"));
    metaObj.workspacePaths = [normalizeWorkspacePath(process.cwd())];
    await writeFile(metaJsonPath, JSON.stringify(metaObj, null, 2), "utf-8");

    // Create indexes
    await mkdir(resolve(projectDir, "plans"), { recursive: true });
    await mkdir(resolve(projectDir, "knowledge"), { recursive: true });
    await mkdir(resolve(projectDir, "tasks"), { recursive: true });
    await writeFile(resolve(projectDir, "plans", "index.json"), JSON.stringify({ plans: [] }, null, 2), "utf-8");
    await writeFile(resolve(projectDir, "knowledge", "index.json"), JSON.stringify({ entries: [] }, null, 2), "utf-8");
    await writeFile(resolve(projectDir, "tasks", "index.json"), JSON.stringify({ tasks: [] }, null, 2), "utf-8");

    // Update root meta
    rootMeta.projects.push({ id: slug, name, status: "draft", dependsOn });
    await writeRootMeta(dataDir, rootMeta);

    if (json) {
      console.log(JSON.stringify({ slug, name, status: "draft", dependsOn }));
    } else {
      console.log(`Project "${name}" initialized at projects/${slug}/`);
    }
  } catch (err) {
    cliError(`Error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function handleProjectDelete(args: string[], json: boolean): Promise<void> {
  const slug = args.find((a) => !a.startsWith("--"));
  if (!slug) {
    cliError("Error: usage: spoc project delete <slug> --token=<token>");
    return;
  }

  const token = extractFlag(args, "--token");
  try {
    requireWriteGate(token, slug, "tool:delete_project");
  } catch (err) {
    if (err instanceof WriteGateError) {
      cliError(`Error: ${err.message}`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  const dataDir = getDataDir();
  try {
    const rootMeta = await readRootMeta(dataDir);
    const projectIdx = rootMeta.projects.findIndex((p) => p.id === slug);
    if (projectIdx === -1) {
      cliError(`Error: project "${slug}" not found`);
      return;
    }

    const projectDir = resolve(dataDir, "projects", slug);
    await rm(projectDir, { recursive: true, force: true });

    rootMeta.projects.splice(projectIdx, 1);
    for (const p of rootMeta.projects) {
      p.dependsOn = p.dependsOn.filter((dep) => dep !== slug);
    }
    await writeRootMeta(dataDir, rootMeta);

    if (json) {
      console.log(JSON.stringify({ deleted: slug }));
    } else {
      console.log(`Deleted project "${slug}" and removed all dependency edges.`);
    }
  } catch (err) {
    cliError(`Error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function handleProjectStatus(args: string[], json: boolean): Promise<void> {
  const positional = args.filter((a) => !a.startsWith("--"));
  const slug = positional[0];
  const status = positional[1];

  if (!slug || !status) {
    cliError("Error: usage: spoc project status <slug> <status> --token=<token>");
    return;
  }

  const validStatuses = ["draft", "active", "completed", "archived"];
  if (!validStatuses.includes(status)) {
    cliError(`Error: invalid status "${status}". Valid: ${validStatuses.join(", ")}`);
    return;
  }

  const token = extractFlag(args, "--token");
  try {
    requireWriteGate(token, slug, "tool:update_project_status");
  } catch (err) {
    if (err instanceof WriteGateError) {
      cliError(`Error: ${err.message}`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  const dataDir = getDataDir();
  try {
    const rootMeta = await readRootMeta(dataDir);
    const project = rootMeta.projects.find((p) => p.id === slug);
    if (!project) {
      cliError(`Error: project "${slug}" not found`);
      return;
    }

    const oldStatus = project.status;
    project.status = status;
    await writeRootMeta(dataDir, rootMeta);

    if (json) {
      console.log(JSON.stringify({ slug, previousStatus: oldStatus, newStatus: status }));
    } else {
      console.log(`Project "${slug}" status: ${oldStatus} → ${status}`);
    }
  } catch (err) {
    cliError(`Error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// write command
// ---------------------------------------------------------------------------

async function handleWrite(args: string[], json: boolean): Promise<void> {
  const subcommand = args[0];

  switch (subcommand) {
    case "propose":
      return handleWritePropose(args.slice(1), json);
    case "apply":
      return handleWriteApply(args.slice(1), json);
    default:
      cliError(`Error: unknown write subcommand "${subcommand ?? ""}". Use: propose, apply`);
      process.exitCode = 1;
  }
}

async function handleWritePropose(args: string[], json: boolean): Promise<void> {
  const slug = extractFlag(args, "--slug");
  const summary = extractFlag(args, "--summary");
  const opsRaw = extractFlag(args, "--ops");
  const ttlStr = extractFlag(args, "--ttl");

  if (!slug) {
    cliError("Error: --slug is required");
    process.exitCode = 1;
    return;
  }
  if (!summary) {
    cliError("Error: --summary is required");
    process.exitCode = 1;
    return;
  }
  if (!opsRaw) {
    cliError("Error: --ops is required (comma-separated operations)");
    process.exitCode = 1;
    return;
  }

  const operations = opsRaw.split(",").map((o) => o.trim());
  const ttlMs = ttlStr ? Number.parseInt(ttlStr, 10) : 120_000;

  try {
    const proposal = createWriteProposal({ slug, summary, operations, ttlMs });
    if (json) {
      console.log(JSON.stringify({
        token: proposal.token,
        slug: proposal.slug,
        summary: proposal.summary,
        operations: proposal.operations,
        createdAt: proposal.createdAt,
        expiresAt: proposal.expiresAt,
      }));
    } else {
      console.log(`Token: ${proposal.token}`);
      console.log(`Slug: ${proposal.slug}`);
      console.log(`Summary: ${proposal.summary}`);
      console.log(`Operations: ${proposal.operations.join(", ")}`);
      console.log(`Expires: ${proposal.expiresAt}`);
    }
  } catch (err) {
    cliError(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 2;
  }
}

async function handleWriteApply(args: string[], json: boolean): Promise<void> {
  const token = extractFlag(args, "--token");
  const slug = extractFlag(args, "--slug");

  if (!token) {
    cliError("Error: --token is required");
    process.exitCode = 1;
    return;
  }
  if (!slug) {
    cliError("Error: --slug is required");
    process.exitCode = 1;
    return;
  }

  try {
    const proposal = consumeWriteProposalToken(token, slug);
    if (json) {
      console.log(JSON.stringify({
        consumed: true,
        token: proposal.token,
        slug: proposal.slug,
        operations: proposal.operations,
        consumedAt: proposal.consumedAt,
      }));
    } else {
      console.log(`Applied write-gate token for project "${slug}"`);
      console.log(`Operations: ${proposal.operations.join(", ")}`);
    }
  } catch (err) {
    if (err instanceof WriteGateError) {
      cliError(`Error: ${err.message}`);
      process.exitCode = 1;
    } else {
      cliError(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 2;
    }
  }
}

// ---------------------------------------------------------------------------
// doc command
// ---------------------------------------------------------------------------

async function handleDoc(args: string[], json: boolean): Promise<void> {
  const subcommand = args[0];

  if (subcommand !== "update") {
    cliError(`Error: unknown doc subcommand "${subcommand ?? ""}". Use: update`);
    process.exitCode = 1;
    return;
  }

  const rest = args.slice(1);
  const slug = rest[0];
  const docType = rest[1] as ProjectDocType | undefined;
  const bodyFile = extractFlag(rest, "--body-file");
  const token = extractFlag(rest, "--token");

  if (!slug) {
    cliError("Error: <slug> is required");
    process.exitCode = 1;
    return;
  }
  if (!docType) {
    cliError("Error: <doc-type> is required (overview | tasks | dependencies | knowledge)");
    process.exitCode = 1;
    return;
  }

  const validDocs = Object.keys(PROJECT_DOC_FILES);
  if (!validDocs.includes(docType)) {
    cliError(`Error: invalid doc-type "${docType}". Valid: ${validDocs.join(", ")}`);
    process.exitCode = 1;
    return;
  }

  if (!bodyFile) {
    cliError("Error: --body-file=<path> is required");
    process.exitCode = 1;
    return;
  }

  try {
    requireWriteGate(token, slug, "cli:doc_update");
  } catch (err) {
    cliError(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
    return;
  }

  if (!existsSync(bodyFile)) {
    cliError(`Error: body file not found: ${bodyFile}`);
    process.exitCode = 1;
    return;
  }

  const content = readFileSync(bodyFile, "utf-8");
  const projectDir = getProjectDir(slug);

  if (!existsSync(projectDir)) {
    cliError(`Error: project "${slug}" not found`);
    process.exitCode = 1;
    return;
  }

  const fileName = PROJECT_DOC_FILES[docType];
  const filePath = resolve(projectDir, fileName);

  try {
    await writeFile(filePath, content, "utf-8");
    if (json) {
      console.log(JSON.stringify({ updated: true, slug, doc: docType, path: filePath }));
    } else {
      console.log(`✅ Updated ${docType} for project "${slug}".`);
    }
  } catch (err) {
    cliError(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 2;
  }
}

// ---------------------------------------------------------------------------
// dependency command
// ---------------------------------------------------------------------------

async function handleDependency(args: string[], json: boolean): Promise<void> {
  const action = args[0] as "add" | "remove" | undefined;

  if (!action || !["add", "remove"].includes(action)) {
    cliError(`Error: unknown dependency subcommand "${action ?? ""}". Use: add, remove`);
    process.exitCode = 1;
    return;
  }

  const slug = args[1];
  const targetSlug = args[2];
  const token = extractFlag(args, "--token");

  if (!slug) {
    cliError("Error: <slug> is required");
    process.exitCode = 1;
    return;
  }
  if (!targetSlug) {
    cliError("Error: <target-slug> is required");
    process.exitCode = 1;
    return;
  }

  try {
    requireWriteGate(token, slug, "cli:manage_dependency");
  } catch (err) {
    cliError(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
    return;
  }

  try {
    const dataDir = getDataDir();
    const rootMeta = await readRootMeta(dataDir);

    const project = rootMeta.projects.find((p) => p.id === slug);
    if (!project) {
      cliError(`Error: project "${slug}" not found`);
      process.exitCode = 1;
      return;
    }

    const target = rootMeta.projects.find((p) => p.id === targetSlug);
    if (!target) {
      cliError(`Error: project "${targetSlug}" not found`);
      process.exitCode = 1;
      return;
    }

    if (action === "add") {
      if (project.dependsOn.includes(targetSlug)) {
        const msg = `Dependency "${slug}" → "${targetSlug}" already exists.`;
        if (json) console.log(JSON.stringify({ message: msg }));
        else console.log(msg);
        return;
      }

      if (wouldCreateCycle(rootMeta.projects, slug, targetSlug)) {
        cliError(`Error: adding dependency "${slug}" → "${targetSlug}" would create a cycle`);
        process.exitCode = 1;
        return;
      }

      project.dependsOn.push(targetSlug);
    } else {
      const idx = project.dependsOn.indexOf(targetSlug);
      if (idx === -1) {
        const msg = `Dependency "${slug}" → "${targetSlug}" does not exist.`;
        if (json) console.log(JSON.stringify({ message: msg }));
        else console.log(msg);
        return;
      }
      project.dependsOn.splice(idx, 1);
    }

    await writeRootMeta(dataDir, rootMeta);

    const verb = action === "add" ? "Added" : "Removed";
    const msg = `✅ ${verb} dependency: "${slug}" → "${targetSlug}"`;
    if (json) console.log(JSON.stringify({ message: msg, slug, targetSlug, action }));
    else console.log(msg);
  } catch (err) {
    cliError(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 2;
  }
}

// ---------------------------------------------------------------------------
// paths command
// ---------------------------------------------------------------------------

async function handlePaths(args: string[], json: boolean): Promise<void> {
  const subcommand = args[0];

  if (subcommand !== "update") {
    cliError(`Error: unknown paths subcommand "${subcommand ?? ""}". Use: update`);
    process.exitCode = 1;
    return;
  }

  const rest = args.slice(1);
  const slug = rest[0];
  const action = extractFlag(rest, "--action") as "add" | "remove" | "set" | undefined;
  const pathsRaw = extractFlag(rest, "--paths");
  const token = extractFlag(rest, "--token");

  if (!slug) {
    cliError("Error: <slug> is required");
    process.exitCode = 1;
    return;
  }
  if (!action || !["add", "remove", "set"].includes(action)) {
    cliError(`Error: --action=add|remove|set is required`);
    process.exitCode = 1;
    return;
  }
  if (!pathsRaw) {
    cliError("Error: --paths=<p1,p2,...> is required");
    process.exitCode = 1;
    return;
  }

  const paths = pathsRaw.split(",").map((p) => p.trim());

  // Validate all paths are absolute
  for (const p of paths) {
    if (!p.startsWith("/")) {
      cliError(`Error: path must be absolute, got "${p}"`);
      process.exitCode = 1;
      return;
    }
  }

  try {
    requireWriteGate(token, slug, "cli:update_paths");
  } catch (err) {
    cliError(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
    return;
  }

  const projectDir = getProjectDir(slug);
  const metaPath = resolve(projectDir, "meta.json");

  if (!existsSync(metaPath)) {
    cliError(`Error: project "${slug}" not found`);
    process.exitCode = 1;
    return;
  }

  try {
    const normalized = paths.map(normalizeWorkspacePath);
    const raw = await readJsonSafe<unknown>(metaPath);
    if (raw === undefined) {
      cliError("Error: unable to parse project meta.json");
      process.exitCode = 2;
      return;
    }
    const meta = validateJson(raw, projectMetaSchema, metaPath);
    const current: string[] = Array.isArray(meta.workspacePaths) ? meta.workspacePaths : [];

    let updated: string[];

    switch (action) {
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

    if (json) {
      console.log(JSON.stringify({ updated: true, slug, action, paths: updated }));
    } else {
      console.log(`✅ Workspace paths for "${slug}" updated (${action}).`);
      console.log(`\nCurrent paths:`);
      if (updated.length > 0) {
        for (const p of updated) console.log(`- ${p}`);
      } else {
        console.log("- (none)");
      }
    }
  } catch (err) {
    cliError(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 2;
  }
}

// ---------------------------------------------------------------------------
// loop command
// ---------------------------------------------------------------------------

async function handleLoop(args: string[], json: boolean): Promise<void> {
  const subcommand = args[0];

  switch (subcommand) {
    case "start":
      await handleLoopStart(args.slice(1), json);
      return;
    case "cancel":
      await handleLoopCancel(args.slice(1), json);
      return;
    case "status":
      await handleLoopStatus(args.slice(1), json);
      return;
    default:
      cliError(
        "Error: usage: spoc loop <start|cancel|status> [options]\n" +
          "  start <slug> --prompt=<text> --session=<id> [--max-iterations=<N>] [--completion-promise=<text>] --token=<token>\n" +
          "  cancel <slug> --session=<id> --token=<token>\n" +
          "  status [<slug>]",
      );
      return;
  }
}

async function handleLoopStart(args: string[], json: boolean): Promise<void> {
  const slug = args[0];
  const prompt = extractFlag(args, "--prompt");
  const session = extractFlag(args, "--session");

  if (!slug || !prompt || !session) {
    cliError("Error: usage: spoc loop start <slug> --prompt=<text> --session=<id> [--max-iterations=<N>] [--completion-promise=<text>] --token=<token>");
    return;
  }

  const token = extractFlag(args, "--token");
  try {
    requireWriteGate(token, slug, "tool:start_project_loop");
  } catch (err) {
    if (err instanceof WriteGateError) {
      cliError(`Error: ${err.message}`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  const projectDir = getProjectDir(slug);
  if (!existsSync(projectDir)) {
    cliError(`Error: project "${slug}" not found`);
    return;
  }

  const maxIterationsRaw = extractFlag(args, "--max-iterations");
  const maxIterations = maxIterationsRaw ? Number.parseInt(maxIterationsRaw, 10) : 100;
  const completionPromise = extractFlag(args, "--completion-promise") ?? "DONE";
  const strategy = (extractFlag(args, "--strategy") as "continue" | "reset") ?? "continue";

  try {
    const state = await startLoop(projectDir, {
      sessionId: session,
      prompt,
      maxIterations,
      completionPromise,
      strategy,
      projectSlug: slug,
    });

    if (json) {
      console.log(JSON.stringify({ message: `Loop started for project "${slug}"`, state }));
    } else {
      console.log(`Loop started for project "${slug}" (session: ${session}, max: ${maxIterations})`);
    }
  } catch (err) {
    cliError(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

async function handleLoopCancel(args: string[], json: boolean): Promise<void> {
  const slug = args[0];
  const session = extractFlag(args, "--session");

  if (!slug || !session) {
    cliError("Error: usage: spoc loop cancel <slug> --session=<id> --token=<token>");
    return;
  }

  const token = extractFlag(args, "--token");
  try {
    requireWriteGate(token, slug, "tool:cancel_project_loop");
  } catch (err) {
    if (err instanceof WriteGateError) {
      cliError(`Error: ${err.message}`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  const projectDir = getProjectDir(slug);
  if (!existsSync(projectDir)) {
    cliError(`Error: project "${slug}" not found`);
    return;
  }

  try {
    const cancelled = await cancelLoop(projectDir, session);
    if (json) {
      console.log(JSON.stringify({ slug, session, cancelled }));
    } else if (cancelled) {
      console.log(`Loop cancelled for project "${slug}".`);
    } else {
      console.log(`No active loop found for project "${slug}" with session "${session}".`);
    }
  } catch (err) {
    cliError(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

async function handleLoopStatus(args: string[], json: boolean): Promise<void> {
  const slug = args[0];

  try {
    if (slug) {
      const projectDir = getProjectDir(slug);
      if (!existsSync(projectDir)) {
        cliError(`Error: project "${slug}" not found`);
        return;
      }
      const state = await readLoopState(projectDir);
      if (json) {
        console.log(JSON.stringify({ slug, state }));
      } else if (state) {
        console.log(`Loop for "${slug}": status=${state.active ? "active" : "idle"}, iteration=${state.iteration}/${state.maxIterations}, session=${state.sessionId}`);
      } else {
        console.log(`No active loop for project "${slug}".`);
      }
    } else {
      const active = await findActiveLoop();
      if (json) {
        console.log(JSON.stringify(active ? { slug: active.slug, state: active.state } : { message: "No active loop found.", state: null }));
      } else if (active) {
        console.log(`Active loop: project="${active.slug}", status=${active.state.active ? "active" : "idle"}, iteration=${active.state.iteration}/${active.state.maxIterations}`);
      } else {
        console.log("No active loop found.");
      }
    }
  } catch (err) {
    cliError(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
// lint-bundle command
// ---------------------------------------------------------------------------

async function handleLintBundle(args: string[], json: boolean): Promise<void> {
  const bundleRoot = extractFlag(args, "--bundle-root");
  const configRoot = extractFlag(args, "--config-root");

  try {
    const repoRoot = resolve(import.meta.dirname, "../..");
    const scriptPath = resolve(repoRoot, "scripts/lint-bundle.mjs");

    const env: Record<string, string> = { ...process.env } as Record<string, string>;
    if (bundleRoot) env.BUNDLE_LINT_BUNDLE_ROOT = bundleRoot;
    if (configRoot) env.BUNDLE_LINT_CONFIG_ROOT = configRoot;

    const proc = spawnSync("node", [scriptPath], {
      cwd: repoRoot,
      env,
      encoding: "utf-8",
    });

    if (proc.stdout) {
      const result = JSON.parse(proc.stdout);
      if (json) {
        console.log(JSON.stringify(result));
      } else {
        const issues = result.issues ?? [];
        if (issues.length === 0) {
          console.log("✅ No issues found.");
        } else {
          console.log(`Found ${issues.length} issue(s):\n`);
          for (const issue of issues) {
            console.log(`  [${issue.severity ?? "warn"}] ${issue.message}`);
            if (issue.file) console.log(`    File: ${issue.file}`);
          }
        }
      }
    } else {
      cliError(`Error: ${proc.stderr || "lint-bundle produced no output"}`);
      process.exitCode = 1;
    }
  } catch (err) {
    cliError(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
// deploy-superpowers command
// ---------------------------------------------------------------------------

async function handleDeploySuperpowers(args: string[], json: boolean): Promise<void> {
  const bundleRoot = extractFlag(args, "--bundle-root");
  const configRoot = extractFlag(args, "--config-root");
  const dryRun = args.includes("--dry-run");

  if (!dryRun) {
    const token = extractFlag(args, "--token");
    try {
      requireWriteGate(token, "_global", "tool:deploy_spoc_bundle");
    } catch (err) {
      if (err instanceof WriteGateError) {
        cliError(`Error: ${err.message}`);
        process.exitCode = 1;
        return;
      }
      throw err;
    }
  }

  try {
    const repoRoot = resolve(import.meta.dirname, "../..");
    const scriptPath = resolve(repoRoot, "scripts/deploy-opencode-bundle.mjs");

    const env: Record<string, string> = { ...process.env } as Record<string, string>;
    env.DEPLOY_DRY_RUN = dryRun ? "true" : "false";
    if (bundleRoot) env.DEPLOY_BUNDLE_ROOT = bundleRoot;
    if (configRoot) env.DEPLOY_CONFIG_ROOT = configRoot;

    const proc = spawnSync("node", [scriptPath], {
      cwd: repoRoot,
      env,
      encoding: "utf-8",
    });

    if (proc.stdout) {
      const result = JSON.parse(proc.stdout);
      if (json) {
        console.log(JSON.stringify(result));
      } else {
        const prefix = dryRun ? "[DRY RUN] " : "";
        console.log(`${prefix}Deploy: ${result.source} → ${result.destination}`);
        if (result.filesAdded?.length) console.log(`  Added: ${result.filesAdded.join(", ")}`);
        if (result.filesChanged?.length) console.log(`  Changed: ${result.filesChanged.join(", ")}`);
        if (result.filesRemoved?.length) console.log(`  Removed: ${result.filesRemoved.join(", ")}`);
        if (result.filesUnchanged?.length) console.log(`  Unchanged: ${result.filesUnchanged.length} file(s)`);
      }
    } else {
      cliError(`Error: ${proc.stderr || "deploy script produced no output"}`);
      process.exitCode = 1;
    }
  } catch (err) {
    cliError(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
// sync-agents-md command
// ---------------------------------------------------------------------------

async function handleSyncAgentsMd(args: string[], json: boolean): Promise<void> {
  const slug = args.find((a) => !a.startsWith("--"));
  const analysisFile = extractFlag(args, "--analysis-file");

  if (!slug) {
    cliError("Error: usage: spoc sync-agents-md <slug> --analysis-file=<path> --token=<token> [--json]");
    return;
  }

  if (!analysisFile) {
    cliError("Error: --analysis-file=<path> is required (JSON file with codebaseAnalysis data)");
    return;
  }

  const token = extractFlag(args, "--token");
  try {
    requireWriteGate(token, slug, "tool:sync_agents_md");
  } catch (err) {
    if (err instanceof WriteGateError) {
      cliError(`Error: ${err.message}`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  if (!existsSync(analysisFile)) {
    cliError(`Error: analysis file not found: ${analysisFile}`);
    process.exitCode = 1;
    return;
  }

  let analysis: unknown;
  try {
    const raw = readFileSync(analysisFile, "utf-8");
    analysis = JSON.parse(raw);
  } catch {
    cliError(`Error: could not parse analysis file as JSON: ${analysisFile}`);
    process.exitCode = 1;
    return;
  }

  const codebaseAnalysis = analysis as {
    directoryStructure: string;
    fileNaming: string;
    codePatterns: string;
    techStack: string;
    testingPatterns?: string;
    additionalNotes?: string;
  };

  if (!codebaseAnalysis.directoryStructure || !codebaseAnalysis.fileNaming || !codebaseAnalysis.codePatterns || !codebaseAnalysis.techStack) {
    cliError("Error: analysis file must contain directoryStructure, fileNaming, codePatterns, and techStack fields");
    process.exitCode = 1;
    return;
  }

  // Reuse the sync logic inline (same as the CLI command)
  try {
    const dataDir = getDataDir();
    const rootMeta = await readRootMeta(dataDir);
    const projectNode = rootMeta.projects.find((p) => p.id === slug);
    if (!projectNode) {
      cliError(`Error: project "${slug}" not found`);
      process.exitCode = 1;
      return;
    }

    const projectDir = getProjectDir(slug);
    const metaPath = resolve(projectDir, "meta.json");
    const rawMeta = await readJsonSafe<unknown>(metaPath);
    if (rawMeta === undefined) {
      cliError(`Error: could not read project meta at ${metaPath}`);
      process.exitCode = 1;
      return;
    }
    const meta = validateJson(rawMeta, projectMetaSchema, metaPath);
    const name = (meta as { name?: string }).name ?? slug;
    const workspacePaths = Array.isArray((meta as { workspacePaths?: string[] }).workspacePaths)
      ? (meta as { workspacePaths: string[] }).workspacePaths
      : [];

    if (workspacePaths.length === 0) {
      cliError(`Error: project "${slug}" has no workspace paths configured`);
      process.exitCode = 1;
      return;
    }

    // Use the CLI command's script by importing dynamically is not feasible,
    // so we invoke the tool's registration indirectly. Instead, replicate the
    // content assembly inline (same logic as sync-agents-md.ts).
    const { lstat, symlink, unlink, writeFile: writeFileAsync, readFile: readFileAsync } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { extractOverviewContent, extractInProgressTasks, extractDependenciesContent } = await import("../utils/content-assembly.js");
    const { readPlanIndex } = await import("../utils/project-memory.js");

    // Build preamble
    const preamble = `# AGENTS.md — ${name}\n\n> Auto-generated by SPOC. Do not edit manually.\n> Regenerate: \`sync_agents_md\` (slug: ${slug})\n\n---\n\n## Coding Discipline\n\nYou are working in an existing codebase maintained by a team.\nYour code must be indistinguishable from the team's existing code.`;

    // Build analysis sections
    const analysisSections: string[] = [];
    analysisSections.push(`\n## Tech Stack\n\n${codebaseAnalysis.techStack}`);
    analysisSections.push(`\n## Directory Structure\n\n${codebaseAnalysis.directoryStructure}`);
    analysisSections.push(`\n## File Naming Conventions\n\n${codebaseAnalysis.fileNaming}`);
    analysisSections.push(`\n## Code Patterns\n\n${codebaseAnalysis.codePatterns}`);
    if (codebaseAnalysis.testingPatterns?.trim()) {
      analysisSections.push(`\n## Testing Patterns\n\n${codebaseAnalysis.testingPatterns}`);
    }
    if (codebaseAnalysis.additionalNotes?.trim()) {
      analysisSections.push(`\n## Additional Notes\n\n${codebaseAnalysis.additionalNotes}`);
    }

    // Build project context
    const contextSections: string[] = [];
    const overviewPath = resolve(projectDir, "overview.md");
    if (existsSync(overviewPath)) {
      const overviewRaw = await readFileAsync(overviewPath, "utf-8");
      const overviewContent = extractOverviewContent(overviewRaw);
      if (overviewContent) contextSections.push(`\n## Project Overview\n\n${overviewContent}`);
    }
    const tasksPath = resolve(projectDir, "tasks.md");
    if (existsSync(tasksPath)) {
      const tasksRaw = await readFileAsync(tasksPath, "utf-8");
      const inProgress = extractInProgressTasks(tasksRaw);
      if (inProgress.length > 0) contextSections.push(`\n## Current Focus\n\n${inProgress.join("\n")}`);
    }
    const depsPath = resolve(projectDir, "dependencies.md");
    if (existsSync(depsPath)) {
      const depsRaw = await readFileAsync(depsPath, "utf-8");
      const depsContent = extractDependenciesContent(depsRaw);
      if (depsContent) contextSections.push(`\n## Dependencies\n\n${depsContent}`);
    }
    const planIndex = await readPlanIndex(projectDir);
    const activePlans = planIndex.plans.filter((p) => p.status === "in_progress" || p.status === "planned");
    if (activePlans.length > 0) {
      const bullets = activePlans.map((p) => `- **${p.title}** (${p.status})${p.summary ? `: ${p.summary}` : ""}`).join("\n");
      contextSections.push(`\n## Active Plans\n\n${bullets}`);
    }

    const content = `${preamble}\n\n---${analysisSections.join("")}\n${contextSections.length > 0 ? `\n---${contextSections.join("")}` : ""}\n`;

    // Write source and symlink
    const sourcePath = resolve(projectDir, "AGENTS.md");
    await writeFileAsync(sourcePath, content, "utf-8");

    const symlinked: string[] = [];
    const warnings: string[] = [];
    for (const wsPath of workspacePaths) {
      if (!existsSync(wsPath)) {
        warnings.push(`Warning: workspace path "${wsPath}" does not exist, skipped.`);
        continue;
      }
      const linkPath = join(wsPath, "AGENTS.md");
      try {
        await lstat(linkPath);
        await unlink(linkPath);
      } catch { /* does not exist */ }
      await symlink(sourcePath, linkPath);
      symlinked.push(linkPath);
    }

    if (json) {
      console.log(JSON.stringify({ sourcePath, symlinked, warnings }));
    } else {
      console.log(`✅ AGENTS.md written to ${sourcePath}`);
      if (symlinked.length > 0) {
        console.log(`Symlinked to: ${symlinked.join(", ")}`);
      }
      for (const w of warnings) console.log(w);
    }
  } catch (err) {
    cliError(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
// audit command
// ---------------------------------------------------------------------------

async function handleAudit(args: string[], json: boolean): Promise<void> {
  const slug = args[0];
  if (!slug) {
    cliError("Usage: spoc audit <slug> [--json]");
    process.exitCode = 1;
    return;
  }

  const projectDir = getProjectDir(slug);
  if (!existsSync(projectDir)) {
    cliError(`Error: project "${slug}" not found`);
    process.exitCode = 1;
    return;
  }

  // Read project meta for workspacePaths
  const metaPath = resolve(projectDir, "meta.json");
  const rawMeta = await readJsonSafe<unknown>(metaPath);
  if (rawMeta === undefined) {
    cliError(`Error: failed to read project meta at ${metaPath}`);
    process.exitCode = 1;
    return;
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
      const found = workspacePaths.some((ws: string) => existsSync(resolve(ws, ref.path)));
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

  const result = {
    staleEntries,
    counts: {
      totalEntries: entries.length,
      totalSourceFiles,
      staleCount,
    },
  };

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Audit: ${entries.length} entries, ${totalSourceFiles} sourceFiles, ${staleCount} stale`);
    for (const e of staleEntries) {
      console.log(`  ${e.entryId}: ${e.staleFiles.map((f) => f.path).join(", ")}`);
    }
  }
}

// ---------------------------------------------------------------------------
// diff command
// ---------------------------------------------------------------------------

async function handleDiff(args: string[], json: boolean): Promise<void> {
  const slug = args[0];
  if (!slug) {
    cliError("Usage: spoc diff <slug> --since=<iso-timestamp> [--json]");
    process.exitCode = 1;
    return;
  }

  const sinceIso = extractFlag(args, "--since");
  if (!sinceIso) {
    cliError("Error: --since=<iso-timestamp> is required");
    process.exitCode = 1;
    return;
  }

  const sinceMs = new Date(sinceIso).getTime();
  if (!Number.isFinite(sinceMs)) {
    cliError(`Error: invalid ISO timestamp "${sinceIso}"`);
    process.exitCode = 1;
    return;
  }

  const projectDir = getProjectDir(slug);
  if (!existsSync(projectDir)) {
    cliError(`Error: project "${slug}" not found`);
    process.exitCode = 1;
    return;
  }

  const [planIndex, knowledgeIndex, tasks] = await Promise.all([
    readPlanIndex(projectDir),
    readKnowledgeIndex(projectDir),
    listTasks(projectDir),
  ]);

  const effectiveTs = (item: { updatedAt: string; createdAt: string }) =>
    item.updatedAt || item.createdAt;

  const isAfter = (item: { updatedAt: string; createdAt: string }) =>
    new Date(effectiveTs(item)).getTime() > sinceMs;

  const plans = planIndex.plans
    .filter(isAfter)
    .map((p) => ({ planId: p.id, title: p.title, status: p.status, updatedAt: effectiveTs(p) }))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  const knowledge = knowledgeIndex.entries
    .filter(isAfter)
    .map((e) => ({ entryId: e.id, title: e.title, kind: e.kind, updatedAt: effectiveTs(e) }))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  const taskResults = tasks
    .filter(isAfter)
    .map((t) => ({ taskId: t.id, title: t.title, status: t.status, updatedAt: effectiveTs(t) }))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  const result = {
    since: sinceIso,
    plans,
    knowledge,
    tasks: taskResults,
    counts: {
      plans: plans.length,
      knowledge: knowledge.length,
      tasks: taskResults.length,
      total: plans.length + knowledge.length + taskResults.length,
    },
  };

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Changes since ${sinceIso}: ${result.counts.total} total (${result.counts.plans} plans, ${result.counts.knowledge} knowledge, ${result.counts.tasks} tasks)`);
    for (const p of plans) console.log(`  plan: ${p.planId} [${p.status}] ${p.title}`);
    for (const k of knowledge) console.log(`  knowledge: ${k.entryId} [${k.kind}] ${k.title}`);
    for (const t of taskResults) console.log(`  task: ${t.taskId} [${t.status}] ${t.title}`);
  }
}

// ---------------------------------------------------------------------------
// git-log command
// ---------------------------------------------------------------------------

async function handleGitLog(args: string[], json: boolean): Promise<void> {
  const slug = args[0];
  if (!slug) {
    cliError("Usage: spoc git-log <slug> [--limit=<N>] [--since=<iso-or-sha>] [--json]");
    process.exitCode = 1;
    return;
  }

  const projectDir = getProjectDir(slug);
  const metaPath = resolve(projectDir, "meta.json");
  if (!existsSync(metaPath)) {
    cliError(`Error: project "${slug}" not found`);
    process.exitCode = 1;
    return;
  }

  const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
  const workspacePaths: string[] = meta.workspacePaths ?? [];

  if (workspacePaths.length === 0) {
    cliError(`Error: project "${slug}" has no workspace paths configured`);
    process.exitCode = 1;
    return;
  }

  const cwd = workspacePaths[0];

  if (!isGitRepo(cwd)) {
    const result = { commits: [], info: "Workspace path is not a git repository" };
    if (json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log("Workspace path is not a git repository");
    }
    return;
  }

  const limitStr = extractFlag(args, "--limit");
  const limit = limitStr ? Number.parseInt(limitStr, 10) : 20;
  const since = extractFlag(args, "--since");

  const commits = getGitLog(cwd, { since, limit });

  if (json) {
    console.log(JSON.stringify(commits, null, 2));
  } else {
    for (const c of commits) {
      console.log(`${c.sha.slice(0, 7)} ${c.date} ${c.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

/**
 * Dispatches DAG CLI subcommands. Returns true if a command was handled.
 */
export async function handleDagCommand(
  command: string,
  args: string[],
): Promise<boolean> {
  const { json, rest } = parseFlags(args);

  if (rest.includes("--help") || args.includes("--help")) {
    printUsage();
    return true;
  }

  switch (command as DagCommand) {
    case "context":
      await handleContext(rest, json);
      return true;

    case "task":
      await handleTask(rest, json);
      return true;

    case "search":
      await handleSearch(rest, json);
      return true;

    case "plan":
      await handlePlan(rest, json);
      return true;

    case "knowledge":
      await handleKnowledge(rest, json);
      return true;

    case "diagram":
      await handleDiagram(rest, json);
      return true;

    case "batch":
      await handleBatch(rest, json);
      return true;

    case "validate":
      await handleValidate(rest, json);
      return true;

    case "project":
      await handleProject(rest, json);
      return true;

    case "write":
      await handleWrite(rest, json);
      return true;

    case "doc":
      await handleDoc(rest, json);
      return true;

    case "dependency":
      await handleDependency(rest, json);
      return true;

    case "paths":
      await handlePaths(rest, json);
      return true;

    case "loop":
      await handleLoop(rest, json);
      return true;

    case "lint-bundle":
      await handleLintBundle(rest, json);
      return true;

    case "deploy-superpowers":
      await handleDeploySuperpowers(rest, json);
      return true;

    case "sync-agents-md":
      await handleSyncAgentsMd(rest, json);
      return true;

    case "audit":
      await handleAudit(rest, json);
      return true;

    case "diff":
      await handleDiff(rest, json);
      return true;

    case "git-log":
      await handleGitLog(rest, json);
      return true;

    default:
      return false;
  }
}
