import { describe, it, expect } from "vitest";
import { ingestGraph, type KnowledgeProposal, type IngestionResult } from "../src/utils/graphify.js";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function makeTmpDir(): string {
  const dir = join(tmpdir(), `spoc-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeGraph(dir: string, data: unknown): string {
  const path = join(dir, "graph.json");
  writeFileSync(path, JSON.stringify(data));
  return path;
}

function writeReport(dir: string, content: string): string {
  const path = join(dir, "GRAPH_REPORT.md");
  writeFileSync(path, content);
  return path;
}

const MINIMAL_GRAPH = {
  nodes: [
    { id: "n1", label: "AuthService", type: "class", file: "src/auth.ts", community: 0, degree: 42, metadata: {} },
    { id: "n2", label: "UserRepo", type: "class", file: "src/user.ts", community: 0, degree: 30, metadata: {} },
    { id: "n3", label: "Logger", type: "module", file: "src/logger.ts", community: 1, degree: 5, metadata: {} },
    { id: "n4", label: "Config", type: "module", file: "src/config.ts", community: 1, degree: 3, metadata: {} },
    { id: "n5", label: "GodNode", type: "class", file: "src/god.ts", community: 0, degree: 100, metadata: {} },
  ],
  edges: [
    { source: "n1", target: "n2", type: "calls", weight: 1.0 },
    { source: "n5", target: "n3", type: "references", weight: 0.5 },
  ],
  communities: [
    { id: 0, label: "Auth & Session Management", nodes: ["n1", "n2", "n5"], summary: "Handles auth" },
    { id: 1, label: "Infrastructure", nodes: ["n3", "n4"], summary: "Logging and config" },
  ],
};

const REPORT_MD = `# Knowledge Graph Report

## God Nodes (Most Connected)
- **GodNode** (degree: 100, file: src/god.ts) — Central orchestrator
- **AuthService** (degree: 42, file: src/auth.ts) — Auth entry point

## Surprising Connections
- **Logger** ↔ **AuthService** (confidence: INFERRED) — Unexpected tight coupling between logging and auth

## Community Clusters
### Cluster 0: Auth & Session Management
- Members: AuthService, UserRepo, GodNode
- Summary: Handles user authentication

### Cluster 1: Infrastructure
- Members: Logger, Config
- Summary: Logging and config

## Suggested Questions
- What connects Logger to AuthService?
`;

describe("ingestGraph", () => {
  it("returns empty proposals for empty graph.json", () => {
    const dir = makeTmpDir();
    const graphPath = writeGraph(dir, { nodes: [], edges: [], communities: [] });
    const reportPath = writeReport(dir, "# Empty");
    const result = ingestGraph(graphPath, reportPath, "test-slug");
    expect(result.proposals).toEqual([]);
    expect(result.stats.totalProposals).toBe(0);
    rmSync(dir, { recursive: true });
  });

  it("returns empty proposals for malformed graph.json", () => {
    const dir = makeTmpDir();
    const path = join(dir, "graph.json");
    writeFileSync(path, "not json at all {{{");
    const reportPath = writeReport(dir, "# Report");
    const result = ingestGraph(path, reportPath, "test-slug");
    expect(result.proposals).toEqual([]);
    expect(result.stats.totalProposals).toBe(0);
    rmSync(dir, { recursive: true });
  });

  it("identifies god nodes correctly (75th percentile degree threshold)", () => {
    const dir = makeTmpDir();
    const graphPath = writeGraph(dir, MINIMAL_GRAPH);
    const reportPath = writeReport(dir, REPORT_MD);
    const result = ingestGraph(graphPath, reportPath, "test-slug");

    const godProposals = result.proposals.filter(p => p.kind === "module");
    // degrees: [3, 5, 30, 42, 100] → 75th percentile = 42, so nodes with degree > 42 are god nodes
    // Only GodNode (100) exceeds 42
    expect(godProposals.length).toBeGreaterThanOrEqual(1);
    expect(godProposals[0].title).toContain("GodNode");
    expect(godProposals[0].sourceFiles[0].path).toBe("src/god.ts");
    expect(result.stats.godNodes).toBeGreaterThanOrEqual(1);
    rmSync(dir, { recursive: true });
  });

  it("creates architecture proposals from community clusters", () => {
    const dir = makeTmpDir();
    const graphPath = writeGraph(dir, MINIMAL_GRAPH);
    const reportPath = writeReport(dir, REPORT_MD);
    const result = ingestGraph(graphPath, reportPath, "test-slug");

    const archProposals = result.proposals.filter(p => p.kind === "architecture");
    expect(archProposals.length).toBe(2);
    expect(archProposals[0].title).toContain("Auth & Session Management");
    expect(result.stats.communities).toBe(2);
    rmSync(dir, { recursive: true });
  });

  it("creates gotcha proposals from surprising connections", () => {
    const dir = makeTmpDir();
    const graphPath = writeGraph(dir, MINIMAL_GRAPH);
    const reportPath = writeReport(dir, REPORT_MD);
    const result = ingestGraph(graphPath, reportPath, "test-slug");

    const gotchaProposals = result.proposals.filter(p => p.kind === "gotcha");
    expect(gotchaProposals.length).toBe(1);
    expect(gotchaProposals[0].title).toContain("Logger");
    expect(gotchaProposals[0].title).toContain("AuthService");
    expect(result.stats.surprisingConnections).toBe(1);
    rmSync(dir, { recursive: true });
  });

  it("caps proposals at 20", () => {
    const dir = makeTmpDir();
    // Create graph with many nodes to generate lots of proposals
    const nodes = Array.from({ length: 50 }, (_, i) => ({
      id: `n${i}`, label: `Node${i}`, type: "class", file: `src/n${i}.ts`,
      community: i % 10, degree: i * 3, metadata: {},
    }));
    const communities = Array.from({ length: 10 }, (_, i) => ({
      id: i, label: `Cluster ${i}`, nodes: nodes.filter(n => n.community === i).map(n => n.id),
      summary: `Summary ${i}`,
    }));
    const graph = { nodes, edges: [], communities };
    const graphPath = writeGraph(dir, graph);
    const reportPath = writeReport(dir, "# Report\n## Surprising Connections\n");
    const result = ingestGraph(graphPath, reportPath, "test-slug");
    expect(result.proposals.length).toBeLessThanOrEqual(20);
    rmSync(dir, { recursive: true });
  });

  it("handles missing GRAPH_REPORT.md gracefully", () => {
    const dir = makeTmpDir();
    const graphPath = writeGraph(dir, MINIMAL_GRAPH);
    const missingReport = join(dir, "nonexistent.md");
    const result = ingestGraph(graphPath, missingReport, "test-slug");
    // Should still produce proposals from graph.json (god nodes + communities)
    expect(result.proposals.length).toBeGreaterThan(0);
    // No surprising connections without report
    expect(result.stats.surprisingConnections).toBe(0);
    rmSync(dir, { recursive: true });
  });

  it("populates sourceFiles correctly with relative paths", () => {
    const dir = makeTmpDir();
    const graphPath = writeGraph(dir, MINIMAL_GRAPH);
    const reportPath = writeReport(dir, REPORT_MD);
    const result = ingestGraph(graphPath, reportPath, "test-slug");

    for (const proposal of result.proposals) {
      for (const sf of proposal.sourceFiles) {
        expect(sf.path).not.toMatch(/^\//); // no absolute paths
      }
    }
    rmSync(dir, { recursive: true });
  });

  it("stats object is accurate", () => {
    const dir = makeTmpDir();
    const graphPath = writeGraph(dir, MINIMAL_GRAPH);
    const reportPath = writeReport(dir, REPORT_MD);
    const result = ingestGraph(graphPath, reportPath, "test-slug");

    expect(result.stats.totalProposals).toBe(result.proposals.length);
    expect(result.stats.communities).toBe(2);
    expect(result.stats.surprisingConnections).toBe(1);
    expect(result.stats.godNodes).toBeGreaterThanOrEqual(1);
    rmSync(dir, { recursive: true });
  });
});
