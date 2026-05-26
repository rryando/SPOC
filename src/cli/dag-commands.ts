// ---------------------------------------------------------------------------
// DAG CLI Command Handlers — Thin delegation shell
// ---------------------------------------------------------------------------
// All commands are now in the registry (src/cli/commands/*.ts).
// This file provides backward-compatible exports for tests and the fallback
// router in src/cli/index.ts.
// ---------------------------------------------------------------------------

import { existsSync } from "node:fs";
import { createGraphCache } from "../retrieval/graph-cache.js";
import { retrieveRelated } from "../retrieval/graph-retrieval.js";
import { getProjectDir } from "../utils/paths.js";
import { parseArgs } from "./arg-parser.js";
import { type CommandDef, getCommand } from "./command-registry.js";
import { formatJsonOutput, isLeanMode } from "./lean-output.js";
import { render, stripTimestamps } from "./output-envelope.js";
import "./commands/index.js";

// Re-export for backward compatibility
export { selectKnowledgeEntries } from "../retrieval/knowledge-selection.js";

// Module-level lean mode flag
let _leanMode = false;

/** Stringify with optional lean transform */
function jsonOut(data: unknown): string {
  return formatJsonOutput(data, _leanMode);
}

function extractFlag(args: string[], flag: string): string | undefined {
  const found = args.find((a) => a.startsWith(`${flag}=`));
  if (!found) return undefined;
  return found.split("=")[1];
}

function cliError(msg: string): void {
  console.error(msg);
}

function printUsage(): void {
  console.log("Usage: spoc <command> [options]\n");
  console.log("DAG Commands:");
  console.log("  context [<path|slug>]               Resolve project context");
  console.log("  task list <slug>                    List tasks");
  console.log("  task get <slug> <taskId>            Get task details");
  console.log("  task transition <slug> <id> <s>     Transition task status");
  console.log("  plan list <slug>                    List plans");
  console.log("  plan get <slug> <planId> [--body]   Get plan details");
  console.log("  knowledge list <slug>               List knowledge entries");
  console.log("  knowledge search <slug> <query>     Search knowledge");
  console.log("  search <slug> <query>               BM25 search across all");
  console.log("  related <slug> --task=<id>          Graph-based related entities");
  console.log("  graph inspect <slug>                Inspect graph index stats");
  console.log("  diagram ready <slug> <planId>       Show ready-to-execute nodes");
  console.log("\nOptions:");
  console.log("  --json      Output as JSON");
  console.log("  --lean      Strip timestamps for token efficiency");
  console.log("  --dry-run   Validate params without side effects");
  console.log("  --help      Show command usage");
}

// ---------------------------------------------------------------------------
// handleRelated — kept for test/cli-related.test.ts
// ---------------------------------------------------------------------------

export async function handleRelated(args: string[], json: boolean): Promise<void> {
  const slug = args[0];
  if (!slug) {
    cliError(
      "Error: usage: spoc related <slug> --task=<id> | --knowledge=<id> | --plan=<id> [--limit=N] [--json]",
    );
    return;
  }

  const taskId = extractFlag(args, "--task");
  const knowledgeId = extractFlag(args, "--knowledge");
  const planId = extractFlag(args, "--plan");

  if (!taskId && !knowledgeId && !planId) {
    cliError("Error: one of --task, --knowledge, or --plan is required");
    return;
  }

  let startNodeId: string;
  let startLabel: string;
  if (taskId) {
    startNodeId = `task:${taskId}`;
    startLabel = `task "${taskId}"`;
  } else if (knowledgeId) {
    startNodeId = `knowledge:${knowledgeId}`;
    startLabel = `knowledge "${knowledgeId}"`;
  } else {
    startNodeId = `plan:${planId}`;
    startLabel = `plan "${planId}"`;
  }

  const limitStr = extractFlag(args, "--limit");
  const limit = limitStr ? Number.parseInt(limitStr, 10) : 10;

  const results = await retrieveRelated(slug, startNodeId, { limit });

  if (json) {
    console.log(jsonOut(results));
    return;
  }

  if (results.length === 0) {
    console.log(`No related entities found for ${startLabel}.`);
    return;
  }

  console.log(`Related to ${startLabel}:`);
  for (const r of results) {
    const score = r.score.toFixed(2).padStart(6);
    const type = r.type.padEnd(10);
    console.log(`  ${score}  ${type}  ${r.title}`);
    console.log(`                     \u2192 ${r.relation}`);
  }
}

// ---------------------------------------------------------------------------
// handleGraph — kept for test/cli-graph-inspect.test.ts
// ---------------------------------------------------------------------------

export async function handleGraph(args: string[], json: boolean): Promise<void> {
  const subcommand = args[0];
  if (subcommand !== "inspect") {
    cliError("Error: usage: spoc graph inspect <slug> [--json]");
    return;
  }

  const slug = args[1];
  if (!slug) {
    cliError("Error: usage: spoc graph inspect <slug> [--json]");
    return;
  }

  const projectDir = getProjectDir(slug);
  if (!existsSync(projectDir)) {
    cliError(`Error: project "${slug}" not found`);
    return;
  }

  const cache = createGraphCache();
  const index = await cache.getOrBuild(slug);

  const nodeCount = index.nodes.size;

  let edgeCount = 0;
  for (const edgeList of index.edges.values()) {
    edgeCount += edgeList.length;
  }

  const nodesByType: Record<string, number> = {};
  for (const node of index.nodes.values()) {
    nodesByType[node.type] = (nodesByType[node.type] || 0) + 1;
  }

  const mostConnectedFiles = [...index.fileIndex.entries()]
    .map(([path, refs]) => ({ path, refs: refs.length }))
    .sort((a, b) => b.refs - a.refs)
    .slice(0, 10);

  // Orphan nodes: no outgoing AND no incoming edges
  const hasConnection = new Set<string>();
  for (const [source, edgeList] of index.edges.entries()) {
    if (edgeList.length > 0) hasConnection.add(source);
    for (const edge of edgeList) {
      hasConnection.add(edge.target);
    }
  }
  const orphanNodes: string[] = [];
  for (const nodeId of index.nodes.keys()) {
    if (!hasConnection.has(nodeId)) orphanNodes.push(nodeId);
  }

  const density = nodeCount > 1 ? edgeCount / (nodeCount * (nodeCount - 1)) : 0;

  const result = {
    nodeCount,
    edgeCount,
    nodesByType,
    mostConnectedFiles,
    orphanNodes,
    density: Math.round(density * 1000) / 1000,
  };

  if (json) {
    console.log(jsonOut(result));
    return;
  }

  console.log(`Graph inspect: ${slug}`);
  console.log(`  Nodes: ${nodeCount}`);
  console.log(`  Edges: ${edgeCount}`);
  console.log(`  Density: ${result.density}`);
  console.log(`  Nodes by type:`);
  for (const [type, count] of Object.entries(nodesByType)) {
    console.log(`    ${type}: ${count}`);
  }
  if (mostConnectedFiles.length > 0) {
    console.log(`  Most connected files:`);
    for (const f of mostConnectedFiles) {
      console.log(`    ${f.path} (${f.refs} refs)`);
    }
  }
  if (orphanNodes.length > 0) {
    console.log(`  Orphan nodes: ${orphanNodes.join(", ")}`);
  }
}

// ---------------------------------------------------------------------------
// Dispatcher — delegates all commands to the registry
// ---------------------------------------------------------------------------

/**
 * Dispatches DAG CLI subcommands via the registry. Returns true if handled.
 * Kept as export for backward compatibility with src/cli/index.ts and tests.
 */
export async function handleDagCommand(command: string, args: string[]): Promise<boolean> {
  // Extract global flags
  const rest: string[] = [];
  let json = false;
  let lean = false;

  for (const arg of args) {
    if (arg === "--json") json = true;
    else if (arg === "--lean") lean = true;
    else if (arg === "--dry-run") {
      /* consumed */
    } else rest.push(arg);
  }

  if (!lean && isLeanMode([])) lean = true;
  _leanMode = lean;

  // Special-case: legacy handlers not yet in registry
  if (command === "related") {
    await handleRelated(rest, json);
    return true;
  }
  if (command === "graph") {
    await handleGraph(rest, json);
    return true;
  }

  // Delegate to registry
  const firstPositional = rest.find((a) => !a.startsWith("-"));
  let registeredCmd: CommandDef | undefined;
  let remaining: string[];

  if (firstPositional) {
    const twoWord = `${command} ${firstPositional}`;
    const cmd = getCommand(twoWord);
    if (cmd) {
      registeredCmd = cmd;
      remaining = [];
      let removed = false;
      for (const a of rest) {
        if (!removed && a === firstPositional) {
          removed = true;
          continue;
        }
        remaining.push(a);
      }
    }
  }
  if (!registeredCmd) {
    const cmd = getCommand(command);
    if (cmd) {
      registeredCmd = cmd;
      remaining = rest;
    }
  }
  if (!registeredCmd) {
    // Known DAG commands without a matching registry entry
    const knownCommands = [
      "task",
      "plan",
      "knowledge",
      "diagram",
      "doc",
      "dependency",
      "paths",
      "loop",
      "lint-bundle",
      "deploy-superpowers",
      "sync-agents-md",
      "audit",
      "diff",
      "git-log",
      "batch",
      "validate",
      "project",
      "write",
      "context",
      "search",
      "agents-md",
    ];
    if (knownCommands.includes(command)) {
      if (rest.includes("--help")) {
        printUsage();
      } else if (firstPositional) {
        cliError(`Error: unknown ${command} subcommand "${firstPositional}"`);
        process.exitCode = 1;
      } else {
        cliError(`Error: missing subcommand for "${command}". Use --help for usage.`);
        process.exitCode = 1;
      }
      return true;
    }
    return false;
  }

  // Re-inject global flags for parseArgs
  const fullArgs = [...remaining!];
  if (json) fullArgs.push("--json");
  if (lean) fullArgs.push("--lean");

  const result = parseArgs(registeredCmd, fullArgs);
  if (!result.ok) {
    // Format error in legacy style for backward compatibility
    const err = result.error as {
      ok: false;
      code: string;
      message: string;
      hint?: string;
      param?: string;
    };
    let errMsg: string;
    if (err.code === "invalid_enum" && err.param) {
      errMsg = `Error: invalid ${err.param} "${(fullArgs.find((a) => a.startsWith(`--${err.param}=`)) || "").split("=")[1] || ""}"`;
      if (err.hint) errMsg += `. ${err.hint}`;
    } else {
      const hint = err.hint ? err.hint.replace(/^Usage:/, "usage:") : undefined;
      errMsg = hint ? `${err.message} — ${hint}` : err.message;
    }
    cliError(errMsg);
    process.exitCode = 1;
    return true;
  }

  if (result.parsed.flags.help) {
    // Let the main router handle --help
    return false;
  }

  const cmdResult = await registeredCmd.handler(result.parsed.params, result.parsed.flags);
  if (cmdResult.ok) {
    const flags = result.parsed.flags;
    if (flags.json) {
      const data = flags.lean ? stripTimestamps(cmdResult.data) : cmdResult.data;
      console.log(JSON.stringify(data));
    } else {
      const data = cmdResult.data;
      if (typeof data === "string") {
        console.log(data);
      } else if (data !== null && data !== undefined) {
        console.log(JSON.stringify(data, null, 2));
      }
    }
    return true;
  }
  // Error — render via envelope for consistent error formatting
  render(cmdResult, { json, lean });
  process.exitCode = 1;
  return true;
}
