import { execSync, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
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
    crossModuleCouplings: number;
    totalProposals: number;
  };
}

// Graphify output format (from `graphify update` or `graphify extract`)
interface RawGraphNode {
  id: string;
  label: string;
  file_type?: string;
  source_file?: string;
  source_location?: string;
  // Clustered graphs may include these:
  type?: string;
  file?: string;
  community?: number;
  degree?: number;
  metadata?: Record<string, unknown>;
}

interface RawGraphLink {
  source: string;
  target: string;
  relation?: string;
  type?: string;
  confidence?: string;
  source_file?: string;
  weight?: number;
}

interface GraphCommunity {
  id: number;
  label: string;
  nodes: string[];
  summary?: string;
}

interface RawGraphJson {
  nodes: RawGraphNode[];
  links?: RawGraphLink[];
  edges?: RawGraphLink[];
  communities?: GraphCommunity[];
}

// Normalized internal node with computed fields
interface GraphNode {
  id: string;
  label: string;
  type: string;
  file: string;
  community: number;
  degree: number;
}

function parseGraphJson(graphPath: string): { nodes: GraphNode[]; communities: GraphCommunity[] } | null {
  try {
    const raw = readFileSync(graphPath, "utf-8");
    const data: RawGraphJson = JSON.parse(raw);
    if (!Array.isArray(data?.nodes) || data.nodes.length === 0) return null;

    // Normalize links (graphify uses "links" key; older format used "edges")
    const links = data.links || data.edges || [];

    // Compute degree from links
    const degreeMap = new Map<string, number>();
    for (const link of links) {
      degreeMap.set(link.source, (degreeMap.get(link.source) || 0) + 1);
      degreeMap.set(link.target, (degreeMap.get(link.target) || 0) + 1);
    }

    // Normalize nodes
    const nodes: GraphNode[] = data.nodes.map(n => ({
      id: n.id,
      label: n.label,
      type: n.type || n.file_type || "unknown",
      file: n.file || n.source_file || "",
      community: n.community ?? -1,
      degree: n.degree ?? degreeMap.get(n.id) ?? 0,
    }));

    // Use communities if available; otherwise synthesize from source_file grouping
    let communities: GraphCommunity[] = data.communities || [];
    if (communities.length === 0) {
      // Group nodes by directory prefix as pseudo-communities
      const dirGroups = new Map<string, string[]>();
      for (const node of nodes) {
        if (!node.file) continue;
        const dir = node.file.split("/").slice(0, -1).join("/") || ".";
        const list = dirGroups.get(dir) || [];
        list.push(node.id);
        dirGroups.set(dir, list);
      }
      let communityId = 0;
      for (const [dir, nodeIds] of dirGroups) {
        if (nodeIds.length >= 3) {
          communities.push({
            id: communityId++,
            label: dir,
            nodes: nodeIds,
          });
        }
      }
    }

    return { nodes, communities };
  } catch {
    return null;
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
  _slug: string,
): IngestionResult {
  const empty: IngestionResult = {
    proposals: [],
    stats: { godNodes: 0, communities: 0, crossModuleCouplings: 0, totalProposals: 0 },
  };

  const graph = parseGraphJson(graphJsonPath);
  if (!graph || graph.nodes.length === 0) return empty;

  const proposals: KnowledgeProposal[] = [];
  const nodeMap = new Map(graph.nodes.map(n => [n.id, n]));

  // God nodes (degree > 95th percentile — top 5% most connected)
  // Exclude test files — they naturally import many modules but aren't architectural hubs
  const isTestFile = (file: string) =>
    /\.(test|spec)\.[jt]sx?$/.test(file) ||
    file.startsWith("test/") ||
    file.startsWith("tests/") ||
    file.includes("/__tests__/");

  const degrees = graph.nodes.map(n => n.degree).filter(d => d > 0);
  const threshold = percentile(degrees, 95);
  const godNodes = graph.nodes
    .filter(n => n.degree > threshold && n.file && !isTestFile(n.file))
    .sort((a, b) => b.degree - a.degree)
    .slice(0, 8); // cap god nodes at 8 to leave room for other kinds

  for (const node of godNodes) {
    proposals.push({
      title: `High-connectivity module: ${node.label}`,
      kind: "module",
      summary: `${node.label} has degree ${node.degree}, making it a central hub in the codebase graph.`,
      keywords: [node.label.toLowerCase(), node.type, "high-connectivity"],
      sourceFiles: [{ path: node.file }],
    });
  }

  // Community clusters (sorted by size desc, top 8)
  const communities = [...(graph.communities || [])].sort(
    (a, b) => b.nodes.length - a.nodes.length,
  ).slice(0, 8);

  for (const community of communities) {
    const memberFiles = community.nodes
      .map(id => nodeMap.get(id)?.file)
      .filter((f): f is string => !!f);
    const uniqueFiles = [...new Set(memberFiles)];
    proposals.push({
      title: `Architecture cluster: ${community.label}`,
      kind: "architecture",
      summary: community.summary || `Cluster containing ${community.nodes.length} related entities in ${community.label}.`,
      keywords: [community.label.toLowerCase(), "cluster", "architecture"],
      sourceFiles: uniqueFiles.map(p => ({ path: p })),
    });
  }

  // Cross-module coupling: find links between different top-level directories where at least one node is high-degree
  const crossModule: Array<{ a: GraphNode; b: GraphNode; combinedDegree: number }> = [];
  const rawContent = readFileSync(graphJsonPath, "utf-8");
  const rawData = JSON.parse(rawContent) as RawGraphJson;
  const allLinks = rawData.links || rawData.edges || [];
  for (const link of allLinks) {
    const nodeA = nodeMap.get(link.source);
    const nodeB = nodeMap.get(link.target);
    if (!nodeA || !nodeB || !nodeA.file || !nodeB.file) continue;
    // Skip test files — test↔source coupling is expected, not interesting
    if (isTestFile(nodeA.file) || isTestFile(nodeB.file)) continue;
    const dirA = nodeA.file.split("/").slice(0, 2).join("/"); // top-level module dir
    const dirB = nodeB.file.split("/").slice(0, 2).join("/");
    if (dirA && dirB && dirA !== dirB && (nodeA.degree > threshold || nodeB.degree > threshold)) {
      crossModule.push({ a: nodeA, b: nodeB, combinedDegree: nodeA.degree + nodeB.degree });
    }
  }
  // Sort by combined degree, deduplicate, take top 5
  crossModule.sort((a, b) => b.combinedDegree - a.combinedDegree);
  const seen = new Set<string>();
  for (const { a, b } of crossModule) {
    const key = [a.id, b.id].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    proposals.push({
      title: `Cross-module coupling: ${a.label} ↔ ${b.label}`,
      kind: "gotcha",
      summary: `High-connectivity entities ${a.label} (${a.file}) and ${b.label} (${b.file}) are linked across module boundaries.`,
      keywords: [a.label.toLowerCase(), b.label.toLowerCase(), "coupling", "cross-module"],
      sourceFiles: [{ path: a.file }, { path: b.file }],
    });
    if (proposals.filter(p => p.kind === "gotcha").length >= 5) break;
  }

  // Cap at 20
  const capped = proposals.slice(0, 20);

  return {
    proposals: capped,
    stats: {
      godNodes: godNodes.length,
      communities: communities.length,
      crossModuleCouplings: capped.filter(p => p.kind === "gotcha").length,
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
  // Use `update --force --no-cluster` for AST-only extraction (no LLM API key needed)
  const result = spawnSync("graphify", ["update", absolutePath, "--force", "--no-cluster"], {
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

  if (!existsSync(graphJsonPath)) {
    return {
      success: false,
      error: "Extraction completed but graph.json not found",
      code: "ENOENT",
    };
  }

  // Ensure graphify-out/ is in .gitignore so extraction output doesn't pollute the repo
  ensureGitignoreEntry(absolutePath, "graphify-out/");

  return {
    success: true,
    graphJsonPath,
  };
}

/**
 * Append an entry to .gitignore if it's not already present.
 * Creates the file if it doesn't exist.
 */
function ensureGitignoreEntry(workspacePath: string, entry: string): void {
  const gitignorePath = join(workspacePath, ".gitignore");
  try {
    if (existsSync(gitignorePath)) {
      const content = readFileSync(gitignorePath, "utf-8");
      // Check if entry already present (exact line match)
      const lines = content.split("\n").map((l) => l.trim());
      if (lines.includes(entry)) return;
      // Append with newline separator if file doesn't end with one
      const separator = content.endsWith("\n") ? "" : "\n";
      appendFileSync(gitignorePath, `${separator}${entry}\n`, "utf-8");
    } else {
      // Create .gitignore with the entry
      appendFileSync(gitignorePath, `${entry}\n`, "utf-8");
    }
  } catch {
    // Non-fatal — don't fail extraction over .gitignore issues
  }
}
