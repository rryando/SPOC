// ---------------------------------------------------------------------------
// Batch command — registry-based
// ---------------------------------------------------------------------------

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getProjectDir } from "../../utils/paths.js";
import { PROJECT_DOC_FILES, type ProjectDocType } from "../../utils/project-documents.js";
import {
  createKnowledgeEntry,
  createPlan,
  createTask,
  type FileRef,
  type KnowledgeKind,
  type PlanStatus,
  type TaskPriority,
  type TaskStatus,
  updateKnowledgeEntry,
  updatePlan,
  updateTask,
} from "../../utils/project-memory.js";
import { normalizeIdentifier } from "../../utils/slug.js";
import {
  type CLIResult,
  type CommandFlags,
  defineCommand,
} from "../command-registry.js";
import { failure, success } from "../output-envelope.js";
import { attemptDiagramUpdate } from "./task.js";

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
  description: string;
}

const BATCH_OPS: BatchOpInfo[] = [
  { canonical: "task-create", description: "Create a new task" },
  { canonical: "task-transition", description: "Transition task status" },
  { canonical: "task-update", description: "Update task metadata" },
  { canonical: "knowledge-create", description: "Create a knowledge entry" },
  { canonical: "knowledge-update-meta", description: "Update knowledge entry metadata" },
  { canonical: "knowledge-update-body", description: "Update knowledge entry body" },
  { canonical: "plan-create", description: "Create a plan" },
  { canonical: "plan-update-meta", description: "Update plan metadata" },
  { canonical: "doc-update", description: "Update a project document" },
];

/**
 * Validate that a batch op name is one of the canonical kebab-case
 * operations. No alias resolution — legacy `tool:` / `cli:` / snake_case
 * names are rejected with a clear error downstream.
 */
function normalizeBatchOp(op: string): string {
  return op;
}

defineCommand({
  path: "batch",
  description: "Run batch operations from a JSON file",
  mutation: true,
  params: {
    file: {
      type: "string",
      required: (params) => !params["list-ops"],
      description: "Path to JSON file with operations",
    },
    "list-ops": { type: "boolean", description: "List valid batch operations" },
  },
  handler: handleBatch,
});

async function handleBatch(
  params: Record<string, unknown>,
  _flags: CommandFlags,
): Promise<CLIResult> {
  const listOps = params["list-ops"] as boolean | undefined;
  if (listOps) {
    return success({ ops: BATCH_OPS });
  }

  const filePath = params.file as string;
  if (!existsSync(filePath)) {
    return failure("file_not_found", `Batch file not found: ${filePath}`);
  }

  let ops: BatchOp[];
  try {
    const raw = readFileSync(filePath, "utf-8");
    ops = JSON.parse(raw);
    if (!Array.isArray(ops)) {
      return failure("invalid_format", "Batch file must contain a JSON array");
    }
  } catch (err) {
    return failure(
      "parse_error",
      `Failed to parse batch file: ${err instanceof Error ? err.message : String(err)}`,
    );
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

          // Atomic diagram update if both planId and diagramNodeId provided
          const planId = op.planId as string | undefined;
          const diagramNodeId = op.diagramNodeId as string | undefined;
          if (planId && diagramNodeId) {
            const diagramResult = attemptDiagramUpdate(op.slug, planId, diagramNodeId, status);
            results.push({
              index: i,
              op: op.op,
              success: true,
              result: { taskId, status, diagramNodeId, ...diagramResult },
            });
          } else {
            results.push({ index: i, op: op.op, success: true, result: { taskId, status } });
          }
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
          results.push({
            index: i,
            op: op.op,
            success: true,
            result: { taskId: task.id, status: task.status },
          });
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
          results.push({
            index: i,
            op: op.op,
            success: true,
            result: { planId: plan.id, status: plan.status },
          });
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
      results.push({
        index: i,
        op: op.op,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return success(results);
}
