// ---------------------------------------------------------------------------
// Terminal-native diagram tree renderer
// ---------------------------------------------------------------------------

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import pc from "picocolors";

export interface InspectNode {
  id: string;
  label: string;
  status: string;
}

export interface InspectEdge {
  from: string;
  to: string;
}

export interface InspectOutput {
  planId: string;
  nodes: InspectNode[];
  edges: InspectEdge[];
  metadata?: Record<string, { skill?: string; scope?: string; acceptance?: string; verify?: string; blockedBy?: string }>;
  statusComment?: string;
  ready?: string[];
}

const STATUS_ICON: Record<string, string> = {
  done: "✓",
  inProgress: "◉",
  blocked: "✗",
  backlog: "○",
};

function colorStatus(text: string, status: string): string {
  switch (status) {
    case "done": return pc.green(text);
    case "inProgress": return pc.yellow(text);
    case "blocked": return pc.red(text);
    default: return pc.dim(text);
  }
}

function buildProgressBar(nodes: InspectNode[]): string {
  const total = nodes.length;
  const done = nodes.filter((n) => n.status === "done").length;
  const barWidth = 7;
  const filled = total > 0 ? Math.round((done / total) * barWidth) : 0;
  const bar = "█".repeat(filled) + "░".repeat(barWidth - filled);
  return `${bar} ${done}/${total}`;
}

export function renderDiagramTree(inspectJson: InspectOutput): string {
  const { planId, nodes, edges, ready } = inspectJson;
  const readySet = new Set(ready ?? []);

  // Build adjacency: parent -> children
  const children = new Map<string, string[]>();
  const incomingCount = new Map<string, number>();

  for (const node of nodes) {
    children.set(node.id, []);
    incomingCount.set(node.id, 0);
  }
  for (const edge of edges) {
    children.get(edge.from)?.push(edge.to);
    incomingCount.set(edge.to, (incomingCount.get(edge.to) ?? 0) + 1);
  }

  // Root nodes: no incoming edges
  const roots = nodes.filter((n) => (incomingCount.get(n.id) ?? 0) === 0);

  // Build set of done node IDs for blocked detection
  const doneSet = new Set(nodes.filter((n) => n.status === "done").map((n) => n.id));

  // Check if a node's dependencies are all done
  function hasUnmetDeps(nodeId: string): boolean {
    // Find all parents (nodes that have an edge TO this node)
    const parents = edges.filter((e) => e.to === nodeId).map((e) => e.from);
    return parents.some((p) => !doneSet.has(p));
  }

  // Header
  const status = inspectJson.statusComment ?? "planned";
  const progress = buildProgressBar(nodes);
  const titleLine = `─ PLAN: ${planId} `;
  const headerWidth = 58;
  const padRight = Math.max(0, headerWidth - titleLine.length - 1);

  const lines: string[] = [];
  lines.push(`┌${titleLine}${"─".repeat(padRight)}┐`);
  lines.push(`│ Status: ${status} │ Progress: ${progress}${" ".repeat(Math.max(0, headerWidth - 14 - status.length - 14 - progress.length))}│`);
  lines.push(`└${"─".repeat(headerWidth)}┘`);
  lines.push("");

  // Render tree recursively
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  function renderNode(nodeId: string, prefix: string, connector: string): void {
    const node = nodeMap.get(nodeId);
    if (!node) return;

    const icon = colorStatus(STATUS_ICON[node.status] ?? "○", node.status);
    const label = colorStatus(`${node.id} │ ${node.label}`, node.status);
    const statusTag = colorStatus(`[${node.status}]`, node.status);

    let markers = "";
    if (readySet.has(node.id)) {
      markers += ` ${pc.cyan("★ READY")}`;
    } else if (node.status !== "done" && node.status !== "inProgress" && hasUnmetDeps(node.id)) {
      markers += ` ${pc.dim("⏳")}`;
    }

    lines.push(`${prefix}${connector}${icon} ${label} ${statusTag}${markers}`);

    const kids = children.get(nodeId) ?? [];
    for (let i = 0; i < kids.length; i++) {
      const isLast = i === kids.length - 1;
      const childConnector = isLast ? "└─→ " : "├─→ ";
      const childPrefix = prefix + (connector ? "    " : "  ");
      renderNode(kids[i], childPrefix, childConnector);
    }
  }

  for (const root of roots) {
    renderNode(root.id, "  ", "");
  }

  return lines.join("\n");
}

export function renderDiagramShow(diagramPath: string): string {
  const localPath = resolve(import.meta.dirname, "../../opencode/superpowers/skills/to-diagram/scripts/manage-diagram.mjs");
  const configPath = resolve(homedir(), ".config/opencode/skills/superpowers/to-diagram/scripts/manage-diagram.mjs");
  const scriptPath = existsSync(localPath) ? localPath : existsSync(configPath) ? configPath : undefined;

  if (!scriptPath) {
    throw new Error("manage-diagram.mjs not found");
  }

  const output = execSync(`node "${scriptPath}" inspect "${diagramPath}"`, {
    encoding: "utf-8",
    timeout: 10000,
  });

  const inspectJson: InspectOutput = JSON.parse(output);
  return renderDiagramTree(inspectJson);
}
