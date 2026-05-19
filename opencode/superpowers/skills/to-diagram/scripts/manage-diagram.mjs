#!/usr/bin/env node
// manage-diagram.mjs — Deterministic diagram management for .diagram.mmd files
// No external dependencies. Node ESM CLI.

import { readFileSync, writeFileSync } from "node:fs";

// --- Pure helpers ---

function parseNodes(graphLines) {
  const nodes = [];
  const seen = new Set();
  // Match node declarations: ID[label]:::status or ID[label] (no status)
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

function parseEdges(graphLines) {
  const edges = [];
  const edgeRe = /\b(T\d{3,})(?:\[[^\]]*\](?::::\w+)?)?\s*-->\s*(T\d{3,})/g;
  for (const line of graphLines) {
    for (const match of line.matchAll(edgeRe)) {
      edges.push({ from: match[1], to: match[2] });
    }
  }
  return edges;
}

function parseMetadataBlocks(lines) {
  const blocks = {};
  let current = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("%%")) continue;

    const content = trimmed.slice(2).trim();
    const fieldMatch = content.match(/^(\S+?):\s*(.*)$/);
    if (!fieldMatch) continue;

    const [, key, value] = fieldMatch;

    if (key === "node") {
      current = value.trim();
      blocks[current] = { node: current };
    } else if (current) {
      blocks[current][key] = value.trim();
    }
  }

  return blocks;
}

function parsePlanLevelComments(lines) {
  const result = { planId: null, statusComment: null, readyComment: null, blockedComment: null, nextActionComment: null };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("%%")) continue;
    const content = trimmed.slice(2).trim();

    // Stop at first node metadata block
    if (content.startsWith("node:")) break;

    if (content.startsWith("plan:")) {
      result.planId = content.slice(5).trim();
    } else if (content.startsWith("status:")) {
      result.statusComment = content.slice(7).trim();
    } else if (content.startsWith("ready:")) {
      result.readyComment = content.slice(6).trim();
    } else if (content.startsWith("blocked:")) {
      result.blockedComment = content.slice(8).trim();
    } else if (content.startsWith("next-action:")) {
      result.nextActionComment = content.slice(12).trim();
    }
  }

  return result;
}

function splitSections(content) {
  const lines = content.split("\n");
  const flowchartIdx = lines.findIndex((l) => /^\s*flowchart\s+TD/i.test(l));

  if (flowchartIdx === -1) {
    return { headerLines: lines, graphLines: [], flowchartIdx: -1 };
  }

  return {
    headerLines: lines.slice(0, flowchartIdx),
    graphLines: lines.slice(flowchartIdx),
    flowchartIdx,
  };
}

function computeReady(nodes, edges) {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const ready = [];

  for (const node of nodes) {
    if (node.status !== "backlog") continue;
    const incomingDeps = edges.filter((e) => e.to === node.id).map((e) => e.from);
    const allDepsDone = incomingDeps.every((depId) => {
      const dep = nodeMap.get(depId);
      return dep && dep.status === "done";
    });
    if (allDepsDone) ready.push(node.id);
  }

  return ready;
}

function computeBlocked(nodes, edges) {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const blocked = [];

  for (const node of nodes) {
    if (node.status === "done") continue;
    const incomingDeps = edges.filter((e) => e.to === node.id).map((e) => e.from);
    const hasUndone = incomingDeps.some((depId) => {
      const dep = nodeMap.get(depId);
      return dep && dep.status !== "done";
    });
    if (hasUndone && node.status !== "blocked") {
      // Not explicitly blocked but has undone deps — may or may not be considered blocked
    }
    if (node.status === "blocked") {
      blocked.push(node.id);
    }
  }

  return blocked;
}

function parseReadyNodeIds(readyComment) {
  if (!readyComment) return [];
  const ids = [];
  for (const match of readyComment.matchAll(/T\d{3,}/g)) {
    ids.push(match[0]);
  }
  return ids.sort();
}

function parseStatusComment(statusComment) {
  if (!statusComment) return {};
  const result = {};
  for (const match of statusComment.matchAll(/(T\d{3,})=(\w+)/g)) {
    result[match[1]] = match[2];
  }
  return result;
}

// --- Commands ---

function inspect(filePath) {
  const content = readFileSync(filePath, "utf-8");
  const { headerLines, graphLines } = splitSections(content);

  if (graphLines.length === 0) {
    // Check for stateDiagram
    if (content.includes("stateDiagram-v2")) {
      process.stderr.write("Error: stateDiagram-v2 is not supported by this tool.\n");
      process.exit(1);
    }
    process.stderr.write("Error: No flowchart TD found in file.\n");
    process.exit(1);
  }

  const nodes = parseNodes(graphLines);
  const edges = parseEdges(graphLines);
  const metadataBlocks = parseMetadataBlocks(headerLines);
  const planLevel = parsePlanLevelComments(headerLines);

  const result = {
    planId: planLevel.planId,
    nodes,
    edges,
    metadataBlocks,
    statusComment: planLevel.statusComment,
    readyComment: planLevel.readyComment,
    blockedComment: planLevel.blockedComment,
    nextActionComment: planLevel.nextActionComment,
  };

  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

function ready(filePath) {
  const content = readFileSync(filePath, "utf-8");
  const { headerLines, graphLines } = splitSections(content);

  if (graphLines.length === 0) {
    if (content.includes("stateDiagram-v2")) {
      process.stderr.write("Error: stateDiagram-v2 is not supported by this tool.\n");
      process.exit(1);
    }
    process.stderr.write("Error: No flowchart TD found in file.\n");
    process.exit(1);
  }

  const nodes = parseNodes(graphLines);
  const edges = parseEdges(graphLines);
  const readyNodes = computeReady(nodes, edges);

  process.stdout.write(JSON.stringify(readyNodes, null, 2) + "\n");
}

function validate(filePath) {
  const content = readFileSync(filePath, "utf-8");
  const errors = [];

  // Check for unsupported diagram type
  if (content.includes("stateDiagram-v2")) {
    process.stdout.write(JSON.stringify({ ok: false, errors: ["Unsupported diagram type: stateDiagram-v2. Only flowchart TD is supported."] }, null, 2) + "\n");
    process.exit(1);
  }

  const { headerLines, graphLines } = splitSections(content);

  if (graphLines.length === 0) {
    process.stdout.write(JSON.stringify({ ok: false, errors: ["No flowchart TD found in file."] }, null, 2) + "\n");
    process.exit(1);
  }

  const nodes = parseNodes(graphLines);
  const edges = parseEdges(graphLines);
  const metadataBlocks = parseMetadataBlocks(headerLines);
  const planLevel = parsePlanLevelComments(headerLines);

  // Duplicate node IDs in graph
  const nodeIds = [];
  const nodeRe = /\b(T\d{3,})\[([^\]]+)\](?::::(\w+))?/g;
  for (const line of graphLines) {
    for (const match of line.matchAll(nodeRe)) {
      nodeIds.push(match[1]);
    }
  }
  const idCounts = {};
  for (const id of nodeIds) {
    idCounts[id] = (idCounts[id] || 0) + 1;
  }
  for (const [id, count] of Object.entries(idCounts)) {
    if (count > 1) errors.push(`Duplicate node ID in graph: ${id}`);
  }

  // Duplicate metadata blocks
  const metaNodeIds = [];
  for (const line of headerLines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("%%")) {
      const content = trimmed.slice(2).trim();
      const m = content.match(/^node:\s*(.+)$/);
      if (m) metaNodeIds.push(m[1].trim());
    }
  }
  const metaCounts = {};
  for (const id of metaNodeIds) {
    metaCounts[id] = (metaCounts[id] || 0) + 1;
  }
  for (const [id, count] of Object.entries(metaCounts)) {
    if (count > 1) errors.push(`Duplicate metadata block for node: ${id}`);
  }

  // Edges referencing missing nodes
  const nodeIdSet = new Set(nodes.map((n) => n.id));
  for (const edge of edges) {
    if (!nodeIdSet.has(edge.from)) errors.push(`Edge references missing node: ${edge.from}`);
    if (!nodeIdSet.has(edge.to)) errors.push(`Edge references missing node: ${edge.to}`);
  }

  // Missing metadata block for graph nodes
  for (const node of nodes) {
    if (!metadataBlocks[node.id]) {
      errors.push(`Missing metadata block for node: ${node.id}`);
    }
  }

  // Missing required metadata fields
  const requiredFields = ["node", "title", "status", "skill", "scope", "acceptance", "verify"];
  for (const node of nodes) {
    const block = metadataBlocks[node.id];
    if (block) {
      for (const field of requiredFields) {
        if (!block[field]) {
          errors.push(`Missing required field '${field}' in metadata block for ${node.id}`);
        }
      }
    }
  }

  // Metadata blocks not ordered by node ID
  if (metaNodeIds.length > 1) {
    const uniqueMetaIds = [...new Set(metaNodeIds)];
    const sorted = [...uniqueMetaIds].sort();
    if (JSON.stringify(uniqueMetaIds) !== JSON.stringify(sorted)) {
      errors.push("Metadata blocks are not ordered by node ID");
    }
  }

  // Graph node status differs from metadata block status
  for (const node of nodes) {
    const block = metadataBlocks[node.id];
    if (block && block.status && block.status !== node.status) {
      errors.push(`Status mismatch for ${node.id}: graph says '${node.status}', metadata says '${block.status}'`);
    }
  }

  // Status comment differs from graph node statuses
  if (planLevel.statusComment) {
    const commentStatuses = parseStatusComment(planLevel.statusComment);
    for (const node of nodes) {
      if (commentStatuses[node.id] && commentStatuses[node.id] !== node.status) {
        errors.push(`Status comment mismatch for ${node.id}: comment says '${commentStatuses[node.id]}', graph says '${node.status}'`);
      }
    }
  }

   // Ready comment differs from computed ready nodes
  if (planLevel.readyComment) {
    const commentReady = parseReadyNodeIds(planLevel.readyComment);
    // Validate that all ready IDs actually exist in the graph
    for (const id of commentReady) {
      if (!nodeIdSet.has(id)) {
        errors.push(`Ready comment references node '${id}' not found in graph`);
      }
    }
    const computedReady = computeReady(nodes, edges).sort();
    if (JSON.stringify(commentReady) !== JSON.stringify(computedReady)) {
      errors.push(`Ready comment mismatch: comment says [${commentReady.join(", ")}], computed is [${computedReady.join(", ")}]`);
    }
  }

  const ok = errors.length === 0;
  process.stdout.write(JSON.stringify({ ok, errors }, null, 2) + "\n");
  if (!ok) process.exit(1);
}

function status(filePath, nodeId, newStatus) {
  const validStatuses = ["done", "inProgress", "blocked", "backlog"];
  if (!validStatuses.includes(newStatus)) {
    process.stderr.write(`Error: Invalid status '${newStatus}'. Must be one of: ${validStatuses.join(", ")}\n`);
    process.exit(1);
  }

  const content = readFileSync(filePath, "utf-8");

  if (content.includes("stateDiagram-v2")) {
    process.stderr.write("Error: stateDiagram-v2 is not supported by this tool.\n");
    process.exit(1);
  }

  const { headerLines, graphLines } = splitSections(content);

  if (graphLines.length === 0) {
    process.stderr.write("Error: No flowchart TD found in file.\n");
    process.exit(1);
  }

  // Capture pre-update topology
  const preNodes = parseNodes(graphLines);
  const preEdges = parseEdges(graphLines);
  const preNodeSet = new Set(preNodes.map((n) => n.id));
  const preEdgeSet = new Set(preEdges.map((e) => `${e.from}->${e.to}`));

  if (!preNodeSet.has(nodeId)) {
    process.stderr.write(`Error: Node '${nodeId}' not found in graph.\n`);
    process.exit(1);
  }

  // Update graph lines — change :::status for the target node
  const updatedGraphLines = graphLines.map((line) => {
    // Replace :::oldStatus for specific node ID
    const re = new RegExp(`(\\b${nodeId}\\[[^\\]]+\\]):::\\w+`, "g");
    return line.replace(re, `$1:::${newStatus}`);
  });

  // Verify the graph was actually updated (node must have :::class suffix)
  const graphChanged = graphLines.some((line, i) => line !== updatedGraphLines[i]);
  if (!graphChanged) {
    process.stderr.write(`Error: Node '${nodeId}' has no :::class suffix in graph declaration. Cannot update status.\n`);
    process.exit(1);
  }

  // Update metadata block status
  const updatedHeaderLines = [];
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

  // Recompute plan-level comments
  const updatedNodes = parseNodes(updatedGraphLines);
  const updatedEdges = parseEdges(updatedGraphLines);
  const readyNodes = computeReady(updatedNodes, updatedEdges);
  const blockedNodes = updatedNodes.filter((n) => n.status === "blocked").map((n) => n.id);

  // Build new status comment
  const statusStr = updatedNodes.map((n) => `${n.id}=${n.status}`).join(", ");
  const readyStr = readyNodes.length > 0 ? readyNodes.join(", ") : "none";
  const blockedStr = blockedNodes.length > 0 ? blockedNodes.join(", ") : "none";
  const nextAction = readyNodes.length > 0 ? `Start ${readyNodes[0]}` : "No ready tasks";

  // Replace plan-level comments in header
  const result = [];
  let replacedStatus = false, replacedReady = false, replacedBlocked = false, replacedNext = false;

  for (const line of updatedHeaderLines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("%%")) {
      const c = trimmed.slice(2).trim();
      // Plan-level comments come before first node: block
      if (c.startsWith("status:") && !replacedStatus) {
        // Check if this is plan-level (before any node block)
        const lineIdx = updatedHeaderLines.indexOf(line);
        const firstNodeIdx = updatedHeaderLines.findIndex((l) => l.trim().startsWith("%% node:"));
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
        // Plan-level blocked
        const lineIdx = updatedHeaderLines.indexOf(line);
        const firstNodeIdx = updatedHeaderLines.findIndex((l) => l.trim().startsWith("%% node:"));
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

  // Verify topology unchanged
  const postNodes = parseNodes(updatedGraphLines);
  const postEdges = parseEdges(updatedGraphLines);
  const postNodeSet = new Set(postNodes.map((n) => n.id));
  const postEdgeSet = new Set(postEdges.map((e) => `${e.from}->${e.to}`));

  const nodeSetEqual = preNodeSet.size === postNodeSet.size && [...preNodeSet].every((id) => postNodeSet.has(id));
  const edgeSetEqual = preEdgeSet.size === postEdgeSet.size && [...preEdgeSet].every((e) => postEdgeSet.has(e));

  if (!nodeSetEqual || !edgeSetEqual) {
    process.stderr.write("Error: Topology changed during status update. Aborting.\n");
    process.exit(1);
  }

  writeFileSync(filePath, finalContent);

  const summary = { updated: true, nodeId, status: newStatus, ready: readyNodes };
  process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
}

function sortMetadata(filePath) {
  const content = readFileSync(filePath, "utf-8");

  if (content.includes("stateDiagram-v2")) {
    process.stderr.write("Error: stateDiagram-v2 is not supported by this tool.\n");
    process.exit(1);
  }

  const lines = content.split("\n");
  const flowchartIdx = lines.findIndex((l) => /^\s*flowchart\s+TD/i.test(l));

  if (flowchartIdx === -1) {
    process.stderr.write("Error: No flowchart TD found in file.\n");
    process.exit(1);
  }

  const headerLines = lines.slice(0, flowchartIdx);
  const graphLines = lines.slice(flowchartIdx);

  // Separate plan-level comments from node metadata blocks
  const planComments = [];
  const nodeBlocks = []; // array of { id, lines }
  let currentBlock = null;

  for (const line of headerLines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("%%")) {
      const c = trimmed.slice(2).trim();
      const nodeMatch = c.match(/^node:\s*(.+)$/);
      if (nodeMatch) {
        if (currentBlock) nodeBlocks.push(currentBlock);
        currentBlock = { id: nodeMatch[1].trim(), lines: [line] };
        continue;
      }
      if (currentBlock) {
        currentBlock.lines.push(line);
        continue;
      }
    } else if (trimmed === "" && currentBlock) {
      // Empty line after a node block — keep as separator
      currentBlock.lines.push(line);
      nodeBlocks.push(currentBlock);
      currentBlock = null;
      continue;
    } else if (currentBlock) {
      // Non-comment line ends the block
      nodeBlocks.push(currentBlock);
      currentBlock = null;
    }

    if (!currentBlock) {
      planComments.push(line);
    }
  }
  if (currentBlock) nodeBlocks.push(currentBlock);

  // Sort node blocks by ID
  nodeBlocks.sort((a, b) => a.id.localeCompare(b.id));

  // Reassemble
  const sortedHeader = [
    ...planComments,
    ...nodeBlocks.flatMap((block) => block.lines),
  ];

  // Ensure blank line between header and flowchart
  const lastHeaderLine = sortedHeader[sortedHeader.length - 1];
  if (lastHeaderLine && lastHeaderLine.trim() !== "") {
    sortedHeader.push("");
  }

  const finalContent = [...sortedHeader, ...graphLines].join("\n");
  writeFileSync(filePath, finalContent);

  const sortedIds = nodeBlocks.map((b) => b.id);
  process.stdout.write(JSON.stringify({ sorted: true, order: sortedIds }, null, 2) + "\n");
}

// --- CLI ---

const [, , command, filePath, ...args] = process.argv;

if (!command || !filePath) {
  process.stderr.write("Usage: manage-diagram.mjs <command> <file> [args...]\n");
  process.stderr.write("Commands: inspect, ready, validate, status, sort-metadata\n");
  process.exit(1);
}

switch (command) {
  case "inspect":
    inspect(filePath);
    break;
  case "ready":
    ready(filePath);
    break;
  case "validate":
    validate(filePath);
    break;
  case "status":
    if (args.length < 2) {
      process.stderr.write("Usage: manage-diagram.mjs status <file> <nodeId> <newStatus>\n");
      process.exit(1);
    }
    status(filePath, args[0], args[1]);
    break;
  case "sort-metadata":
    sortMetadata(filePath);
    break;
  default:
    process.stderr.write(`Unknown command: ${command}\n`);
    process.exit(1);
}
