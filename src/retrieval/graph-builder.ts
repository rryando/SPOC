/**
 * Builds an adjacency index (graph) from project metadata indexes.
 */

import { stat } from "node:fs/promises";
import { join } from "node:path";
import { getProjectDir } from "../utils/paths.js";
import { readKnowledgeIndex, readPlanIndex, listTasks } from "../utils/project-memory.js";
import type { AdjacencyIndex, GraphEdge, GraphNode } from "./graph-types.js";
import { EDGE_WEIGHTS } from "./graph-types.js";

const MAX_FILE_REFS_FOR_PAIRS = 10;

function addNode(nodes: Map<string, GraphNode>, node: GraphNode): void {
  if (!nodes.has(node.id)) {
    nodes.set(node.id, node);
  }
}

function addEdge(edges: Map<string, GraphEdge[]>, edge: GraphEdge): void {
  const list = edges.get(edge.source);
  if (list) {
    list.push(edge);
  } else {
    edges.set(edge.source, [edge]);
  }
}

async function getMtime(filePath: string): Promise<number> {
  try {
    const s = await stat(filePath);
    return s.mtimeMs;
  } catch {
    return 0;
  }
}

export async function buildAdjacencyIndex(slug: string): Promise<AdjacencyIndex> {
  const projectDir = getProjectDir(slug);
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge[]>();
  const fileIndex = new Map<string, string[]>();

  // Helper to register a file reference from a node
  function registerFileRef(nodeId: string, filePath: string): void {
    addNode(nodes, { id: `file:${filePath}`, type: "file", title: filePath });
    const refs = fileIndex.get(filePath);
    if (refs) {
      refs.push(nodeId);
    } else {
      fileIndex.set(filePath, [nodeId]);
    }
  }

  // 1. Knowledge
  let knowledgeEntries: Array<{ id: string; title: string; keywords: string[]; sourceFiles?: Array<{ path: string }> }> = [];
  try {
    const idx = await readKnowledgeIndex(projectDir);
    knowledgeEntries = idx.entries;
  } catch {
    // graceful
  }

  for (const entry of knowledgeEntries) {
    const nodeId = `knowledge:${entry.id}`;
    addNode(nodes, { id: nodeId, type: "knowledge", title: entry.title, keywords: entry.keywords });
    if (entry.sourceFiles) {
      for (const sf of entry.sourceFiles) {
        registerFileRef(nodeId, sf.path);
        addEdge(edges, { source: nodeId, target: `file:${sf.path}`, relation: "knowledge_touches_file", weight: EDGE_WEIGHTS.knowledge_touches_file });
      }
    }
  }

  // 2. Plans
  let planEntries: Array<{ id: string; title: string; keywords: string[]; sourceFiles?: Array<{ path: string }> }> = [];
  try {
    const idx = await readPlanIndex(projectDir);
    planEntries = idx.plans;
  } catch {
    // graceful
  }

  for (const plan of planEntries) {
    const nodeId = `plan:${plan.id}`;
    addNode(nodes, { id: nodeId, type: "plan", title: plan.title, keywords: plan.keywords });
    if (plan.sourceFiles) {
      for (const sf of plan.sourceFiles) {
        registerFileRef(nodeId, sf.path);
        addEdge(edges, { source: nodeId, target: `file:${sf.path}`, relation: "knowledge_touches_file", weight: EDGE_WEIGHTS.knowledge_touches_file });
      }
    }
  }

  // 3. Tasks
  let taskEntries: Array<{ id: string; title: string; planId?: string; sourceFiles?: Array<{ path: string }> }> = [];
  try {
    taskEntries = await listTasks(projectDir);
  } catch {
    // graceful
  }

  for (const task of taskEntries) {
    const nodeId = `task:${task.id}`;
    addNode(nodes, { id: nodeId, type: "task", title: task.title });
    if (task.planId) {
      const planNodeId = `plan:${task.planId}`;
      addNode(nodes, { id: planNodeId, type: "plan" });
      addEdge(edges, { source: nodeId, target: planNodeId, relation: "task_belongs_to_plan", weight: EDGE_WEIGHTS.task_belongs_to_plan });
      addEdge(edges, { source: planNodeId, target: nodeId, relation: "plan_contains_task", weight: EDGE_WEIGHTS.plan_contains_task });
    }
    if (task.sourceFiles) {
      for (const sf of task.sourceFiles) {
        registerFileRef(nodeId, sf.path);
        addEdge(edges, { source: nodeId, target: `file:${sf.path}`, relation: "knowledge_touches_file", weight: EDGE_WEIGHTS.knowledge_touches_file });
      }
    }
  }

  // 5. shares_source_file edges
  fileIndex.forEach((refNodes) => {
    if (refNodes.length < 2) return;
    const capped = refNodes.slice(0, MAX_FILE_REFS_FOR_PAIRS);
    for (let i = 0; i < capped.length; i++) {
      for (let j = i + 1; j < capped.length; j++) {
        addEdge(edges, { source: capped[i], target: capped[j], relation: "shares_source_file", weight: EDGE_WEIGHTS.shares_source_file });
        addEdge(edges, { source: capped[j], target: capped[i], relation: "shares_source_file", weight: EDGE_WEIGHTS.shares_source_file });
      }
    }
  });

  // 6. shares_keywords edges for knowledge entries
  for (let i = 0; i < knowledgeEntries.length; i++) {
    for (let j = i + 1; j < knowledgeEntries.length; j++) {
      const a = knowledgeEntries[i];
      const b = knowledgeEntries[j];
      const shared = a.keywords.filter((kw) => b.keywords.includes(kw));
      if (shared.length >= 2) {
        const aId = `knowledge:${a.id}`;
        const bId = `knowledge:${b.id}`;
        addEdge(edges, { source: aId, target: bId, relation: "shares_keywords", weight: EDGE_WEIGHTS.shares_keywords });
        addEdge(edges, { source: bId, target: aId, relation: "shares_keywords", weight: EDGE_WEIGHTS.shares_keywords });
      }
    }
  }

  // 7. sourceHashes
  const sourceHashes: Record<string, number> = {
    knowledge: await getMtime(join(projectDir, "knowledge", "index.json")),
    plans: await getMtime(join(projectDir, "plans", "index.json")),
    tasks: await getMtime(join(projectDir, "tasks", "index.json")),
  };

  return {
    nodes,
    edges,
    fileIndex,
    buildTime: new Date().toISOString(),
    sourceHashes,
  };
}
