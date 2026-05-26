// ---------------------------------------------------------------------------
// Project commands — registry-based
// ---------------------------------------------------------------------------

import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { defineCommand, type CLIResult, type CommandFlags, ERROR_CODES } from "../command-registry.js";
import { success, failure } from "../output-envelope.js";
import { readRootMeta, validateDependencies, wouldCreateCycle, writeRootMeta } from "../../utils/dag.js";
import { readJsonSafe } from "../../utils/json.js";
import { getDataDir, getProjectDir } from "../../utils/paths.js";
import { slugify } from "../../utils/slug.js";
import { normalizeWorkspacePath } from "../../utils/workspace-match.js";
import { getTemplatePath, renderTemplate } from "../../utils/template.js";
import { PROJECT_DOC_FILES, type ProjectDocType } from "../../utils/project-documents.js";
import {
  readKnowledgeIndex,
  readPlanIndex,
  listTasks,
} from "../../utils/project-memory.js";
import {
  requireWriteGate,
  WriteGateError,
} from "../../utils/write-gate.js";

// ---------------------------------------------------------------------------
// project list
// ---------------------------------------------------------------------------

defineCommand({
  path: "project list",
  description: "List all tracked projects",
  params: {},
  handler: handleProjectList,
});

async function handleProjectList(_params: Record<string, unknown>, _flags: CommandFlags): Promise<CLIResult> {
  const dataDir = getDataDir();
  let rootMeta;
  try {
    rootMeta = await readRootMeta(dataDir);
  } catch {
    return failure("read_error", "Could not read SPOC data directory");
  }

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

  return success(projects);
}

// ---------------------------------------------------------------------------
// project get
// ---------------------------------------------------------------------------

defineCommand({
  path: "project get",
  description: "Get project metadata or a specific document",
  params: {
    slug: { type: "string", required: true, positional: 0, description: "Project slug" },
    doc: { type: "string", description: "Specific doc to retrieve", enum: ["overview", "tasks", "dependencies", "knowledge"] },
  },
  handler: handleProjectGet,
});

async function handleProjectGet(params: Record<string, unknown>, _flags: CommandFlags): Promise<CLIResult> {
  const slug = params.slug as string;
  const doc = params.doc as ProjectDocType | undefined;

  const projectDir = getProjectDir(slug);
  if (!existsSync(projectDir)) {
    return failure(ERROR_CODES.PROJECT_NOT_FOUND, `Project "${slug}" not found`, {
      hint: "Run 'spoc project list' to see available projects.",
    });
  }

  if (doc) {
    const fileName = PROJECT_DOC_FILES[doc];
    if (!fileName) {
      return failure(ERROR_CODES.INVALID_ENUM, `Invalid doc type "${doc}". Valid: overview, tasks, dependencies, knowledge`);
    }
    const filePath = resolve(projectDir, fileName);
    if (!existsSync(filePath)) {
      return failure(ERROR_CODES.ENTITY_NOT_FOUND, `Doc file not found: ${fileName}`);
    }
    const content = await readFile(filePath, "utf-8");
    return success({ slug, doc, content });
  }

  // Return project metadata
  const metaPath = resolve(projectDir, "meta.json");
  const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
  return success(meta);
}

// ---------------------------------------------------------------------------
// project init
// ---------------------------------------------------------------------------

defineCommand({
  path: "project init",
  description: "Initialize a new project",
  params: {
    name: { type: "string", required: true, positional: 0, description: "Project name" },
    description: { type: "string", required: true, description: "Project description" },
    path: { type: "string", description: "Workspace path to associate" },
    token: { type: "string", description: "Write-gate token" },
  },
  handler: handleProjectInit,
});

async function handleProjectInit(params: Record<string, unknown>, flags: CommandFlags): Promise<CLIResult> {
  const name = params.name as string;
  const description = params.description as string;
  const wsPath = params.path as string | undefined;
  const token = params.token as string | undefined;

  const slug = slugify(name);

  if (flags.dryRun) {
    return success({ dryRun: true, wouldCreate: { slug, name, description, path: wsPath ?? process.cwd() } });
  }

  try {
    requireWriteGate(token, slug, "tool:init_project");
  } catch (err) {
    if (err instanceof WriteGateError) {
      return failure(err.code, err.message, { hint: err.hint });
    }
    throw err;
  }

  const dataDir = getDataDir();
  const projectDir = resolve(dataDir, "projects", slug);

  try {
    const rootMeta = await readRootMeta(dataDir);

    if (rootMeta.projects.some((p) => p.id === slug)) {
      return failure("already_exists", `Project "${slug}" already exists`);
    }

    await mkdir(projectDir, { recursive: true });

    const now = new Date().toISOString();
    const variables: Record<string, string> = {
      id: slug,
      name,
      description,
      repoUrl: "",
      status: "draft",
      createdAt: now,
      dependsOnList: "—",
      statusBlock: "**Status:** draft\n",
      repoBlock: "",
      upstreamBlock: "- None",
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
    metaObj.workspacePaths = [normalizeWorkspacePath(wsPath ?? process.cwd())];
    await writeFile(metaJsonPath, JSON.stringify(metaObj, null, 2), "utf-8");

    // Create indexes
    await mkdir(resolve(projectDir, "plans"), { recursive: true });
    await mkdir(resolve(projectDir, "knowledge"), { recursive: true });
    await mkdir(resolve(projectDir, "tasks"), { recursive: true });
    await writeFile(resolve(projectDir, "plans", "index.json"), JSON.stringify({ plans: [] }, null, 2), "utf-8");
    await writeFile(resolve(projectDir, "knowledge", "index.json"), JSON.stringify({ entries: [] }, null, 2), "utf-8");
    await writeFile(resolve(projectDir, "tasks", "index.json"), JSON.stringify({ tasks: [] }, null, 2), "utf-8");

    // Update root meta
    rootMeta.projects.push({ id: slug, name, status: "draft", dependsOn: [] });
    await writeRootMeta(dataDir, rootMeta);

    return success({ slug, name, status: "draft", dependsOn: [] });
  } catch (err) {
    return failure("init_error", err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// project update-doc
// ---------------------------------------------------------------------------

defineCommand({
  path: "project update-doc",
  description: "Update a project document",
  params: {
    slug: { type: "string", required: true, positional: 0, description: "Project slug" },
    doc: { type: "string", required: true, positional: 1, description: "Document to update", enum: ["overview", "tasks", "dependencies", "knowledge"] },
    "body-file": { type: "string", description: "Path to file with new doc content" },
    "body-stdin": { type: "boolean", description: "Read content from stdin" },
    token: { type: "string", description: "Write-gate token" },
  },
  handler: handleProjectUpdateDoc,
});

async function handleProjectUpdateDoc(params: Record<string, unknown>, flags: CommandFlags): Promise<CLIResult> {
  const slug = params.slug as string;
  const doc = params.doc as ProjectDocType;
  const bodyFile = params["body-file"] as string | undefined;
  const bodyStdin = params["body-stdin"] as boolean | undefined;
  const token = params.token as string | undefined;

  const validDocs = Object.keys(PROJECT_DOC_FILES);
  if (!validDocs.includes(doc)) {
    return failure(ERROR_CODES.INVALID_ENUM, `Invalid doc type "${doc}". Valid: ${validDocs.join(", ")}`);
  }

  const projectDir = getProjectDir(slug);
  if (!existsSync(projectDir)) {
    return failure(ERROR_CODES.PROJECT_NOT_FOUND, `Project "${slug}" not found`);
  }

  if (!bodyFile && !bodyStdin) {
    return failure(ERROR_CODES.MISSING_PARAM, "Either --body-file or --body-stdin is required", {
      param: "body-file",
    });
  }

  if (flags.dryRun) {
    return success({ dryRun: true, wouldUpdate: { slug, doc, bodyFile } });
  }

  try {
    requireWriteGate(token, slug, "cli:doc_update");
  } catch (err) {
    if (err instanceof WriteGateError) {
      return failure(err.code, err.message, { hint: err.hint });
    }
    throw err;
  }

  let content: string;
  if (bodyFile) {
    if (!existsSync(bodyFile)) {
      return failure(ERROR_CODES.ENTITY_NOT_FOUND, `Body file not found: ${bodyFile}`);
    }
    content = readFileSync(bodyFile, "utf-8");
  } else {
    // Read from stdin
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }
    content = Buffer.concat(chunks).toString("utf-8");
  }

  const fileName = PROJECT_DOC_FILES[doc];
  const filePath = resolve(projectDir, fileName);

  try {
    await writeFile(filePath, content, "utf-8");
    return success({ updated: true, slug, doc, path: filePath });
  } catch (err) {
    return failure("write_error", err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// project update-status
// ---------------------------------------------------------------------------

defineCommand({
  path: "project update-status",
  description: "Update a project's status",
  params: {
    slug: { type: "string", required: true, positional: 0, description: "Project slug" },
    status: { type: "string", required: true, positional: 1, description: "New status", enum: ["active", "paused", "completed", "archived"] },
    token: { type: "string", description: "Write-gate token" },
  },
  handler: handleProjectUpdateStatus,
});

async function handleProjectUpdateStatus(params: Record<string, unknown>, flags: CommandFlags): Promise<CLIResult> {
  const slug = params.slug as string;
  const status = params.status as string;
  const token = params.token as string | undefined;

  if (flags.dryRun) {
    return success({ dryRun: true, wouldUpdate: { slug, status } });
  }

  try {
    requireWriteGate(token, slug, "tool:update_project_status");
  } catch (err) {
    if (err instanceof WriteGateError) {
      return failure(err.code, err.message, { hint: err.hint });
    }
    throw err;
  }

  const dataDir = getDataDir();
  try {
    const rootMeta = await readRootMeta(dataDir);
    const project = rootMeta.projects.find((p) => p.id === slug);
    if (!project) {
      return failure(ERROR_CODES.PROJECT_NOT_FOUND, `Project "${slug}" not found`);
    }

    const oldStatus = project.status;
    project.status = status;
    await writeRootMeta(dataDir, rootMeta);

    return success({ slug, previousStatus: oldStatus, newStatus: status });
  } catch (err) {
    return failure("update_error", err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// project update-paths
// ---------------------------------------------------------------------------

defineCommand({
  path: "project update-paths",
  description: "Add or remove workspace paths for a project",
  params: {
    slug: { type: "string", required: true, positional: 0, description: "Project slug" },
    add: { type: "string", description: "Path to add to workspace paths" },
    remove: { type: "string", description: "Path to remove from workspace paths" },
    token: { type: "string", description: "Write-gate token" },
  },
  handler: handleProjectUpdatePaths,
});

async function handleProjectUpdatePaths(params: Record<string, unknown>, flags: CommandFlags): Promise<CLIResult> {
  const slug = params.slug as string;
  const addPath = params.add as string | undefined;
  const removePath = params.remove as string | undefined;
  const token = params.token as string | undefined;

  if (!addPath && !removePath) {
    return failure(ERROR_CODES.MISSING_PARAM, "Either --add or --remove is required", {
      param: "add",
    });
  }

  const projectDir = getProjectDir(slug);
  if (!existsSync(projectDir)) {
    return failure(ERROR_CODES.PROJECT_NOT_FOUND, `Project "${slug}" not found`);
  }

  if (flags.dryRun) {
    return success({ dryRun: true, wouldUpdate: { slug, add: addPath, remove: removePath } });
  }

  try {
    requireWriteGate(token, slug, "tool:update_project_paths");
  } catch (err) {
    if (err instanceof WriteGateError) {
      return failure(err.code, err.message, { hint: err.hint });
    }
    throw err;
  }

  const metaPath = resolve(projectDir, "meta.json");
  try {
    const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
    const paths: string[] = meta.workspacePaths ?? [];

    if (addPath) {
      const normalized = normalizeWorkspacePath(addPath);
      if (!paths.includes(normalized)) {
        paths.push(normalized);
      }
    }

    if (removePath) {
      const normalized = normalizeWorkspacePath(removePath);
      const idx = paths.indexOf(normalized);
      if (idx >= 0) {
        paths.splice(idx, 1);
      }
    }

    meta.workspacePaths = paths;
    await writeFile(metaPath, JSON.stringify(meta, null, 2), "utf-8");

    return success({ slug, workspacePaths: paths });
  } catch (err) {
    return failure("update_error", err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// project validate
// ---------------------------------------------------------------------------

defineCommand({
  path: "project validate",
  description: "Run structural health checks on a project",
  params: {
    slug: { type: "string", required: true, positional: 0, description: "Project slug" },
  },
  handler: handleProjectValidate,
});

interface ValidationIssue {
  severity: "error" | "warning" | "info";
  kind: string;
  message: string;
  file?: string;
  repair?: string;
  safeToAutoRepair: boolean;
}

async function handleProjectValidate(params: Record<string, unknown>, _flags: CommandFlags): Promise<CLIResult> {
  const slug = params.slug as string;

  const projectDir = getProjectDir(slug);
  if (!existsSync(projectDir)) {
    return failure(ERROR_CODES.PROJECT_NOT_FOUND, `Project "${slug}" not found`);
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

  return success(report);
}
