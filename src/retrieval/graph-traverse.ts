import type { AdjacencyIndex, ScoredNode, TraversalOptions } from "./graph-types.js";

export function traverseFrom(
  index: AdjacencyIndex,
  startNodeId: string,
  options?: TraversalOptions,
): ScoredNode[] {
  const maxDepth = options?.maxDepth ?? 3;
  const minScore = options?.minScore ?? 0.2;
  const limit = options?.limit ?? 10;
  const excludeTypes = options?.excludeTypes ?? [];

  const startNode = index.nodes.get(startNodeId);
  if (!startNode) return [];

  const edges = index.edges.get(startNodeId);
  if (!edges || edges.length === 0) return [];

  // Track best score and path for each node
  const bestScores = new Map<string, { score: number; path: string[] }>();

  // BFS queue: [nodeId, currentScore, depth, path]
  const queue: Array<[string, number, number, string[]]> = [];
  queue.push([startNodeId, 1.0, 0, [startNodeId]]);

  while (queue.length > 0) {
    const [nodeId, score, depth, path] = queue.shift()!;

    if (depth >= maxDepth) continue;

    const nodeEdges = index.edges.get(nodeId);
    if (!nodeEdges) continue;

    for (const edge of nodeEdges) {
      const childId = edge.target;
      const childScore = score * edge.weight;

      if (childScore < minScore) continue;

      const childNode = index.nodes.get(childId);
      if (!childNode) continue;

      const childPath = [...path, childId];

      const existing = bestScores.get(childId);
      if (existing && existing.score >= childScore) continue;

      bestScores.set(childId, { score: childScore, path: childPath });
      queue.push([childId, childScore, depth + 1, childPath]);
    }
  }

  // Build results, excluding start node and excludeTypes
  const results: ScoredNode[] = [];
  for (const [nodeId, { score, path }] of bestScores) {
    if (nodeId === startNodeId) continue;
    const node = index.nodes.get(nodeId)!;
    if (excludeTypes.includes(node.type)) continue;
    results.push({ node, score, path });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}
