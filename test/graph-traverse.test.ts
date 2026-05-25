import { describe, it, expect } from "vitest";
import { traverseFrom } from "../src/retrieval/graph-traverse.js";
import type {
  AdjacencyIndex,
  GraphNode,
  GraphEdge,
} from "../src/retrieval/graph-types.js";

function buildTestGraph(): AdjacencyIndex {
  const nodes = new Map<string, GraphNode>([
    ["task-1", { id: "task-1", type: "task", title: "Start task" }],
    ["plan-1", { id: "plan-1", type: "plan", title: "Main plan" }],
    ["knowledge-1", { id: "knowledge-1", type: "knowledge", title: "KB entry" }],
    ["file-1", { id: "file-1", type: "file", title: "src/foo.ts" }],
    ["task-2", { id: "task-2", type: "task", title: "Second task" }],
    ["task-3", { id: "task-3", type: "task", title: "Third task" }],
    ["knowledge-2", { id: "knowledge-2", type: "knowledge", title: "Deep KB" }],
    ["task-4", { id: "task-4", type: "task", title: "Far task" }],
  ]);

  // Edges: task-1 -> plan-1 (0.9), task-1 -> file-1 (0.8)
  // plan-1 -> knowledge-1 (0.85), plan-1 -> task-2 (0.7)
  // file-1 -> task-2 (0.9), file-1 -> knowledge-2 (0.3)
  // task-2 -> task-3 (0.6)
  // task-3 -> task-4 (0.5)
  // knowledge-1 -> task-2 (0.95) — alternate high-score path to task-2
  const edges = new Map<string, GraphEdge[]>();
  edges.set("task-1", [
    { source: "task-1", target: "plan-1", relation: "task_belongs_to_plan", weight: 0.9 },
    { source: "task-1", target: "file-1", relation: "shares_source_file", weight: 0.8 },
  ]);
  edges.set("plan-1", [
    { source: "plan-1", target: "knowledge-1", relation: "shares_keywords", weight: 0.85 },
    { source: "plan-1", target: "task-2", relation: "plan_contains_task", weight: 0.7 },
  ]);
  edges.set("file-1", [
    { source: "file-1", target: "task-2", relation: "shares_source_file", weight: 0.9 },
    { source: "file-1", target: "knowledge-2", relation: "knowledge_touches_file", weight: 0.3 },
  ]);
  edges.set("knowledge-1", [
    { source: "knowledge-1", target: "task-2", relation: "shares_keywords", weight: 0.95 },
  ]);
  edges.set("task-2", [
    { source: "task-2", target: "task-3", relation: "shares_keywords", weight: 0.6 },
  ]);
  edges.set("task-3", [
    { source: "task-3", target: "task-4", relation: "shares_keywords", weight: 0.5 },
  ]);

  return {
    nodes,
    edges,
    fileIndex: new Map(),
    buildTime: "2026-01-01T00:00:00Z",
    sourceHashes: {},
  };
}

describe("traverseFrom", () => {
  const graph = buildTestGraph();

  it("returns empty array for non-existent start node", () => {
    expect(traverseFrom(graph, "nonexistent")).toEqual([]);
  });

  it("returns empty array for node with no edges", () => {
    expect(traverseFrom(graph, "task-4")).toEqual([]);
  });

  it("1-hop traversal: returns neighbor with score = edge weight", () => {
    const results = traverseFrom(graph, "task-1", { maxDepth: 1 });
    const plan1 = results.find((r) => r.node.id === "plan-1");
    expect(plan1).toBeDefined();
    expect(plan1!.score).toBe(0.9);
    expect(plan1!.path).toEqual(["task-1", "plan-1"]);
  });

  it("2-hop traversal: score = product of edge weights", () => {
    const results = traverseFrom(graph, "task-1", { maxDepth: 2 });
    const k1 = results.find((r) => r.node.id === "knowledge-1");
    expect(k1).toBeDefined();
    // task-1 -> plan-1 (0.9) -> knowledge-1 (0.85) = 0.765
    expect(k1!.score).toBeCloseTo(0.765, 5);
  });

  it("prunes below minScore threshold", () => {
    // knowledge-2 reachable via task-1 -> file-1 (0.8) -> knowledge-2 (0.3) = 0.24
    const results = traverseFrom(graph, "task-1", { minScore: 0.3 });
    const k2 = results.find((r) => r.node.id === "knowledge-2");
    expect(k2).toBeUndefined();
  });

  it("respects maxDepth", () => {
    // task-4 is at depth 4 from task-1
    const results = traverseFrom(graph, "task-1", { maxDepth: 3 });
    const t4 = results.find((r) => r.node.id === "task-4");
    expect(t4).toBeUndefined();
  });

  it("deduplication: node reachable via two paths keeps higher score", () => {
    // task-2 reachable via:
    //   task-1 -> plan-1 (0.9) -> task-2 (0.7) = 0.63
    //   task-1 -> file-1 (0.8) -> task-2 (0.9) = 0.72
    //   task-1 -> plan-1 (0.9) -> knowledge-1 (0.85) -> task-2 (0.95) = 0.72675
    const results = traverseFrom(graph, "task-1");
    const t2 = results.find((r) => r.node.id === "task-2");
    expect(t2).toBeDefined();
    expect(t2!.score).toBeCloseTo(0.72675, 5);
  });

  it("excludeTypes: file nodes excluded from results but still traversed through", () => {
    const results = traverseFrom(graph, "task-1", { excludeTypes: ["file"] });
    // file-1 should not be in results
    expect(results.find((r) => r.node.id === "file-1")).toBeUndefined();
    // But task-2 (reachable through file-1) should still be present
    expect(results.find((r) => r.node.id === "task-2")).toBeDefined();
  });

  it("results sorted by score descending", () => {
    const results = traverseFrom(graph, "task-1");
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it("limit: only top N returned", () => {
    const results = traverseFrom(graph, "task-1", { limit: 2 });
    expect(results.length).toBeLessThanOrEqual(2);
  });
});
