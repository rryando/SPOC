import { describe, expect, it } from "vitest";
import {
  EDGE_WEIGHTS,
  type EdgeRelation,
  type GraphEdge,
  type GraphNode,
  type NodeType,
  type ScoredNode,
  type TraversalOptions,
} from "../src/retrieval/graph-types.js";

describe("graph-types", () => {
  it("EDGE_WEIGHTS has exactly 6 entries", () => {
    expect(Object.keys(EDGE_WEIGHTS)).toHaveLength(6);
  });

  it("all EDGE_WEIGHTS values are between 0 (exclusive) and 1 (inclusive)", () => {
    for (const [key, value] of Object.entries(EDGE_WEIGHTS)) {
      expect(value, `${key} should be > 0`).toBeGreaterThan(0);
      expect(value, `${key} should be <= 1`).toBeLessThanOrEqual(1);
    }
  });

  it("type exports compile correctly", () => {
    const node: GraphNode = { id: "t1", type: "task" };
    const edge: GraphEdge = {
      source: "t1",
      target: "p1",
      relation: "task_belongs_to_plan",
      weight: 1.0,
    };
    const opts: TraversalOptions = { maxDepth: 3 };
    const scored: ScoredNode = { node, score: 0.9, path: ["t1"] };
    const nodeType: NodeType = "file";
    const rel: EdgeRelation = "shares_keywords";

    expect(node.type).toBe("task");
    expect(edge.relation).toBe("task_belongs_to_plan");
    expect(opts.maxDepth).toBe(3);
    expect(scored.score).toBe(0.9);
    expect(nodeType).toBe("file");
    expect(rel).toBe("shares_keywords");
  });
});
