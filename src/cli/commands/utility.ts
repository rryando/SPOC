// ---------------------------------------------------------------------------
// Utility commands — context, search, agents-md, validate (registry-based)
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
  type KnowledgeAudience,
  KNOWLEDGE_AUDIENCES,
} from "../../utils/project-memory.js";
import { buildProjectRetrievalIndex } from "../../retrieval/index-builder.js";

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
