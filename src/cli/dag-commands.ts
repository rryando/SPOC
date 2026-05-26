// ---------------------------------------------------------------------------
// DAG CLI Command Handlers
// ---------------------------------------------------------------------------

import { execSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
  KNOWLEDGE_AUDIENCES,
  PLAN_STATUSES,
  TASK_STATUSES,
  updateKnowledgeEntry,
  updatePlan,
  updateTask,
  type FileRef,
  type KnowledgeAudience,
  type KnowledgeKind,
  type KnowledgeMeta,
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
import { retrieveRelated } from "../retrieval/graph-retrieval.js";
import { createGraphCache } from "../retrieval/graph-cache.js";
import { retrieveForTask, type TaskContext } from "../retrieval/task-scoped.js";
import { isLeanMode, formatJsonOutput } from "./lean-output.js";
import { deriveOperatingBrief, safeTime } from "../utils/workflow-policy.js";
import {
  requireWriteGate,
  WriteGateError,
} from "../utils/write-gate.js";
import { cancelLoop, findActiveLoop, readLoopState, startLoop } from "../utils/loop-state.js";
import { getCommand } from "./command-registry.js";
import { parseArgs } from "./arg-parser.js";
import "./commands/index.js";

// Module-level lean mode flag, set by handleDagCommand
let _leanMode = false;
let _dryRun = false;

/** Stringify with optional lean transform */
function jsonOut(data: unknown): string {
  return formatJsonOutput(data, _leanMode);
}

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
  "agents-md",
  "related",
  "audit",
  "diff",
  "git-log",
  "graph",
] as const;

type DagCommand = (typeof DAG_COMMANDS)[number];

function printUsage(): void {
  console.log("Usage: spoc <command> [options]\n");
  console.log("DAG Commands:");
  console.log("  context [<path|slug>]               Resolve project context");
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
  console.log("  related <slug> --task=<id>          Graph-based related entities");
  console.log("  graph inspect <slug>                Inspect graph index stats");
  console.log("  diagram inspect <slug> <planId>     Inspect diagram structure");
  console.log("  diagram ready <slug> <planId>       Show ready-to-execute nodes");
  console.log("  diagram validate <slug> <planId>    Validate diagram integrity");
  console.log("  diagram status <slug> <plan> <node> <s>  Update node status");
  console.log("  diagram sort-metadata <slug> <plan> Sort metadata blocks");
  console.log("  diagram show <path>                 Render diagram in terminal");
  console.log("  batch --file=<path>                 Batch operations");
  console.log("  validate <slug>                     Validate project state");
  console.log("  agents-md <slug>                    Read project AGENTS.md");
  console.log("\nOptions:");
  console.log("  --json      Output as JSON");
  console.log("  --lean      Strip timestamps for token efficiency");
  console.log("  --dry-run   Validate params without side effects");
  console.log("  --help      Show command usage");
}

interface ParsedArgs {
  json: boolean;
  lean: boolean;
  dryRun: boolean;
  rest: string[];
}

function parseFlags(args: string[]): ParsedArgs {
  const rest: string[] = [];
  let json = false;
  let lean = false;
  let dryRun = false;

  for (const arg of args) {
    if (arg === "--json") {
      json = true;
    } else if (arg === "--lean") {
      lean = true;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else {
      rest.push(arg);
    }
  }

  // Also check environment variable
  if (!lean && isLeanMode([])) lean = true;

  return { json, lean, dryRun, rest };
}

function extractFlag(args: string[], flag: string): string | undefined {
  const found = args.find((a) => a.startsWith(`${flag}=`));
  if (!found) return undefined;
  return found.split("=")[1];
}

async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const timeout = setTimeout(() => {
      reject(new Error("Timed out reading from stdin (5s). Ensure data is piped to the command."));
    }, 5000);
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => {
      clearTimeout(timeout);
      resolve(Buffer.concat(chunks).toString("utf-8"));
    });
    process.stdin.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    process.stdin.resume();
  });
}

function cliError(msg: string): void {
  console.error(msg);
}

function renderWriteGateError(err: WriteGateError, json: boolean): void {
  if (json) {
    const out: Record<string, unknown> = { ok: false, code: err.code, message: err.message };
    if (err.hint) out.hint = err.hint;
    console.error(JSON.stringify(out));
  } else {
    const lines = [`Error: ${err.message}`];
    if (err.hint) lines.push(`Hint: ${err.hint}`);
    console.error(lines.join("\n"));
  }
  process.exitCode = 1;
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

/**
 * Selects top knowledge entries using graph traversal (when taskId provided)
 * or recency-based fallback. Returns up to 10 entries, deduplicated by id.
 */
export async function selectKnowledgeEntries(
  slug: string,
  entries: KnowledgeMeta[],
  taskId?: string,
  audience?: string,
): Promise<KnowledgeMeta[]> {
  const MAX_ENTRIES = 10;
  const entryMap = new Map(entries.map((e) => [e.id, e]));

  if (!taskId) {
    // No task context — pure recency
    const sorted = [...entries].sort(
      (a, b) => safeTime(b.updatedAt) - safeTime(a.updatedAt),
    );
    return sorted.slice(0, MAX_ENTRIES);
  }

  // Try graph retrieval first
  const graphResults = await retrieveRelated(slug, `task:${taskId}`, {
    limit: 5,
    types: ["knowledge"],
    audience,
  });

  const selectedIds = new Set<string>();
  const selected: KnowledgeMeta[] = [];

  if (graphResults.length >= 3) {
    // Use graph results as primary
    for (const r of graphResults) {
      const entry = entryMap.get(r.id);
      if (entry && !selectedIds.has(r.id)) {
        selectedIds.add(r.id);
        selected.push(entry);
      }
    }
  } else {
    // Sparse graph — fall back to BM25
    const projectDir = getProjectDir(slug);
    let taskContext: TaskContext | undefined;
    try {
      const task = await getTask(projectDir, taskId);
      taskContext = {
        title: task.title,
        sourceFiles: task.sourceFiles,
      };
    } catch {
      // Task not found — fall through to recency
    }

    if (taskContext) {
      const bm25Results = await retrieveForTask(slug, taskContext, 5);
      for (const r of bm25Results) {
        if (r.type === "knowledge") {
          const entry = entryMap.get(r.id);
          if (entry && !selectedIds.has(r.id)) {
            selectedIds.add(r.id);
            selected.push(entry);
          }
        }
      }
    }
  }

  // Fill remaining slots with recency-sorted entries not already selected
  if (selected.length < MAX_ENTRIES) {
    const sorted = [...entries].sort(
      (a, b) => safeTime(b.updatedAt) - safeTime(a.updatedAt),
    );
    for (const e of sorted) {
      if (selected.length >= MAX_ENTRIES) break;
      if (!selectedIds.has(e.id)) {
        selectedIds.add(e.id);
        selected.push(e);
      }
    }
  }

  return selected;
}

async function handleContext(args: string[], json: boolean): Promise<void> {
  const audience = extractFlag(args, "--audience") as KnowledgeAudience | undefined;
  if (audience && !(KNOWLEDGE_AUDIENCES as readonly string[]).includes(audience)) {
    cliError(`Error: invalid audience "${audience}". Valid: ${KNOWLEDGE_AUDIENCES.join(", ")}`);
    return;
  }

  const taskIdFlag = extractFlag(args, "--task");
  const noGraph = args.includes("--no-graph");

  const filteredArgs = args.filter((a) => !a.startsWith("--audience=") && !a.startsWith("--task=") && a !== "--no-graph");

  let queryPath: string;
  const rawArg = filteredArgs[0];

  if (!rawArg) {
    // No arg: use cwd
    queryPath = process.cwd();
  } else if (rawArg.startsWith("/")) {
    // Absolute path: use as-is
    queryPath = rawArg;
  } else if (!rawArg.includes("/") && !rawArg.includes(".")) {
    // Looks like a slug (no slashes, no dots): resolve from project metadata
    const dataDir = getDataDir();
    const projMetaPath = resolve(dataDir, "projects", rawArg, "meta.json");
    if (!existsSync(projMetaPath)) {
      cliError(`Error: project "${rawArg}" not found in SPOC`);
      return;
    }
    // Read the project's workspace paths and use the first one
    try {
      const projMeta = JSON.parse(readFileSync(projMetaPath, "utf-8"));
      const paths: string[] = Array.isArray(projMeta.workspacePaths) ? projMeta.workspacePaths : [];
      if (paths.length === 0) {
        cliError(`Error: project "${rawArg}" has no workspace paths configured`);
        return;
      }
      // Resolve ~ in path
      const first = paths[0];
      queryPath = first.startsWith("~")
        ? resolve(homedir(), first.slice(2))
        : resolve(first);
    } catch {
      cliError(`Error: could not read project metadata for "${rawArg}"`);
      return;
    }
  } else {
    // Relative path or something with dots/slashes - try to resolve
    queryPath = resolve(rawArg);
    if (!existsSync(queryPath)) {
      cliError(`Error: path "${rawArg}" does not exist. Use an absolute path or a project slug.`);
      return;
    }
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
    const filteredKnowledge = audience
      ? knowledgeIndex.entries.filter((e) => !e.audience || e.audience === audience || e.audience === "universal")
      : knowledgeIndex.entries;
    const planIndex = await readPlanIndex(projectDir);
    const allTasks = await listTasks(projectDir);

    console.log(jsonOut({
      slug,
      name,
      description,
      overview,
      tasks: allTasks,
      plans: planIndex.plans,
      knowledge: filteredKnowledge,
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

  // Resolve effective taskId for graph-scored knowledge selection
  let effectiveTaskId: string | undefined;
  if (noGraph) {
    effectiveTaskId = undefined;
  } else if (taskIdFlag) {
    effectiveTaskId = taskIdFlag;
  } else {
    // Auto-infer: use single in_progress task if exactly one exists
    const allTasksForInfer = await listTasks(projectDir);
    const inProgress = allTasksForInfer.filter((t) => t.status === "in_progress");
    if (inProgress.length === 1) {
      effectiveTaskId = inProgress[0].id;
    }
  }

  const knowledgeIndex = await readKnowledgeIndex(projectDir);
  const knowledgeEntries = audience
    ? knowledgeIndex.entries.filter((e) => !e.audience || e.audience === audience || e.audience === "universal")
    : knowledgeIndex.entries;
  if (knowledgeEntries.length > 0) {
    const top = await selectKnowledgeEntries(slug, knowledgeEntries, effectiveTaskId, audience);
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
    console.log(jsonOut(tasks));
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
      console.log(jsonOut(task));
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
      renderWriteGateError(err, json);
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
      console.log(jsonOut({ taskId, previousStatus, newStatus: status }));
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
  if (!_dryRun) {
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

  if (_dryRun) {
    const result = { ok: true, dryRun: true, data: { wouldCreate: { title, slug, planId, priority, status } } };
    if (json) {
      console.log(jsonOut(result));
    } else {
      console.log(`[dry-run] Would create task "${title}" in project "${slug}"`);
    }
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
      console.log(jsonOut(task));
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
      renderWriteGateError(err, json);
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
      console.log(jsonOut(task));
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
      renderWriteGateError(err, json);
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
      console.log(jsonOut({ deleted: taskId }));
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
  if (!_dryRun) {
    try {
      requireWriteGate(token, slug, "tool:create_project_plan");
    } catch (err) {
      if (err instanceof WriteGateError) {
        renderWriteGateError(err, json);
        return;
      }
      throw err;
    }
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

  if (_dryRun) {
    const result = { ok: true, dryRun: true, data: { wouldCreate: { title, slug, id, status, summary, keywords } } };
    if (json) {
      console.log(jsonOut(result));
    } else {
      console.log(`[dry-run] Would create plan "${title}" in project "${slug}"`);
    }
    return;
  }

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
      console.log(jsonOut(meta));
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
      renderWriteGateError(err, json);
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
      console.log(jsonOut(meta));
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
  const bodyFile = extractFlag(args, "--body-file");
  const bodyStdin = args.includes("--body-stdin");

  // Validate params before consuming the token
  const projectDir = getProjectDir(slug);
  if (!existsSync(projectDir)) {
    cliError(`Error: project "${slug}" not found`);
    return;
  }

  if (!bodyFile && !bodyStdin) {
    cliError("Error: --body-file=<path> is required (provide path to a markdown file with the plan body content), or use --body-stdin to read from stdin");
    return;
  }
  if (bodyFile && !existsSync(bodyFile)) {
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

  // Consume token only after all validation passes
  try {
    requireWriteGate(token, slug, "tool:update_project_plan_body");
  } catch (err) {
    if (err instanceof WriteGateError) {
      renderWriteGateError(err, json);
      return;
    }
    throw err;
  }

  const body = bodyFile ? readFileSync(bodyFile, "utf-8") : await readStdin();
  const bodyPath = resolve(projectDir, plan.file);

  try {
    await writeFile(bodyPath, body, "utf-8");

    if (json) {
      console.log(jsonOut({ meta: plan, body }));
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
      renderWriteGateError(err, json);
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
      console.log(jsonOut({ deleted: planId }));
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
    console.log(jsonOut(results));
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
// related command
// ---------------------------------------------------------------------------

export async function handleRelated(args: string[], json: boolean): Promise<void> {
  const slug = args[0];
  if (!slug) {
    cliError("Error: usage: spoc related <slug> --task=<id> | --knowledge=<id> | --plan=<id> [--limit=N] [--json]");
    return;
  }

  const taskId = extractFlag(args, "--task");
  const knowledgeId = extractFlag(args, "--knowledge");
  const planId = extractFlag(args, "--plan");

  if (!taskId && !knowledgeId && !planId) {
    cliError("Error: one of --task, --knowledge, or --plan is required");
    return;
  }

  let startNodeId: string;
  let startLabel: string;
  if (taskId) {
    startNodeId = `task:${taskId}`;
    startLabel = `task "${taskId}"`;
  } else if (knowledgeId) {
    startNodeId = `knowledge:${knowledgeId}`;
    startLabel = `knowledge "${knowledgeId}"`;
  } else {
    startNodeId = `plan:${planId}`;
    startLabel = `plan "${planId}"`;
  }

  const limitStr = extractFlag(args, "--limit");
  const limit = limitStr ? Number.parseInt(limitStr, 10) : 10;

  const results = await retrieveRelated(slug, startNodeId, { limit });

  if (json) {
    console.log(jsonOut(results));
    return;
  }

  if (results.length === 0) {
    console.log(`No related entities found for ${startLabel}.`);
    return;
  }

  console.log(`Related to ${startLabel}:`);
  for (const r of results) {
    const score = r.score.toFixed(2).padStart(6);
    const type = r.type.padEnd(10);
    console.log(`  ${score}  ${type}  ${r.title}`);
    console.log(`                     \u2192 ${r.relation}`);
  }
}

// ---------------------------------------------------------------------------
// graph command
// ---------------------------------------------------------------------------

export async function handleGraph(args: string[], json: boolean): Promise<void> {
  const subcommand = args[0];
  if (subcommand !== "inspect") {
    cliError("Error: usage: spoc graph inspect <slug> [--json]");
    return;
  }

  const slug = args[1];
  if (!slug) {
    cliError("Error: usage: spoc graph inspect <slug> [--json]");
    return;
  }

  const projectDir = getProjectDir(slug);
  if (!existsSync(projectDir)) {
    cliError(`Error: project "${slug}" not found`);
    return;
  }

  const cache = createGraphCache();
  const index = await cache.getOrBuild(slug);

  const nodeCount = index.nodes.size;

  let edgeCount = 0;
  for (const edgeList of index.edges.values()) {
    edgeCount += edgeList.length;
  }

  const nodesByType: Record<string, number> = {};
  for (const node of index.nodes.values()) {
    nodesByType[node.type] = (nodesByType[node.type] || 0) + 1;
  }

  const mostConnectedFiles = [...index.fileIndex.entries()]
    .map(([path, refs]) => ({ path, refs: refs.length }))
    .sort((a, b) => b.refs - a.refs)
    .slice(0, 10);

  // Orphan nodes: no outgoing AND no incoming edges
  const hasConnection = new Set<string>();
  for (const [source, edgeList] of index.edges.entries()) {
    if (edgeList.length > 0) hasConnection.add(source);
    for (const edge of edgeList) {
      hasConnection.add(edge.target);
    }
  }
  const orphanNodes: string[] = [];
  for (const nodeId of index.nodes.keys()) {
    if (!hasConnection.has(nodeId)) orphanNodes.push(nodeId);
  }

  const density = nodeCount > 1 ? edgeCount / (nodeCount * (nodeCount - 1)) : 0;

  const result = {
    nodeCount,
    edgeCount,
    nodesByType,
    mostConnectedFiles,
    orphanNodes,
    density: Math.round(density * 1000) / 1000,
  };

  if (json) {
    console.log(jsonOut(result));
    return;
  }

  console.log(`Graph inspect: ${slug}`);
  console.log(`  Nodes: ${nodeCount}`);
  console.log(`  Edges: ${edgeCount}`);
  console.log(`  Density: ${result.density}`);
  console.log(`  Nodes by type:`);
  for (const [type, count] of Object.entries(nodesByType)) {
    console.log(`    ${type}: ${count}`);
  }
  if (mostConnectedFiles.length > 0) {
    console.log(`  Most connected files:`);
    for (const f of mostConnectedFiles) {
      console.log(`    ${f.path} (${f.refs} refs)`);
    }
  }
  if (orphanNodes.length > 0) {
    console.log(`  Orphan nodes: ${orphanNodes.join(", ")}`);
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
    console.log(jsonOut(plans));
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
    console.log(jsonOut(includeBody ? { ...plan, body } : plan));
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
    console.log(jsonOut(entries));
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
    console.log(jsonOut(results));
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
  const audience = extractFlag(args, "--audience") as KnowledgeAudience | undefined;
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
  if (audience && !(KNOWLEDGE_AUDIENCES as readonly string[]).includes(audience)) {
    cliError(`Error: invalid audience "${audience}". Valid: ${KNOWLEDGE_AUDIENCES.join(", ")}`);
    return;
  }

  const token = extractFlag(args, "--token");
  try {
    requireWriteGate(token, slug, "tool:create_project_knowledge_entry");
  } catch (err) {
    if (err instanceof WriteGateError) {
      renderWriteGateError(err, json);
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
      ...(audience && { audience }),
    });

    if (json) {
      console.log(jsonOut(entry));
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
      console.log(jsonOut({ meta, body }));
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
      console.log(jsonOut({ meta }));
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
      renderWriteGateError(err, json);
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
      console.log(jsonOut({ meta }));
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
  const bodyFile = extractFlag(args, "--body-file");
  const bodyStdin = args.includes("--body-stdin");

  // Validate params before consuming the token
  if (!bodyFile && !bodyStdin) {
    cliError("Error: --body-file=<path> is required (provide path to a markdown file with the knowledge body content), or use --body-stdin to read from stdin");
    return;
  }

  if (bodyFile && !existsSync(bodyFile)) {
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

  // Consume token only after all validation passes
  try {
    requireWriteGate(token, slug, "tool:update_project_knowledge_body");
  } catch (err) {
    if (err instanceof WriteGateError) {
      renderWriteGateError(err, json);
      return;
    }
    throw err;
  }

  const rawMeta = await readJsonSafe<unknown>(metaPath);
  if (rawMeta === undefined) {
    cliError(`Error: unable to parse meta for "${entryId}"`);
    return;
  }
  const existingMeta = validateJson(rawMeta, knowledgeMetaSchema, metaPath);
  const bodyPath = resolve(projectDir, existingMeta.file);
  const body = bodyFile ? readFileSync(bodyFile, "utf-8") : await readStdin();

  await writeFile(bodyPath, body, "utf-8");
  const meta = await updateKnowledgeEntry(projectDir, { id: entryId });

  if (json) {
    console.log(jsonOut({ meta, body }));
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
      renderWriteGateError(err, json);
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
      console.log(jsonOut({ deleted: entryId, slug }));
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

function resolveDiagramPath(arg1: string, arg2?: string): { path: string; slug?: string; planId?: string } | undefined {
  // If arg1 contains "/" or ends with ".mmd", treat as raw path
  if (arg1.includes("/") || arg1.endsWith(".mmd")) {
    return { path: arg1 };
  }
  // Otherwise: arg1 = slug, arg2 = planId
  if (!arg2) return undefined;
  const dataDir = getDataDir();
  return { path: resolve(dataDir, "projects", arg1, "plans", `${arg2}.diagram.mmd`), slug: arg1, planId: arg2 };
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

  // `spoc diagram status <slug> <planId> <nodeId> <newStatus> --token=<token>`
  if (subcommand === "status") {
    const token = extractFlag(args, "--token");
    const slug = args[1];
    const planId = args[2];
    const nodeId = args[3];
    const newStatus = args[4];
    if (!slug || !planId || !nodeId || !newStatus) {
      cliError("Error: usage: spoc diagram status <slug> <planId> <nodeId> <status> --token=<token>");
      return;
    }
    requireWriteGate(token, slug, "cli:diagram_status");
    const resolved = resolveDiagramPath(slug, planId);
    if (!resolved) {
      cliError("Error: could not resolve diagram path.");
      return;
    }
    if (!existsSync(resolved.path)) {
      cliError(`Error: No diagram found for plan "${planId}" in project "${slug}". Create one via brainstorm workflow.`);
      return;
    }
    const scriptPath = findDiagramScript();
    if (!scriptPath) {
      cliError("Error: manage-diagram.mjs not found. Install SPOC OpenCode bundle: spoc setup");
      return;
    }
    try {
      const output = execSync(`node "${scriptPath}" status "${resolved.path}" "${nodeId}" "${newStatus}"`, {
        encoding: "utf-8",
        timeout: 10000,
      });
      if (json) {
        try { JSON.parse(output); console.log(output.trim()); } catch { console.log(jsonOut({ output: output.trim() })); }
      } else {
        console.log(output.trim());
      }
    } catch (err) {
      const msg = err instanceof Error ? (err as { stderr?: string }).stderr || err.message : String(err);
      cliError(`Error: diagram status failed: ${msg}`);
    }
    return;
  }

  // `spoc diagram sort-metadata <slug> <planId> --token=<token>`
  if (subcommand === "sort-metadata") {
    const token = extractFlag(args, "--token");
    const slug = args[1];
    const planId = args[2];
    if (!slug || !planId) {
      cliError("Error: usage: spoc diagram sort-metadata <slug> <planId> --token=<token>");
      return;
    }
    requireWriteGate(token, slug, "cli:diagram_sort_metadata");
    const resolved = resolveDiagramPath(slug, planId);
    if (!resolved) {
      cliError("Error: could not resolve diagram path.");
      return;
    }
    if (!existsSync(resolved.path)) {
      cliError(`Error: No diagram found for plan "${planId}" in project "${slug}". Create one via brainstorm workflow.`);
      return;
    }
    const scriptPath = findDiagramScript();
    if (!scriptPath) {
      cliError("Error: manage-diagram.mjs not found. Install SPOC OpenCode bundle: spoc setup");
      return;
    }
    try {
      const output = execSync(`node "${scriptPath}" sort-metadata "${resolved.path}"`, {
        encoding: "utf-8",
        timeout: 10000,
      });
      if (json) {
        try { JSON.parse(output); console.log(output.trim()); } catch { console.log(jsonOut({ output: output.trim() })); }
      } else {
        console.log(output.trim());
      }
    } catch (err) {
      const msg = err instanceof Error ? (err as { stderr?: string }).stderr || err.message : String(err);
      cliError(`Error: diagram sort-metadata failed: ${msg}`);
    }
    return;
  }

  if (subcommand !== "inspect" && subcommand !== "ready" && subcommand !== "validate") {
    cliError(`Error: unknown diagram subcommand "${subcommand}". Use: inspect, ready, validate, status, sort-metadata, show`);
    return;
  }

  const arg1 = args[1];
  if (!arg1) {
    cliError(`Error: usage: spoc diagram ${subcommand} <slug> <planId>  OR  spoc diagram ${subcommand} <path>`);
    return;
  }

  const resolved = resolveDiagramPath(arg1, args[2]);
  if (!resolved) {
    cliError(`Error: usage: spoc diagram ${subcommand} <slug> <planId>  OR  spoc diagram ${subcommand} <path>`);
    return;
  }

  if (!existsSync(resolved.path)) {
    if (resolved.slug && resolved.planId) {
      cliError(`Error: No diagram found for plan "${resolved.planId}" in project "${resolved.slug}". Create one via brainstorm workflow.`);
    } else {
      cliError(`Error: file not found: ${resolved.path}`);
    }
    return;
  }

  const scriptPath = findDiagramScript();
  if (!scriptPath) {
    cliError("Error: manage-diagram.mjs not found. Install SPOC OpenCode bundle: spoc setup");
    return;
  }

  try {
    const output = execSync(`node "${scriptPath}" ${subcommand} "${resolved.path}"`, {
      encoding: "utf-8",
      timeout: 10000,
    });
    if (json) {
      // Try to parse as JSON, otherwise wrap
      try {
        JSON.parse(output);
        console.log(output.trim());
      } catch {
        console.log(jsonOut({ output: output.trim() }));
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

// ---------------------------------------------------------------------------
// Batch op registry and normalization
// ---------------------------------------------------------------------------

interface BatchOpInfo {
  canonical: string;
  aliases: string[];
  description: string;
}

const BATCH_OPS: BatchOpInfo[] = [
  { canonical: "task-create", aliases: ["create_project_task"], description: "Create a new task" },
  { canonical: "task-transition", aliases: ["transition_project_task"], description: "Transition task status" },
  { canonical: "task-update", aliases: ["update_project_task"], description: "Update task metadata" },
  { canonical: "knowledge-create", aliases: ["create_knowledge_entry"], description: "Create a knowledge entry" },
  { canonical: "knowledge-update-meta", aliases: ["update_knowledge_entry"], description: "Update knowledge entry metadata" },
  { canonical: "knowledge-update-body", aliases: ["update_knowledge_body"], description: "Update knowledge entry body" },
  { canonical: "plan-create", aliases: ["create_project_plan"], description: "Create a plan" },
  { canonical: "plan-update-meta", aliases: ["update_project_plan"], description: "Update plan metadata" },
  { canonical: "doc-update", aliases: ["update_project_doc"], description: "Update a project document" },
];

const VALID_OPS = BATCH_OPS.map((o) => o.canonical);

function normalizeBatchOp(op: string): string {
  // Already canonical?
  if (VALID_OPS.includes(op)) return op;
  // Check aliases
  for (const info of BATCH_OPS) {
    if (info.aliases.includes(op)) return info.canonical;
  }
  // Try normalizing: replace spaces/underscores with hyphens, lowercase
  const normalized = op.toLowerCase().replace(/[\s_]+/g, "-");
  if (VALID_OPS.includes(normalized)) return normalized;
  return op; // Return as-is; will fail at switch with good error
}

async function handleBatch(args: string[], json: boolean): Promise<void> {
  // --list-ops: output valid batch operations
  if (args.includes("--list-ops")) {
    if (json) {
      console.log(jsonOut({ ops: BATCH_OPS }));
    } else {
      for (const info of BATCH_OPS) {
        const aliases = info.aliases.length > 0 ? ` (aliases: ${info.aliases.join(", ")})` : "";
        console.log(`${info.canonical}${aliases} — ${info.description}`);
      }
    }
    return;
  }

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
        console.log(jsonOut([{ index: 0, op: ops[0].op, success: false, error: msg }]));
      } else {
        cliError(msg);
      }
      return;
    }
  }

  const results: BatchResult[] = [];

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    op.op = normalizeBatchOp(op.op);
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
          results.push({ index: i, op: op.op, success: false, error: `Unknown op: ${op.op}. Valid ops: ${VALID_OPS.join(", ")}` });
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
    console.log(jsonOut(results));
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
    console.log(jsonOut(report));
  } else {
    console.log(`Validation complete: ${report.summary.issueCount} issues found (${report.summary.totalChecks} checks)`);
    for (const issue of issues) {
      console.log(`  [${issue.severity}] ${issue.kind}: ${issue.message}`);
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
      console.log(jsonOut({ updated: true, slug, doc: docType, path: filePath }));
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
        if (json) console.log(jsonOut({ message: msg }));
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
        if (json) console.log(jsonOut({ message: msg }));
        else console.log(msg);
        return;
      }
      project.dependsOn.splice(idx, 1);
    }

    await writeRootMeta(dataDir, rootMeta);

    const verb = action === "add" ? "Added" : "Removed";
    const msg = `✅ ${verb} dependency: "${slug}" → "${targetSlug}"`;
    if (json) console.log(jsonOut({ message: msg, slug, targetSlug, action }));
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
      console.log(jsonOut({ updated: true, slug, action, paths: updated }));
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
      renderWriteGateError(err, json);
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
      console.log(jsonOut({ message: `Loop started for project "${slug}"`, state }));
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
      renderWriteGateError(err, json);
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
      console.log(jsonOut({ slug, session, cancelled }));
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
        console.log(jsonOut({ slug, state }));
      } else if (state) {
        console.log(`Loop for "${slug}": status=${state.active ? "active" : "idle"}, iteration=${state.iteration}/${state.maxIterations}, session=${state.sessionId}`);
      } else {
        console.log(`No active loop for project "${slug}".`);
      }
    } else {
      const active = await findActiveLoop();
      if (json) {
        console.log(jsonOut(active ? { slug: active.slug, state: active.state } : { message: "No active loop found.", state: null }));
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
        console.log(jsonOut(result));
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
        console.log(jsonOut(result));
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
      renderWriteGateError(err, json);
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
      console.log(jsonOut({ sourcePath, symlinked, warnings }));
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
// agents-md command
// ---------------------------------------------------------------------------

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
    console.log(jsonOut(result));
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
    console.log(jsonOut(result));
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
      console.log(jsonOut(result));
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
    console.log(jsonOut(commits));
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
 * Delegate a migrated command to the registry-based handler.
 * Outputs in the legacy format (raw data to stdout, errors to stderr)
 * for backward compatibility with tests that call handleDagCommand directly.
 */
async function delegateToRegistry(command: string, rawArgs: string[]): Promise<boolean> {
  // Find the subcommand (first non-flag arg) for two-word path matching
  const firstPositional = rawArgs.find(a => !a.startsWith("-"));

  let registeredCmd;
  let remaining: string[];
  if (firstPositional) {
    const twoWord = `${command} ${firstPositional}`;
    const cmd = getCommand(twoWord);
    if (cmd) {
      registeredCmd = cmd;
      // Remove the first occurrence of the subcommand from args
      remaining = [];
      let removed = false;
      for (const arg of rawArgs) {
        if (!removed && arg === firstPositional) {
          removed = true;
          continue;
        }
        remaining.push(arg);
      }
    }
  }
  if (!registeredCmd) {
    const cmd = getCommand(command);
    if (cmd) {
      registeredCmd = cmd;
      remaining = rawArgs;
    }
  }
  if (!registeredCmd) return false;

  const result = parseArgs(registeredCmd, remaining!);
  if (!result.ok) {
    // Registry can't parse these args — signal to caller to try fallback
    return false;
  }
  const cmdResult = await registeredCmd.handler(result.parsed.params, result.parsed.flags);
  if (cmdResult.ok) {
    const flags = result.parsed.flags;
    if (flags.json) {
      const data = flags.lean ? stripLeanTimestamps(cmdResult.data) : cmdResult.data;
      console.log(JSON.stringify(data));
    } else {
      const data = cmdResult.data;
      if (typeof data === "string") {
        console.log(data);
      } else if (data !== null && data !== undefined) {
        console.log(JSON.stringify(data, null, 2));
      }
    }
    return true;
  }
  // Handler returned error — fall through to legacy handler for
  // backward-compatible error formatting
  return false;
}

/** Strip timestamp fields for lean mode compatibility */
function stripLeanTimestamps(data: unknown): unknown {
  if (data === null || data === undefined || typeof data !== "object") return data;
  if (Array.isArray(data)) return data.map(stripLeanTimestamps);
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (key === "createdAt" || key === "updatedAt") continue;
    result[key] = typeof value === "object" ? stripLeanTimestamps(value) : value;
  }
  return result;
}

/**
 * Dispatches DAG CLI subcommands. Returns true if a command was handled.
 */
export async function handleDagCommand(
  command: string,
  args: string[],
): Promise<boolean> {
  const { json, lean, dryRun, rest } = parseFlags(args);

  // Set module-level lean mode for jsonOut helper
  _leanMode = lean;
  _dryRun = dryRun;

  if (rest.includes("--help") || args.includes("--help")) {
    printUsage();
    return true;
  }

  switch (command as DagCommand) {
    case "context":
    case "task":
    case "search":
    case "plan":
    case "knowledge":
    case "batch":
    case "validate":
    case "project":
    case "write":
    case "agents-md": {
      const handled = await delegateToRegistry(command, args);
      if (handled) return true;
      // Fallback to legacy handlers for edge cases not covered by registry
      switch (command) {
        case "context": await handleContext(rest, json); return true;
        case "task": await handleTask(rest, json); return true;
        case "search": await handleSearch(rest, json); return true;
        case "plan": await handlePlan(rest, json); return true;
        case "knowledge": await handleKnowledge(rest, json); return true;
        case "batch": await handleBatch(rest, json); return true;
        case "validate": await handleValidate(rest, json); return true;
        default: return false;
      }
    }

    case "related":
      await handleRelated(rest, json);
      return true;

    case "diagram":
      await handleDiagram(rest, json);
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

    case "graph":
      await handleGraph(rest, json);
      return true;

    default:
      return false;
  }
}
