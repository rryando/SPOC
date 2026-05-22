import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DagError, formatError, projectNotFound } from "../utils/errors.js";
import { getProjectDir } from "../utils/paths.js";
import {
  getTask,
  listTasks,
  readPlanIndex,
  TASK_STATUSES,
  updatePlan,
  updateTask,
} from "../utils/project-memory.js";
import { errorResult, jsonResult, toolError } from "../utils/tool-response.js";
import { requireWriteGate, WriteGateError } from "../utils/write-gate.js";

/**
 * Map DAG task status → diagram node classDef name.
 * Diagram uses camelCase (inProgress), DAG uses snake_case (in_progress).
 */
const STATUS_TO_DIAGRAM: Record<string, string> = {
  backlog: "backlog",
  in_progress: "inProgress",
  done: "done",
  cancelled: "done", // cancelled tasks rendered as done in diagram
};

export function registerTransitionProjectTask(server: McpServer) {
  server.tool(
    "transition_project_task",
    "Atomically transition a task's status, updating plan and diagram state consistently. Returns before/after diff summary.",
    {
      slug: z.string().describe("Project slug"),
      taskId: z.string().describe("Task identifier"),
      status: z.enum(TASK_STATUSES).describe("Target status"),
      planId: z
        .string()
        .optional()
        .describe("Plan ID to check for auto-completion (auto-detected from task if omitted)"),
      diagramNodeId: z
        .string()
        .optional()
        .describe("Diagram node ID (e.g. T001) to update in associated .diagram.mmd"),
      confirmationToken: z.string().optional().describe("Write-gate confirmation token"),
    },
    async (params) => {
      try {
        requireWriteGate(params.confirmationToken, params.slug, "tool:transition_project_task");

        const projectDir = getProjectDir(params.slug);
        if (!existsSync(projectDir)) {
          return formatError(projectNotFound(params.slug));
        }

        // 1. Get current task state
        const currentTask = await getTask(projectDir, params.taskId);
        const previousStatus = currentTask.status;

        if (previousStatus === params.status) {
          return jsonResult({
            taskId: params.taskId,
            previousStatus,
            newStatus: params.status,
            planUpdate: null,
            diagramUpdate: null,
            note: "No change — task already in target status",
          });
        }

        // 2. Update task status (canonical source)
        await updateTask(projectDir, {
          id: params.taskId,
          status: params.status,
        });

        // 3. Determine plan context
        const effectivePlanId = params.planId ?? currentTask.planId;
        let planUpdate: {
          planId: string;
          previousStatus: string;
          newStatus: string;
        } | null = null;

        // 4. Check plan auto-completion
        // Policy: auto-complete fires only when:
        //   - At least one linked task exists
        //   - Every linked task is "done"
        //   - No linked task is "cancelled" (implicit: every() requires "done")
        if (effectivePlanId) {
          const allTasks = await listTasks(projectDir, {});
          const planTasks = allTasks.filter((t) => t.planId === effectivePlanId);

          const allDone =
            planTasks.length > 0 &&
            planTasks.every((t) => t.status === "done");

          if (allDone) {
            const planIndex = await readPlanIndex(projectDir);
            const planMeta = planIndex.plans.find((p) => p.normalizedId === effectivePlanId);
            if (planMeta && planMeta.status !== "done" && planMeta.status !== "archived") {
              const prevPlanStatus = planMeta.status;
              await updatePlan(projectDir, { id: effectivePlanId, status: "done" });
              planUpdate = {
                planId: effectivePlanId,
                previousStatus: prevPlanStatus,
                newStatus: "done",
              };
            }
          }
        }

        // 5. Update diagram if requested
        let diagramUpdate: {
          nodeId: string;
          newStatus: string;
          readyNodes: string[];
          note?: string;
        } | null = null;

        if (params.diagramNodeId && !effectivePlanId) {
          diagramUpdate = {
            nodeId: params.diagramNodeId,
            newStatus: params.status,
            readyNodes: [],
            note: "diagramNodeId provided but no planId context — diagram not updated",
          };
        } else if (params.diagramNodeId && effectivePlanId) {
          const plansDir = resolve(projectDir, "plans");
          const diagramPath = resolve(plansDir, `${effectivePlanId}.diagram.mmd`);

          if (existsSync(diagramPath)) {
            const diagramStatus = STATUS_TO_DIAGRAM[params.status] ?? params.status;
            const result = updateDiagramNodeStatus(
              diagramPath,
              params.diagramNodeId,
              diagramStatus,
            );
            diagramUpdate = {
              nodeId: params.diagramNodeId,
              newStatus: diagramStatus,
              readyNodes: result.readyNodes,
            };
          } else {
            diagramUpdate = {
              nodeId: params.diagramNodeId,
              newStatus: params.status,
              readyNodes: [],
              note: `Diagram file not found for plan "${effectivePlanId}" — diagram not updated`,
            };
          }
        }

        return jsonResult({
          taskId: params.taskId,
          previousStatus,
          newStatus: params.status,
          planUpdate,
          diagramUpdate,
        });
      } catch (err) {
        if (err instanceof WriteGateError) return toolError("WRITE_GATE", err.message);
        if (err instanceof DagError) return formatError(err);
        return errorResult(err);
      }
    },
  );
}

// ---------------------------------------------------------------------------
// Diagram update logic (inline, mirrors manage-diagram.mjs status command)
// ---------------------------------------------------------------------------

interface DiagramUpdateResult {
  readyNodes: string[];
}

function updateDiagramNodeStatus(
  filePath: string,
  nodeId: string,
  newStatus: string,
): DiagramUpdateResult {
  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const flowchartIdx = lines.findIndex((l) => /^\s*flowchart\s+TD/i.test(l));

  if (flowchartIdx === -1) {
    return { readyNodes: [] };
  }

  const headerLines = lines.slice(0, flowchartIdx);
  const graphLines = lines.slice(flowchartIdx);

  // Update graph lines — change :::status for the target node
  const updatedGraphLines = graphLines.map((line) => {
    const re = new RegExp(`(\\b${nodeId}\\[[^\\]]+\\]):::\\w+`, "g");
    return line.replace(re, `$1:::${newStatus}`);
  });

  // Update metadata block status for target node
  const updatedHeaderLines: string[] = [];
  let inTargetBlock = false;
  for (const line of headerLines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("%%")) {
      const c = trimmed.slice(2).trim();
      const nodeMatch = c.match(/^node:\s*(.+)$/);
      if (nodeMatch) {
        inTargetBlock = nodeMatch[1].trim() === nodeId;
      }
      if (inTargetBlock && c.startsWith("status:")) {
        updatedHeaderLines.push(`%% status: ${newStatus}`);
        continue;
      }
    } else {
      inTargetBlock = false;
    }
    updatedHeaderLines.push(line);
  }

  // Parse updated nodes and edges to compute ready
  const nodes = parseNodes(updatedGraphLines);
  const edges = parseEdges(updatedGraphLines);
  const readyNodes = computeReady(nodes, edges);
  const blockedNodes = nodes.filter((n) => n.status === "blocked").map((n) => n.id);

  // Recompute plan-level comments
  const statusStr = nodes.map((n) => `${n.id}=${n.status}`).join(", ");
  const readyStr = readyNodes.length > 0 ? readyNodes.join(", ") : "none";
  const blockedStr = blockedNodes.length > 0 ? blockedNodes.join(", ") : "none";
  const nextAction = readyNodes.length > 0 ? `Start ${readyNodes[0]}` : "No ready tasks";

  // Replace plan-level comments
  const result: string[] = [];
  let replacedStatus = false;
  let replacedReady = false;
  let replacedBlocked = false;
  let replacedNext = false;

  for (const line of updatedHeaderLines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("%%")) {
      const c = trimmed.slice(2).trim();
      if (c.startsWith("status:") && !replacedStatus) {
        const firstNodeIdx = updatedHeaderLines.findIndex((l) => l.trim().startsWith("%% node:"));
        const lineIdx = updatedHeaderLines.indexOf(line);
        if (lineIdx < firstNodeIdx || firstNodeIdx === -1) {
          result.push(`%% status: ${statusStr}`);
          replacedStatus = true;
          continue;
        }
      }
      if (c.startsWith("ready:") && !replacedReady) {
        result.push(`%% ready: ${readyStr}`);
        replacedReady = true;
        continue;
      }
      if (c.startsWith("blocked:") && !replacedBlocked) {
        const firstNodeIdx = updatedHeaderLines.findIndex((l) => l.trim().startsWith("%% node:"));
        const lineIdx = updatedHeaderLines.indexOf(line);
        if (lineIdx < firstNodeIdx || firstNodeIdx === -1) {
          result.push(`%% blocked: ${blockedStr}`);
          replacedBlocked = true;
          continue;
        }
      }
      if (c.startsWith("next-action:") && !replacedNext) {
        result.push(`%% next-action: ${nextAction}`);
        replacedNext = true;
        continue;
      }
    }
    result.push(line);
  }

  const finalContent = [...result, ...updatedGraphLines].join("\n");
  writeFileSync(filePath, finalContent);

  return { readyNodes };
}

// ---------------------------------------------------------------------------
// Minimal graph parsing (mirrors manage-diagram.mjs)
// ---------------------------------------------------------------------------

interface GraphNode {
  id: string;
  label: string;
  status: string;
}

interface GraphEdge {
  from: string;
  to: string;
}

function parseNodes(graphLines: string[]): GraphNode[] {
  const nodes: GraphNode[] = [];
  const seen = new Set<string>();
  const nodeRe = /\b(T\d{3,})\[([^\]]+)\](?::::(\w+))?/g;
  for (const line of graphLines) {
    for (const match of line.matchAll(nodeRe)) {
      const [, id, label, status] = match;
      if (!seen.has(id)) {
        nodes.push({ id, label, status: status || "backlog" });
        seen.add(id);
      }
    }
  }
  return nodes;
}

function parseEdges(graphLines: string[]): GraphEdge[] {
  const edges: GraphEdge[] = [];
  const edgeRe = /\b(T\d{3,})(?:\[[^\]]*\](?::::\w+)?)?\s*-->\s*(T\d{3,})/g;
  for (const line of graphLines) {
    for (const match of line.matchAll(edgeRe)) {
      edges.push({ from: match[1], to: match[2] });
    }
  }
  return edges;
}

function computeReady(nodes: GraphNode[], edges: GraphEdge[]): string[] {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const ready: string[] = [];
  for (const node of nodes) {
    if (node.status !== "backlog") continue;
    const incomingDeps = edges.filter((e) => e.to === node.id).map((e) => e.from);
    const allDepsDone = incomingDeps.every((depId) => {
      const dep = nodeMap.get(depId);
      return dep && dep.status === "done";
    });
    if (allDepsDone) {
      ready.push(node.id);
    }
  }
  return ready;
}
