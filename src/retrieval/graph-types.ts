/**
 * Core types for ARCS's graph-based retrieval layer.
 */

export type NodeType = "task" | "plan" | "knowledge" | "file";

export type EdgeRelation =
  | "task_belongs_to_plan"
  | "shares_source_file"
  | "knowledge_touches_file"
  | "plan_contains_task"
  | "shares_keywords"
  | "project_depends_on";

export interface GraphNode {
  id: string;
  type: NodeType;
  title?: string;
  keywords?: string[];
}

export interface GraphEdge {
  source: string;
  target: string;
  relation: EdgeRelation;
  weight: number;
}

export interface AdjacencyIndex {
  nodes: Map<string, GraphNode>;
  edges: Map<string, GraphEdge[]>;
  fileIndex: Map<string, string[]>;
  buildTime: string;
  sourceHashes: Record<string, number>;
}

export interface TraversalOptions {
  maxDepth?: number;
  minScore?: number;
  limit?: number;
  excludeTypes?: NodeType[];
}

export interface ScoredNode {
  node: GraphNode;
  score: number;
  path: string[];
}

export const EDGE_WEIGHTS: Record<EdgeRelation, number> = {
  task_belongs_to_plan: 1.0,
  shares_source_file: 0.9,
  knowledge_touches_file: 0.85,
  plan_contains_task: 0.8,
  shares_keywords: 0.5,
  project_depends_on: 0.3,
};
