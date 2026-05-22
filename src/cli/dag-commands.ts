// ---------------------------------------------------------------------------
// DAG CLI Command Handlers
// ---------------------------------------------------------------------------

import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import {
  extractBacklogTasks,
  extractInProgressTasks,
  extractOverviewContent,
} from "../utils/content-assembly.js";
import { readRootMeta } from "../utils/dag.js";
import { readJsonSafe, validateJson } from "../utils/json.js";
import { projectMetaSchema } from "../utils/json-schemas.js";
import { getDataDir, getProjectDir } from "../utils/paths.js";
import {
  createKnowledgeEntry,
  getTask,
  listTasks,
  readKnowledgeIndex,
  readPlanIndex,
  KNOWLEDGE_KINDS,
  PLAN_STATUSES,
  TASK_STATUSES,
  updateTask,
  type FileRef,
  type KnowledgeKind,
  type PlanStatus,
  type TaskStatus,
  type TaskPriority,
  TASK_PRIORITIES,
} from "../utils/project-memory.js";
import { normalizeIdentifier } from "../utils/slug.js";
import { findBestMatch, type WorkspaceProject } from "../utils/workspace-match.js";
import { buildProjectRetrievalIndex } from "../retrieval/index-builder.js";
import { deriveOperatingBrief, safeTime } from "../utils/workflow-policy.js";

const DAG_COMMANDS = [
  "context",
  "task",
  "plan",
  "knowledge",
  "search",
  "diagram",
  "batch",
  "validate",
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
    default:
      // If subcommand isn't a known command, treat it as a slug for listing
      if (subcommand && !['list', 'get', 'transition'].includes(subcommand)) {
        return handleTaskList(args.slice(1), json, subcommand);
      }
      cliError(`Error: unknown task subcommand "${subcommand ?? ""}". Use: list, get, transition`);
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
    cliError("Error: usage: spoc task transition <slug> <taskId> <status>");
    return;
  }

  if (!(TASK_STATUSES as readonly string[]).includes(status)) {
    cliError(`Error: invalid status "${status}". Valid: ${TASK_STATUSES.join(", ")}`);
    return;
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

// ---------------------------------------------------------------------------
// search command
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
    default:
      // If subcommand isn't a known command, treat it as a slug for listing
      if (subcommand && !['list', 'get'].includes(subcommand)) {
        return handlePlanList(args.slice(1), json, subcommand);
      }
      cliError(`Error: unknown plan subcommand "${subcommand ?? ""}". Use: list, get`);
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
    default:
      // If subcommand isn't a known command, treat it as a slug for listing
      if (subcommand && !['list', 'search', 'create'].includes(subcommand)) {
        return handleKnowledgeList(args.slice(1), json, subcommand);
      }
      cliError(`Error: unknown knowledge subcommand "${subcommand ?? ""}". Use: list, search, create`);
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

// ---------------------------------------------------------------------------
// diagram command
// ---------------------------------------------------------------------------

function findDiagramScript(): string | undefined {
  const localPath = resolve(import.meta.dirname, "../../opencode/superpowers/skills/to-diagram/scripts/manage-diagram.mjs");
  if (existsSync(localPath)) return localPath;

  const configPath = resolve(homedir(), ".config/opencode/skills/superpowers/to-diagram/scripts/manage-diagram.mjs");
  if (existsSync(configPath)) return configPath;

  return undefined;
}

async function handleDiagram(args: string[], json: boolean): Promise<void> {
  const subcommand = args[0];

  if (subcommand !== "inspect" && subcommand !== "ready") {
    cliError(`Error: unknown diagram subcommand "${subcommand ?? ""}". Use: inspect, ready`);
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

    default:
      return false;
  }
}
