// ---------------------------------------------------------------------------
// Utility commands — context, search, agents-md, batch, validate (registry-based)
// ---------------------------------------------------------------------------

import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { defineCommand, type CLIResult, type CommandFlags, ERROR_CODES } from "../command-registry.js";
import { success, failure } from "../output-envelope.js";
import { getDataDir, getProjectDir } from "../../utils/paths.js";
import { readRootMeta } from "../../utils/dag.js";
import { readJsonSafe, validateJson } from "../../utils/json.js";
import { projectMetaSchema } from "../../utils/json-schemas.js";
import { findBestMatch, type WorkspaceProject } from "../../utils/workspace-match.js";
import { extractOverviewContent } from "../../utils/content-assembly.js";
import {
  listTasks,
  readKnowledgeIndex,
  readPlanIndex,
  createKnowledgeEntry,
  createTask,
  updateTask,
  updateKnowledgeEntry,
  updatePlan,
  createPlan,
  deleteTask,
  deleteKnowledgeEntry,
  deletePlan,
  type FileRef,
  type KnowledgeAudience,
  type KnowledgeKind,
  type TaskStatus,
  type TaskPriority,
  type PlanStatus,
  KNOWLEDGE_AUDIENCES,
} from "../../utils/project-memory.js";
import { normalizeIdentifier } from "../../utils/slug.js";
import { buildProjectRetrievalIndex } from "../../retrieval/index-builder.js";
import { selectKnowledgeEntries } from "../dag-commands.js";
import { requireWriteGate } from "../../utils/write-gate.js";
import { PROJECT_DOC_FILES, type ProjectDocType } from "../../utils/project-documents.js";

// ---------------------------------------------------------------------------
// context
// ---------------------------------------------------------------------------

defineCommand({
  path: "context",
  description: "Resolve project context for a workspace path or slug",
  params: {
    pathOrSlug: { type: "string", positional: 0, description: "Absolute path or project slug (defaults to cwd)" },
    audience: { type: "string", description: "Target audience for knowledge filtering", enum: ["orchestrator", "implementer", "designer"] },
    task: { type: "string", description: "Task ID for scoped context" },
    "no-graph": { type: "boolean", description: "Skip graph-based retrieval" },
  },
  handler: handleContext,
});

async function handleContext(params: Record<string, unknown>, flags: CommandFlags): Promise<CLIResult> {
  const rawArg = params.pathOrSlug as string | undefined;
  const audience = params.audience as KnowledgeAudience | undefined;
  const taskIdFlag = params.task as string | undefined;
  const noGraph = params["no-graph"] as boolean | undefined;

  if (audience && !(KNOWLEDGE_AUDIENCES as readonly string[]).includes(audience)) {
    return failure("invalid_enum", `Invalid audience "${audience}". Valid: ${KNOWLEDGE_AUDIENCES.join(", ")}`);
  }

  // Resolve path/slug
  let queryPath: string;
  if (!rawArg) {
    queryPath = process.cwd();
  } else if (rawArg.startsWith("/")) {
    queryPath = rawArg;
  } else if (!rawArg.includes("/") && !rawArg.includes(".")) {
    // Slug resolution
    const dataDir = getDataDir();
    const projMetaPath = resolve(dataDir, "projects", rawArg, "meta.json");
    if (!existsSync(projMetaPath)) {
      return failure(ERROR_CODES.PROJECT_NOT_FOUND, `Project "${rawArg}" not found in SPOC`);
    }
    try {
      const projMeta = JSON.parse(readFileSync(projMetaPath, "utf-8"));
      const paths: string[] = Array.isArray(projMeta.workspacePaths) ? projMeta.workspacePaths : [];
      if (paths.length === 0) {
        return failure("no_workspace_paths", `Project "${rawArg}" has no workspace paths configured`);
      }
      const first = paths[0];
      queryPath = first.startsWith("~")
        ? resolve(homedir(), first.slice(2))
        : resolve(first);
    } catch {
      return failure("read_error", `Could not read project metadata for "${rawArg}"`);
    }
  } else {
    queryPath = resolve(rawArg);
    if (!existsSync(queryPath)) {
      return failure("path_not_found", `Path "${rawArg}" does not exist. Use an absolute path or a project slug.`);
    }
  }

  // Read root meta
  const dataDir = getDataDir();
  let rootMeta;
  try {
    rootMeta = await readRootMeta(dataDir);
  } catch {
    return failure("read_error", "Could not read SPOC data directory");
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
    return failure("no_match", `No project found matching path "${queryPath}"`);
  }
  if (matchResult.kind === "ambiguous") {
    return failure("ambiguous_match", `Ambiguous match for "${queryPath}" — matches: ${matchResult.slugs.join(", ")}`);
  }

  const slug = matchResult.slug;
  const projectDir = getProjectDir(slug);
  const meta = projectMetas.get(slug);
  const name = meta?.name ?? slug;
  const description = meta?.description ?? "";

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

  return success({
    slug,
    name,
    description,
    overview,
    tasks: allTasks,
    plans: planIndex.plans,
    knowledge: filteredKnowledge,
  });
}

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

defineCommand({
  path: "search",
  description: "BM25 search across all project entities",
  params: {
    slug: { type: "string", required: true, positional: 0, description: "Project slug" },
    query: { type: "string", required: true, positional: 1, description: "Search query" },
    kind: { type: "string", description: "Filter results by entity kind" },
    limit: { type: "number", default: 10, description: "Max results to return" },
  },
  handler: handleSearch,
});

async function handleSearch(params: Record<string, unknown>, _flags: CommandFlags): Promise<CLIResult> {
  const slug = params.slug as string;
  const query = params.query as string;
  const kind = params.kind as string | undefined;
  const limit = (params.limit as number) ?? 10;

  const projectDir = getProjectDir(slug);
  if (!existsSync(projectDir)) {
    return failure(ERROR_CODES.PROJECT_NOT_FOUND, `Project "${slug}" not found`, {
      hint: "Run 'spoc project list' to see available projects.",
    });
  }

  const index = await buildProjectRetrievalIndex(slug);
  let results = index.searchAll(query, limit);

  if (kind) {
    results = results.filter((r) => r.type === kind);
  }

  return success(results);
}

// ---------------------------------------------------------------------------
// agents-md
// ---------------------------------------------------------------------------

defineCommand({
  path: "agents-md",
  description: "Read project's AGENTS.md content",
  params: {
    slug: { type: "string", required: true, positional: 0, description: "Project slug" },
  },
  handler: handleAgentsMd,
});

async function handleAgentsMd(params: Record<string, unknown>, _flags: CommandFlags): Promise<CLIResult> {
  const slug = params.slug as string;

  const projectDir = getProjectDir(slug);
  if (!existsSync(projectDir)) {
    return failure(ERROR_CODES.PROJECT_NOT_FOUND, `Project "${slug}" not found`, {
      hint: "Run 'spoc project list' to see available projects.",
    });
  }

  const agentsMdPath = resolve(projectDir, "AGENTS.md");
  if (!existsSync(agentsMdPath)) {
    return failure(ERROR_CODES.ENTITY_NOT_FOUND, `No AGENTS.md found for project '${slug}'`, {
      hint: `Run: spoc sync-agents-md ${slug} --analysis-file=<path> --token=<token>`,
    });
  }

  const content = readFileSync(agentsMdPath, "utf-8");
  return success({ slug, content });
}

// ---------------------------------------------------------------------------
// batch
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
  if (VALID_OPS.includes(op)) return op;
  for (const info of BATCH_OPS) {
    if (info.aliases.includes(op)) return info.canonical;
  }
  const normalized = op.toLowerCase().replace(/[\s_]+/g, "-");
  if (VALID_OPS.includes(normalized)) return normalized;
  return op;
}

defineCommand({
  path: "batch",
  description: "Run batch operations from a JSON file",
  gated: true,
  mutation: true,
  gateName: "batch",
  params: {
    file: { type: "string", required: (params) => !params["list-ops"], description: "Path to JSON file with operations" },
    token: { type: "string", description: "Write-gate token" },
    "list-ops": { type: "boolean", description: "List valid batch operations" },
  },
  handler: handleBatch,
});

async function handleBatch(params: Record<string, unknown>, _flags: CommandFlags): Promise<CLIResult> {
  const listOps = params["list-ops"] as boolean | undefined;
  if (listOps) {
    return success({ ops: BATCH_OPS });
  }

  const filePath = params.file as string;
  if (!existsSync(filePath)) {
    return failure("file_not_found", `Batch file not found: ${filePath}`);
  }

  const token = params.token as string | undefined;

  let ops: BatchOp[];
  try {
    const raw = readFileSync(filePath, "utf-8");
    ops = JSON.parse(raw);
    if (!Array.isArray(ops)) {
      return failure("invalid_format", "Batch file must contain a JSON array");
    }
  } catch (err) {
    return failure("parse_error", `Failed to parse batch file: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Validate write gate once for the entire batch
  if (ops.length > 0) {
    try {
      requireWriteGate(token, ops[0].slug, "batch");
    } catch (err) {
      return failure("write_gate_error", err instanceof Error ? err.message : String(err));
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
        case "knowledge-update-meta": {
          const projectDir = getProjectDir(op.slug);
          const entryId2 = op.entryId as string;
          if (!entryId2) throw new Error("entryId required");
          const entry = await updateKnowledgeEntry(projectDir, {
            id: entryId2,
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
          const normalizedId2 = normalizeIdentifier(entryId);
          const metaPath2 = resolve(projectDir, "knowledge", `${normalizedId2}.meta.json`);
          if (!existsSync(metaPath2)) throw new Error(`knowledge entry not found: ${entryId}`);
          const rawMeta2 = JSON.parse(readFileSync(metaPath2, "utf-8"));
          const bodyPath = resolve(projectDir, rawMeta2.file);
          const { writeFile: writeFileAsync } = await import("node:fs/promises");
          await writeFileAsync(bodyPath, body, "utf-8");
          results.push({ index: i, op: op.op, success: true, result: { entryId } });
          break;
        }
        case "plan-create": {
          const projectDir = getProjectDir(op.slug);
          const title = op.title as string;
          if (!title) throw new Error("title required");
          const planId = normalizeIdentifier(title);
          const plan = await createPlan(projectDir, {
            id: planId,
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
        case "doc-update": {
          const projectDir = getProjectDir(op.slug);
          const docType = op.docType as ProjectDocType;
          const content = op.content as string;
          if (!docType || !content) throw new Error("docType and content required");
          const docFile = PROJECT_DOC_FILES[docType];
          if (!docFile) throw new Error(`Unknown doc type: ${docType}`);
          const docPath = resolve(projectDir, docFile);
          const { writeFile } = await import("node:fs/promises");
          await writeFile(docPath, content, "utf-8");
          results.push({ index: i, op: op.op, success: true, result: { docType } });
          break;
        }
        default:
          results.push({ index: i, op: op.op, success: false, error: `Unknown op: ${op.op}` });
      }
    } catch (err) {
      results.push({ index: i, op: op.op, success: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return success(results);
}

// ---------------------------------------------------------------------------
// validate
// ---------------------------------------------------------------------------

defineCommand({
  path: "validate",
  description: "Run health checks on a project's DAG state",
  params: {
    slug: { type: "string", required: true, positional: 0, description: "Project slug" },
  },
  handler: handleValidate,
});

interface ValidationIssue {
  severity: "error" | "warning" | "info";
  kind: string;
  message: string;
  file?: string;
  repair?: string;
  safeToAutoRepair?: boolean;
}

async function handleValidate(params: Record<string, unknown>, _flags: CommandFlags): Promise<CLIResult> {
  const slug = params.slug as string;

  const projectDir = getProjectDir(slug);
  if (!existsSync(projectDir)) {
    return failure(ERROR_CODES.PROJECT_NOT_FOUND, `Project "${slug}" not found`, {
      hint: "Run 'spoc project list' to see available projects.",
    });
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

  return success({
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
  });
}
