// ---------------------------------------------------------------------------
// Knowledge entry selection using graph traversal + BM25 + recency fallback
// ---------------------------------------------------------------------------

import { getProjectDir } from "../utils/paths.js";
import { getTask, type KnowledgeMeta } from "../utils/project-memory.js";
import { safeTime } from "../utils/workflow-policy.js";
import { retrieveRelated } from "./graph-retrieval.js";
import { retrieveForTask, type TaskContext } from "./task-scoped.js";

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
    const sorted = [...entries].sort((a, b) => safeTime(b.updatedAt) - safeTime(a.updatedAt));
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
    const sorted = [...entries].sort((a, b) => safeTime(b.updatedAt) - safeTime(a.updatedAt));
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
