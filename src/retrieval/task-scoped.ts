/**
 * Task-scoped context retrieval — expands a task's metadata into a query
 * and searches the project's unified retrieval index for relevant entries.
 */

import { buildProjectRetrievalIndex, type ScoredEntry } from "./index-builder.js";

export interface TaskContext {
  title: string;
  planKeywords?: string[];
  sourceFiles?: Array<{ path: string; anchor?: string }>;
}

/**
 * Extracts meaningful path segments from a source file path.
 * Takes the last 2-3 segments (directories + filename) and strips extensions.
 */
function expandSourceFile(file: { path: string; anchor?: string }): string {
  const segments = file.path.split("/").filter(Boolean);
  const meaningful = segments.slice(-3);
  // Strip extension from filename
  const last = meaningful[meaningful.length - 1];
  if (last) {
    meaningful[meaningful.length - 1] = last.replace(/\.[^.]+$/, "");
  }
  const parts = meaningful.join(" ");
  return file.anchor ? `${parts} ${file.anchor}` : parts;
}

/**
 * Builds an expanded query string from task metadata for better recall.
 */
export function buildTaskQuery(task: TaskContext): string {
  const parts: string[] = [];

  if (task.title) {
    parts.push(task.title);
  }

  if (task.planKeywords?.length) {
    parts.push(task.planKeywords.join(" "));
  }

  if (task.sourceFiles?.length) {
    for (const file of task.sourceFiles) {
      parts.push(expandSourceFile(file));
    }
  }

  return parts.join(" ");
}

/**
 * Retrieves relevant knowledge and plan entries for a given task context.
 * Returns top-N entries sorted by relevance score.
 */
export async function retrieveForTask(
  slug: string,
  task: TaskContext,
  limit = 10,
): Promise<ScoredEntry[]> {
  if (!task.title) {
    return [];
  }

  const query = buildTaskQuery(task);
  const index = await buildProjectRetrievalIndex(slug);
  return index.searchAll(query, limit);
}
