/**
 * High-level graph retrieval API — combines graph building, traversal,
 * and result hydration into a single call.
 */

import type { AdjacencyIndex, NodeType, ScoredNode } from "./graph-types.js";
import { traverseFrom } from "./graph-traverse.js";
import { createGraphCache } from "./graph-cache.js";
import { registerGraphCacheInvalidator } from "./graph-invalidate.js";
import { getProjectDir } from "../utils/paths.js";
import {
  readKnowledgeIndex,
  readPlanIndex,
  listTasks,
  type KnowledgeMeta,
  type PlanMeta,
  type TaskMeta,
} from "../utils/project-memory.js";

// Module-level singleton cache
const graphCache = createGraphCache();
registerGraphCacheInvalidator((slug) => graphCache.invalidate(slug));

export interface RelatedResult {
  id: string;
  type: NodeType;
  title: string;
  summary?: string;
  score: number;
  relation: string;
}

export interface RetrieveRelatedOptions {
  limit?: number;
  types?: NodeType[];
  audience?: string;
}

/**
 * Derives a human-readable relation string from the traversal path and graph.
 */
function deriveRelation(scored: ScoredNode, index: AdjacencyIndex): string {
  const { path } = scored;

  // Walk the path and find meaningful edges
  for (let i = 0; i < path.length - 1; i++) {
    const fromId = path[i];
    const toId = path[i + 1];
    const fromNode = index.nodes.get(fromId);
    const toNode = index.nodes.get(toId);

    // If path goes through a file node
    if (toNode?.type === "file") {
      const filePath = toNode.title ?? toId.replace("file:", "");
      return `shares file ${filePath}`;
    }
    if (fromNode?.type === "file") {
      const filePath = fromNode.title ?? fromId.replace("file:", "");
      return `shares file ${filePath}`;
    }

    // Check edge relation
    const edges = index.edges.get(fromId);
    if (edges) {
      const edge = edges.find((e) => e.target === toId);
      if (edge) {
        if (edge.relation === "task_belongs_to_plan" || edge.relation === "plan_contains_task") {
          return "same plan";
        }
        if (edge.relation === "shares_keywords") {
          // Find shared keywords between start and result
          const fromKw = fromNode?.keywords ?? [];
          const toKw = index.nodes.get(scored.node.id)?.keywords ?? [];
          const shared = fromKw.filter((kw) => toKw.includes(kw));
          if (shared.length > 0) {
            return `shares keywords [${shared.join(", ")}]`;
          }
          return "shares keywords";
        }
        if (edge.relation === "shares_source_file") {
          return `shares file`;
        }
      }
    }
  }

  return "related";
}

/**
 * Retrieves entities related to a given start node via graph traversal,
 * hydrating results with metadata (titles, summaries).
 */
export async function retrieveRelated(
  slug: string,
  startNodeId: string,
  options?: RetrieveRelatedOptions,
): Promise<RelatedResult[]> {
  const limit = options?.limit ?? 10;
  const types = options?.types ?? ["knowledge", "plan", "task"];
  const audience = options?.audience;

  // 1. Build/get graph
  let index: AdjacencyIndex;
  try {
    index = await graphCache.getOrBuild(slug);
  } catch {
    return [];
  }

  // 2. Verify start node exists
  if (!index.nodes.has(startNodeId)) {
    return [];
  }

  // 3. Traverse — exclude file nodes from results, over-fetch for post-filtering
  const scored = traverseFrom(index, startNodeId, {
    excludeTypes: ["file"],
    limit: limit * 2,
  });

  // 4. Hydrate — load metadata indexes
  const projectDir = getProjectDir(slug);

  let knowledgeMap = new Map<string, KnowledgeMeta>();
  let planMap = new Map<string, PlanMeta>();
  let taskMap = new Map<string, TaskMeta>();

  try {
    const kIdx = await readKnowledgeIndex(projectDir);
    for (const e of kIdx.entries) knowledgeMap.set(e.id, e);
  } catch {
    // graceful
  }
  try {
    const pIdx = await readPlanIndex(projectDir);
    for (const p of pIdx.plans) planMap.set(p.id, p);
  } catch {
    // graceful
  }
  try {
    const tasks = await listTasks(projectDir);
    for (const t of tasks) taskMap.set(t.id, t);
  } catch {
    // graceful
  }

  // 5. Build results
  const results: RelatedResult[] = [];

  for (const s of scored) {
    const node = s.node;
    const rawId = node.id.replace(/^(task|plan|knowledge|file):/, "");

    // Type filter
    if (!types.includes(node.type)) continue;

    // Hydrate
    let title = node.title ?? rawId;
    let summary: string | undefined;

    if (node.type === "knowledge") {
      const meta = knowledgeMap.get(rawId);
      if (meta) {
        title = meta.title;
        summary = meta.summary || undefined;
        // Audience filter
        if (audience && meta.audience && meta.audience !== audience && meta.audience !== "universal") {
          continue;
        }
      }
    } else if (node.type === "plan") {
      const meta = planMap.get(rawId);
      if (meta) {
        title = meta.title;
        summary = meta.summary || undefined;
      }
    } else if (node.type === "task") {
      const meta = taskMap.get(rawId);
      if (meta) {
        title = meta.title;
      }
    }

    const relation = deriveRelation(s, index);

    results.push({
      id: rawId,
      type: node.type,
      title,
      summary,
      score: s.score,
      relation,
    });

    if (results.length >= limit) break;
  }

  return results;
}
