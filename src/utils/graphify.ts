import { execSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export interface GraphifyInfo {
  available: boolean;
  version?: string;
  path?: string;
}

export function detectGraphify(): GraphifyInfo {
  try {
    const version = execSync("graphify --version", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5000,
    }).trim();

    const resolvedPath = execSync("which graphify", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5000,
    }).trim();

    // Extract semver from output (e.g. "graphify 0.8.18" or just "0.8.18")
    const match = version.match(/(\d+\.\d+\.\d+)/);

    return {
      available: true,
      version: match ? match[1] : version,
      path: resolvedPath || undefined,
    };
  } catch {
    return { available: false };
  }
}

export interface ExtractionResult {
  success: true;
  graphJsonPath: string;
  reportMdPath: string;
}

export interface ExtractionError {
  success: false;
  error: string;
  code?: string;
}

export type ExtractionOutcome = ExtractionResult | ExtractionError;

// --- Knowledge Ingestion ---

export interface KnowledgeProposal {
  title: string;
  kind: "architecture" | "module" | "gotcha" | "pattern";
  summary: string;
  keywords: string[];
  sourceFiles: Array<{ path: string; anchor?: string }>;
}

export interface IngestionResult {
  proposals: KnowledgeProposal[];
  stats: {
    godNodes: number;
    communities: number;
    surprisingConnections: number;
    totalProposals: number;
  };
}

interface GraphNode {
  id: string;
  label: string;
  type: string;
  file: string;
  community: number;
  degree: number;
  metadata?: Record<string, unknown>;
}

interface GraphCommunity {
  id: number;
  label: string;
  nodes: string[];
  summary?: string;
}

interface GraphJson {
  nodes: GraphNode[];
  edges: Array<{ source: string; target: string; type: string; weight: number }>;
  communities: GraphCommunity[];
}

function parseGraphJson(path: string): GraphJson | null {
  try {
    const raw = readFileSync(path, "utf-8");
    const data = JSON.parse(raw);
    if (!Array.isArray(data?.nodes)) return null;
    return data as GraphJson;
  } catch {
    return null;
  }
}

function parseSurprisingConnections(reportPath: string): Array<{ a: string; b: string; reason: string }> {
  if (!existsSync(reportPath)) return [];
  try {
    const content = readFileSync(reportPath, "utf-8");
    const section = content.split("## Surprising Connections")[1];
    if (!section) return [];
    const lines = section.split("\n");
    const results: Array<{ a: string; b: string; reason: string }> = [];
    for (const line of lines) {
      if (line.startsWith("## ")) break; // next section
      const match = line.match(/\*\*(\w+)\*\*\s*↔\s*\*\*(\w+)\*\*.*?—\s*(.+)/);
      if (match) {
        results.push({ a: match[1], b: match[2], reason: match[3].trim() });
      }
    }
    return results;
  } catch {
    return [];
  }
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const frac = idx - lower;
  if (lower + 1 >= sorted.length) return sorted[lower];
  return sorted[lower] + frac * (sorted[lower + 1] - sorted[lower]);
}

export function ingestGraph(
  graphJsonPath: string,
  reportMdPath: string,
  _slug: string,
): IngestionResult {
  const empty: IngestionResult = {
    proposals: [],
    stats: { godNodes: 0, communities: 0, surprisingConnections: 0, totalProposals: 0 },
  };

  const graph = parseGraphJson(graphJsonPath);
  if (!graph || graph.nodes.length === 0) return empty;

  const proposals: KnowledgeProposal[] = [];
  const nodeMap = new Map(graph.nodes.map(n => [n.id, n]));

  // God nodes (degree > 75th percentile)
  const degrees = graph.nodes.map(n => n.degree);
  const threshold = percentile(degrees, 75);
  const godNodes = graph.nodes
    .filter(n => n.degree > threshold)
    .sort((a, b) => b.degree - a.degree);

  for (const node of godNodes) {
    proposals.push({
      title: `High-connectivity module: ${node.label}`,
      kind: "module",
      summary: `${node.label} has degree ${node.degree}, making it a central hub in the codebase graph.`,
      keywords: [node.label.toLowerCase(), node.type, "high-connectivity"],
      sourceFiles: [{ path: node.file }],
    });
  }

  // Community clusters (sorted by size desc)
  const communities = [...(graph.communities || [])].sort(
    (a, b) => b.nodes.length - a.nodes.length,
  );

  for (const community of communities) {
    const memberFiles = community.nodes
      .map(id => nodeMap.get(id)?.file)
      .filter((f): f is string => !!f);
    const uniqueFiles = [...new Set(memberFiles)];
    proposals.push({
      title: `Architecture cluster: ${community.label}`,
      kind: "architecture",
      summary: community.summary || `Cluster containing ${community.nodes.length} nodes.`,
      keywords: [community.label.toLowerCase(), "cluster", "architecture"],
      sourceFiles: uniqueFiles.map(p => ({ path: p })),
    });
  }

  // Surprising connections from report
  const surprising = parseSurprisingConnections(reportMdPath);
  for (const conn of surprising) {
    const nodeA = graph.nodes.find(n => n.label === conn.a);
    const nodeB = graph.nodes.find(n => n.label === conn.b);
    const files: Array<{ path: string }> = [];
    if (nodeA) files.push({ path: nodeA.file });
    if (nodeB) files.push({ path: nodeB.file });
    proposals.push({
      title: `Cross-module coupling: ${conn.a} ↔ ${conn.b}`,
      kind: "gotcha",
      summary: conn.reason,
      keywords: [conn.a.toLowerCase(), conn.b.toLowerCase(), "coupling", "gotcha"],
      sourceFiles: files,
    });
  }

  // Pattern detection: 3+ nodes with same type in same community
  for (const community of graph.communities || []) {
    const typeCounts = new Map<string, GraphNode[]>();
    for (const nodeId of community.nodes) {
      const node = nodeMap.get(nodeId);
      if (!node) continue;
      const list = typeCounts.get(node.type) || [];
      list.push(node);
      typeCounts.set(node.type, list);
    }
    for (const [type, nodes] of typeCounts) {
      if (nodes.length >= 3) {
        proposals.push({
          title: `Recurring pattern: ${nodes.length} ${type}s in ${community.label}`,
          kind: "pattern",
          summary: `${nodes.length} ${type} entities clustered in "${community.label}": ${nodes.map(n => n.label).join(", ")}.`,
          keywords: [type, "pattern", community.label.toLowerCase()],
          sourceFiles: nodes.map(n => ({ path: n.file })),
        });
      }
    }
  }

  // Cap at 20
  const capped = proposals.slice(0, 20);

  return {
    proposals: capped,
    stats: {
      godNodes: godNodes.length,
      communities: communities.length,
      surprisingConnections: surprising.length,
      totalProposals: capped.length,
    },
  };
}

// --- Graph Query ---

export interface QueryResult {
  success: true;
  answer: string;
}

export interface QueryError {
  success: false;
  error: string;
}

export type QueryOutcome = QueryResult | QueryError;

export function queryGraph(question: string, workspacePath: string): QueryOutcome {
  const info = detectGraphify();
  if (!info.available) {
    return { success: false, error: "graphify binary not found" };
  }

  const graphPath = join(resolve(workspacePath), "graphify-out", "graph.json");
  if (!existsSync(graphPath)) {
    return { success: false, error: "graph.json not found" };
  }

  const result = spawnSync("graphify", ["query", question, "--graph", graphPath], {
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 30_000,
  });

  if (result.error) {
    return { success: false, error: result.error.message };
  }

  if (result.status !== 0) {
    return { success: false, error: result.stderr?.trim() || "Query failed" };
  }

  return { success: true, answer: result.stdout.trim() };
}

export function pathBetween(entityA: string, entityB: string, workspacePath: string): QueryOutcome {
  const info = detectGraphify();
  if (!info.available) {
    return { success: false, error: "graphify binary not found" };
  }

  const graphPath = join(resolve(workspacePath), "graphify-out", "graph.json");
  if (!existsSync(graphPath)) {
    return { success: false, error: "graph.json not found" };
  }

  const result = spawnSync("graphify", ["path", entityA, entityB, "--graph", graphPath], {
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 30_000,
  });

  if (result.error) {
    return { success: false, error: result.error.message };
  }

  if (result.status !== 0) {
    return { success: false, error: result.stderr?.trim() || "Path query failed" };
  }

  return { success: true, answer: result.stdout.trim() };
}

export function runExtraction(workspacePath: string): ExtractionOutcome {
  const info = detectGraphify();
  if (!info.available) {
    return {
      success: false,
      error: "graphify binary not found",
      code: "ENOENT",
    };
  }

  const absolutePath = resolve(workspacePath);
  const result = spawnSync("graphify", ["extract", absolutePath, "--no-viz", "--force"], {
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 120_000,
    cwd: absolutePath,
  });

  if (result.error) {
    const errCode = (result.error as NodeJS.ErrnoException).code;
    return {
      success: false,
      error: result.error.message,
      code: errCode === "ETIMEDOUT" ? "ETIMEDOUT" : errCode,
    };
  }

  if (result.status !== 0) {
    const stderr = result.stderr?.trim() || "Process exited with non-zero status";
    return {
      success: false,
      error: stderr,
      code: `EXIT_${result.status}`,
    };
  }

  const graphJsonPath = join(absolutePath, "graphify-out", "graph.json");
  const reportMdPath = join(absolutePath, "graphify-out", "GRAPH_REPORT.md");

  if (!existsSync(graphJsonPath) || !existsSync(reportMdPath)) {
    return {
      success: false,
      error: "Extraction completed but expected output files not found",
      code: "ENOENT",
    };
  }

  return {
    success: true,
    graphJsonPath,
    reportMdPath,
  };
}
