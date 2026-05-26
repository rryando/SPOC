// ---------------------------------------------------------------------------
// Diagram commands — registry-based
// ---------------------------------------------------------------------------

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";
import { homedir } from "node:os";
import { defineCommand, type CLIResult, type CommandFlags, ERROR_CODES } from "../command-registry.js";
import { success, failure } from "../output-envelope.js";
import { getDataDir, getProjectDir } from "../../utils/paths.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findDiagramScript(): string | undefined {
  const localPath = resolve(import.meta.dirname, "../../../opencode/spoc/skills/to-diagram/scripts/manage-diagram.mjs");
  if (existsSync(localPath)) return localPath;

  const configPath = resolve(homedir(), ".config/opencode/skills/spoc/to-diagram/scripts/manage-diagram.mjs");
  if (existsSync(configPath)) return configPath;

  return undefined;
}

function resolveDiagramPath(slug: string, planId: string): string {
  const dataDir = getDataDir();
  return resolve(dataDir, "projects", slug, "plans", `${planId}.diagram.mmd`);
}

function runDiagramScript(scriptPath: string, subcommand: string, diagramPath: string, extraArgs: string[] = []): string {
  const argsStr = extraArgs.map((a) => `"${a}"`).join(" ");
  return execSync(`node "${scriptPath}" ${subcommand} "${diagramPath}"${argsStr ? ` ${argsStr}` : ""}`, {
    encoding: "utf-8",
    timeout: 10000,
  }).trim();
}

function requireScript(): CLIResult | string {
  const scriptPath = findDiagramScript();
  if (!scriptPath) {
    return failure("script_not_found", "manage-diagram.mjs not found. Install SPOC OpenCode bundle: spoc setup");
  }
  return scriptPath;
}

function requireDiagramFile(slug: string, planId: string): CLIResult | string {
  const diagramPath = resolveDiagramPath(slug, planId);
  if (!existsSync(diagramPath)) {
    return failure(ERROR_CODES.ENTITY_NOT_FOUND, `No diagram found for plan "${planId}" in project "${slug}". Create one via brainstorm workflow.`);
  }
  return diagramPath;
}

function parseScriptOutput(output: string): unknown {
  try {
    return JSON.parse(output);
  } catch {
    return { output };
  }
}

// ---------------------------------------------------------------------------
// diagram ready
// ---------------------------------------------------------------------------

defineCommand({
  path: "diagram ready",
  description: "Show ready-to-execute nodes (all dependencies done)",
  params: {
    slug: { type: "string", required: true, positional: 0, description: "Project slug" },
    planId: { type: "string", required: true, positional: 1, description: "Plan ID" },
  },
  handler: handleDiagramReady,
});

async function handleDiagramReady(params: Record<string, unknown>, _flags: CommandFlags): Promise<CLIResult> {
  const slug = params.slug as string;
  const planId = params.planId as string;

  const diagramPath = requireDiagramFile(slug, planId);
  if (typeof diagramPath !== "string") return diagramPath;

  const scriptPath = requireScript();
  if (typeof scriptPath !== "string") return scriptPath;

  try {
    const output = runDiagramScript(scriptPath, "ready", diagramPath);
    return success(parseScriptOutput(output));
  } catch (err) {
    const msg = err instanceof Error ? (err as { stderr?: string }).stderr || err.message : String(err);
    return failure("diagram_error", `diagram ready failed: ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// diagram inspect
// ---------------------------------------------------------------------------

defineCommand({
  path: "diagram inspect",
  description: "Show diagram structure and metadata",
  params: {
    slug: { type: "string", required: true, positional: 0, description: "Project slug" },
    planId: { type: "string", positional: 1, description: "Plan ID" },
  },
  handler: handleDiagramInspect,
});

async function handleDiagramInspect(params: Record<string, unknown>, _flags: CommandFlags): Promise<CLIResult> {
  const slug = params.slug as string;
  const planId = params.planId as string | undefined;

  const projectDir = getProjectDir(slug);
  if (!existsSync(projectDir)) {
    return failure(ERROR_CODES.PROJECT_NOT_FOUND, `Project "${slug}" not found`);
  }

  if (!planId) {
    return failure(ERROR_CODES.MISSING_PARAM, "--planId is required", {
      hint: "usage: spoc diagram inspect <slug> <planId>",
    });
  }

  const diagramPath = requireDiagramFile(slug, planId);
  if (typeof diagramPath !== "string") return diagramPath;

  const scriptPath = requireScript();
  if (typeof scriptPath !== "string") return scriptPath;

  try {
    const output = runDiagramScript(scriptPath, "inspect", diagramPath);
    return success(parseScriptOutput(output));
  } catch (err) {
    const msg = err instanceof Error ? (err as { stderr?: string }).stderr || err.message : String(err);
    return failure("diagram_error", `diagram inspect failed: ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// diagram validate
// ---------------------------------------------------------------------------

defineCommand({
  path: "diagram validate",
  description: "Validate diagram integrity",
  params: {
    slug: { type: "string", required: true, positional: 0, description: "Project slug" },
    planId: { type: "string", required: true, positional: 1, description: "Plan ID" },
  },
  handler: handleDiagramValidate,
});

async function handleDiagramValidate(params: Record<string, unknown>, _flags: CommandFlags): Promise<CLIResult> {
  const slug = params.slug as string;
  const planId = params.planId as string;

  const diagramPath = requireDiagramFile(slug, planId);
  if (typeof diagramPath !== "string") return diagramPath;

  const scriptPath = requireScript();
  if (typeof scriptPath !== "string") return scriptPath;

  try {
    const output = runDiagramScript(scriptPath, "validate", diagramPath);
    return success(parseScriptOutput(output));
  } catch (err) {
    const msg = err instanceof Error ? (err as { stderr?: string }).stderr || err.message : String(err);
    return failure("diagram_error", `diagram validate failed: ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// diagram status
// ---------------------------------------------------------------------------

defineCommand({
  path: "diagram status",
  description: "Update a diagram node's status",
  gated: true,
  gateName: "diagram-status",
  mutation: true,
  params: {
    slug: { type: "string", required: true, positional: 0, description: "Project slug" },
    planId: { type: "string", required: true, positional: 1, description: "Plan ID" },
    nodeId: { type: "string", required: true, positional: 2, description: "Node ID to update" },
    status: { type: "string", required: true, positional: 3, description: "New status", enum: ["backlog", "in_progress", "done", "blocked"] },
    token: { type: "string", required: true, description: "Write-gate token" },
  },
  handler: handleDiagramStatus,
});

async function handleDiagramStatus(params: Record<string, unknown>, _flags: CommandFlags): Promise<CLIResult> {
  const slug = params.slug as string;
  const planId = params.planId as string;
  const nodeId = params.nodeId as string;
  const status = params.status as string;

  const diagramPath = requireDiagramFile(slug, planId);
  if (typeof diagramPath !== "string") return diagramPath;

  const scriptPath = requireScript();
  if (typeof scriptPath !== "string") return scriptPath;

  try {
    const output = runDiagramScript(scriptPath, "status", diagramPath, [nodeId, status]);
    return success(parseScriptOutput(output));
  } catch (err) {
    const msg = err instanceof Error ? (err as { stderr?: string }).stderr || err.message : String(err);
    return failure("diagram_error", `diagram status failed: ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// diagram sort-metadata
// ---------------------------------------------------------------------------

defineCommand({
  path: "diagram sort-metadata",
  description: "Sort metadata blocks in diagram file",
  gated: true,
  gateName: "diagram-sort-metadata",
  mutation: true,
  params: {
    slug: { type: "string", required: true, positional: 0, description: "Project slug" },
    planId: { type: "string", required: true, positional: 1, description: "Plan ID" },
    token: { type: "string", required: true, description: "Write-gate token" },
  },
  handler: handleDiagramSortMetadata,
});

async function handleDiagramSortMetadata(params: Record<string, unknown>, _flags: CommandFlags): Promise<CLIResult> {
  const slug = params.slug as string;
  const planId = params.planId as string;

  const diagramPath = requireDiagramFile(slug, planId);
  if (typeof diagramPath !== "string") return diagramPath;

  const scriptPath = requireScript();
  if (typeof scriptPath !== "string") return scriptPath;

  try {
    const output = runDiagramScript(scriptPath, "sort-metadata", diagramPath);
    return success(parseScriptOutput(output));
  } catch (err) {
    const msg = err instanceof Error ? (err as { stderr?: string }).stderr || err.message : String(err);
    return failure("diagram_error", `diagram sort-metadata failed: ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// diagram show
// ---------------------------------------------------------------------------

defineCommand({
  path: "diagram show",
  description: "Render diagram in terminal",
  params: {
    path: { type: "string", required: true, positional: 0, description: "Path to .mmd file" },
  },
  handler: handleDiagramShow,
});

async function handleDiagramShow(params: Record<string, unknown>, _flags: CommandFlags): Promise<CLIResult> {
  const path = params.path as string;

  if (!existsSync(path)) {
    return failure(ERROR_CODES.ENTITY_NOT_FOUND, `File not found: ${path}`);
  }

  try {
    const { renderDiagramShow } = await import("../diagram-renderer.js");
    const output = renderDiagramShow(path);
    return success({ output });
  } catch (err) {
    return failure("diagram_error", err instanceof Error ? err.message : String(err));
  }
}
