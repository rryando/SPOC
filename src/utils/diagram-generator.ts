import type { TaskMeta } from "./project-memory.js";

export interface DiagramNode {
  nodeId: string;
  taskId: string;
  title: string;
}

export interface GenerateDiagramResult {
  mmd: string;
  nodes: DiagramNode[];
}

/**
 * Generates a skeleton Mermaid .mmd diagram from plan tasks.
 * Node IDs assigned T001+ sorted by priority (high→medium→low) then id.localeCompare.
 * No dependency edges — skeleton only. Use manage-diagram.mjs regenerate to add edges.
 */
export function generateDiagramFromTasks(planId: string, tasks: TaskMeta[]): GenerateDiagramResult {
  const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
  const sorted = [...tasks].sort(
    (a, b) =>
      (priorityOrder[a.priority] ?? 1) - (priorityOrder[b.priority] ?? 1) ||
      a.id.localeCompare(b.id),
  );

  const nodes: DiagramNode[] = sorted.map((t, i) => ({
    nodeId: `T${String(i + 1).padStart(3, "0")}`,
    taskId: t.id,
    title: t.title,
  }));

  const statusLine = nodes.map((n, i) => `${n.nodeId}=${sorted[i].status}`).join(", ");

  const lines: string[] = [
    `%% plan: ${planId}`,
    `%% status: ${statusLine}`,
    `%% ready: (run: arcs diagram ready ${planId})`,
    `%% next-action: Start first backlog task`,
    "",
  ];

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const t = sorted[i];
    lines.push(
      `%% node: ${node.nodeId}`,
      `%% title: ${t.title}`,
      `%% status: ${t.status}`,
      `%% skill: quick-dev`,
      `%% scope: (TBD)`,
      `%% acceptance: (TBD)`,
      `%% verify: npm test`,
      "",
    );
  }

  lines.push(
    "flowchart TD",
    "    classDef done fill:#22c55e,color:#fff",
    "    classDef inProgress fill:#f59e0b,color:#fff",
    "    classDef blocked fill:#ef4444,color:#fff",
    "    classDef backlog fill:#94a3b8,color:#fff",
    "",
  );

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const t = sorted[i];
    const cls =
      t.status === "in_progress" ? "inProgress" : t.status === "cancelled" ? "backlog" : t.status;
    lines.push(`    ${node.nodeId}["${t.title.replace(/"/g, "'")}"]:::${cls}`);
  }
  lines.push("");

  return { mmd: `${lines.join("\n")}\n`, nodes };
}
