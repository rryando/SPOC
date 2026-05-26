// ---------------------------------------------------------------------------
// Dependency commands — registry-based
// ---------------------------------------------------------------------------

import { defineCommand, type CLIResult, type CommandFlags, ERROR_CODES } from "../command-registry.js";
import { success, failure } from "../output-envelope.js";
import { readRootMeta, wouldCreateCycle, writeRootMeta } from "../../utils/dag.js";
import { getDataDir } from "../../utils/paths.js";
import {
  requireWriteGate,
  WriteGateError,
} from "../../utils/write-gate.js";

// ---------------------------------------------------------------------------
// dependency add
// ---------------------------------------------------------------------------

defineCommand({
  path: "dependency add",
  description: "Add a dependency between two projects",
  gated: true,
  mutation: true,
  gateName: "dependency-add",
  params: {
    slug: { type: "string", required: true, positional: 0, description: "Source project slug" },
    target: { type: "string", required: true, positional: 1, description: "Target project slug (dependency)" },
    token: { type: "string", description: "Write-gate token" },
  },
  handler: handleDependencyAdd,
});

async function handleDependencyAdd(params: Record<string, unknown>, flags: CommandFlags): Promise<CLIResult> {
  const slug = params.slug as string;
  const targetSlug = params.target as string;
  const token = params.token as string | undefined;

  if (flags.dryRun) {
    return success({ dryRun: true, wouldAdd: { slug, target: targetSlug } });
  }

  try {
    requireWriteGate(token, slug, "cli:manage_dependency");
  } catch (err) {
    if (err instanceof WriteGateError) {
      return failure(err.code, err.message, { hint: err.hint });
    }
    throw err;
  }

  try {
    const dataDir = getDataDir();
    const rootMeta = await readRootMeta(dataDir);

    const project = rootMeta.projects.find((p) => p.id === slug);
    if (!project) {
      return failure(ERROR_CODES.PROJECT_NOT_FOUND, `Project "${slug}" not found`);
    }

    const target = rootMeta.projects.find((p) => p.id === targetSlug);
    if (!target) {
      return failure(ERROR_CODES.PROJECT_NOT_FOUND, `Project "${targetSlug}" not found`);
    }

    if (project.dependsOn.includes(targetSlug)) {
      return success({ message: `Dependency "${slug}" → "${targetSlug}" already exists.`, slug, target: targetSlug, action: "add", noop: true });
    }

    if (wouldCreateCycle(rootMeta.projects, slug, targetSlug)) {
      return failure("cycle_detected", `Adding dependency "${slug}" → "${targetSlug}" would create a cycle`);
    }

    project.dependsOn.push(targetSlug);
    await writeRootMeta(dataDir, rootMeta);

    return success({ slug, target: targetSlug, action: "add", message: `Added dependency: "${slug}" → "${targetSlug}"` });
  } catch (err) {
    return failure("write_error", err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// dependency remove
// ---------------------------------------------------------------------------

defineCommand({
  path: "dependency remove",
  description: "Remove a dependency between two projects",
  gated: true,
  mutation: true,
  gateName: "dependency-remove",
  params: {
    slug: { type: "string", required: true, positional: 0, description: "Source project slug" },
    target: { type: "string", required: true, positional: 1, description: "Target project slug (dependency)" },
    token: { type: "string", description: "Write-gate token" },
  },
  handler: handleDependencyRemove,
});

async function handleDependencyRemove(params: Record<string, unknown>, flags: CommandFlags): Promise<CLIResult> {
  const slug = params.slug as string;
  const targetSlug = params.target as string;
  const token = params.token as string | undefined;

  if (flags.dryRun) {
    return success({ dryRun: true, wouldRemove: { slug, target: targetSlug } });
  }

  try {
    requireWriteGate(token, slug, "cli:manage_dependency");
  } catch (err) {
    if (err instanceof WriteGateError) {
      return failure(err.code, err.message, { hint: err.hint });
    }
    throw err;
  }

  try {
    const dataDir = getDataDir();
    const rootMeta = await readRootMeta(dataDir);

    const project = rootMeta.projects.find((p) => p.id === slug);
    if (!project) {
      return failure(ERROR_CODES.PROJECT_NOT_FOUND, `Project "${slug}" not found`);
    }

    const target = rootMeta.projects.find((p) => p.id === targetSlug);
    if (!target) {
      return failure(ERROR_CODES.PROJECT_NOT_FOUND, `Project "${targetSlug}" not found`);
    }

    const idx = project.dependsOn.indexOf(targetSlug);
    if (idx === -1) {
      return success({ message: `Dependency "${slug}" → "${targetSlug}" does not exist.`, slug, target: targetSlug, action: "remove", noop: true });
    }

    project.dependsOn.splice(idx, 1);
    await writeRootMeta(dataDir, rootMeta);

    return success({ slug, target: targetSlug, action: "remove", message: `Removed dependency: "${slug}" → "${targetSlug}"` });
  } catch (err) {
    return failure("write_error", err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// doc update — alias for "project update-doc"
// ---------------------------------------------------------------------------

import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getProjectDir } from "../../utils/paths.js";
import { PROJECT_DOC_FILES, type ProjectDocType } from "../../utils/project-documents.js";

defineCommand({
  path: "doc update",
  description: "Update a project document (alias for project update-doc)",
  gated: true,
  mutation: true,
  gateName: "doc-update",
  params: {
    slug: { type: "string", required: true, positional: 0, description: "Project slug" },
    doc: { type: "string", required: true, positional: 1, description: "Document type", enum: ["overview", "tasks", "dependencies", "knowledge"] },
    "body-file": { type: "string", description: "Path to file with new doc content" },
    token: { type: "string", description: "Write-gate token" },
  },
  handler: handleDocUpdate,
});

async function handleDocUpdate(params: Record<string, unknown>, flags: CommandFlags): Promise<CLIResult> {
  const slug = params.slug as string;
  const doc = params.doc as ProjectDocType;
  const bodyFile = params["body-file"] as string | undefined;
  const token = params.token as string | undefined;

  const validDocs = Object.keys(PROJECT_DOC_FILES);
  if (!validDocs.includes(doc)) {
    return failure(ERROR_CODES.INVALID_ENUM, `Invalid doc type "${doc}". Valid: ${validDocs.join(", ")}`);
  }

  const projectDir = getProjectDir(slug);
  if (!existsSync(projectDir)) {
    return failure(ERROR_CODES.PROJECT_NOT_FOUND, `Project "${slug}" not found`);
  }

  if (!bodyFile) {
    return failure(ERROR_CODES.MISSING_PARAM, "--body-file=<path> is required", { param: "body-file" });
  }

  if (flags.dryRun) {
    return success({ dryRun: true, wouldUpdate: { slug, doc, bodyFile } });
  }

  try {
    requireWriteGate(token, slug, "cli:doc_update");
  } catch (err) {
    if (err instanceof WriteGateError) {
      return failure(err.code, err.message, { hint: err.hint });
    }
    throw err;
  }

  if (!existsSync(bodyFile)) {
    return failure(ERROR_CODES.ENTITY_NOT_FOUND, `Body file not found: ${bodyFile}`);
  }

  const content = readFileSync(bodyFile, "utf-8");
  const fileName = PROJECT_DOC_FILES[doc];
  const filePath = resolve(projectDir, fileName);

  try {
    await writeFile(filePath, content, "utf-8");
    return success({ updated: true, slug, doc, path: filePath });
  } catch (err) {
    return failure("write_error", err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// paths update — alias for "project update-paths" with full legacy API
// ---------------------------------------------------------------------------

import { normalizeWorkspacePath } from "../../utils/workspace-match.js";
import { validateJson } from "../../utils/json.js";
import { projectMetaSchema } from "../../utils/json-schemas.js";

defineCommand({
  path: "paths update",
  description: "Update workspace paths for a project",
  gated: true,
  mutation: true,
  gateName: "paths-update",
  params: {
    slug: { type: "string", required: true, positional: 0, description: "Project slug" },
    action: { type: "string", required: true, description: "Action to perform", enum: ["add", "remove", "set"] },
    paths: { type: "string", required: true, description: "Comma-separated list of absolute paths" },
    token: { type: "string", description: "Write-gate token" },
  },
  handler: handlePathsUpdate,
});

async function handlePathsUpdate(params: Record<string, unknown>, flags: CommandFlags): Promise<CLIResult> {
  const slug = params.slug as string;
  const action = params.action as "add" | "remove" | "set";
  const pathsRaw = params.paths as string;
  const token = params.token as string | undefined;

  const paths = pathsRaw.split(",").map((p) => p.trim());

  // Validate all paths are absolute
  for (const p of paths) {
    if (!p.startsWith("/")) {
      return failure(ERROR_CODES.INVALID_TYPE, `Path must be absolute, got "${p}"`);
    }
  }

  if (flags.dryRun) {
    return success({ dryRun: true, wouldUpdate: { slug, action, paths } });
  }

  try {
    requireWriteGate(token, slug, "cli:update_paths");
  } catch (err) {
    if (err instanceof WriteGateError) {
      return failure(err.code, err.message, { hint: err.hint });
    }
    throw err;
  }

  const projectDir = getProjectDir(slug);
  const metaPath = resolve(projectDir, "meta.json");

  if (!existsSync(metaPath)) {
    return failure(ERROR_CODES.PROJECT_NOT_FOUND, `Project "${slug}" not found`);
  }

  try {
    const raw = JSON.parse(readFileSync(metaPath, "utf-8"));
    const meta = validateJson(raw, projectMetaSchema, metaPath);
    const current: string[] = Array.isArray(meta.workspacePaths) ? meta.workspacePaths : [];
    const normalized = paths.map(normalizeWorkspacePath);

    let updated: string[];

    switch (action) {
      case "add": {
        const existing = new Set(current);
        updated = [...current, ...normalized.filter((p) => !existing.has(p))];
        break;
      }
      case "remove": {
        const toRemove = new Set(normalized);
        updated = current.filter((p) => !toRemove.has(normalizeWorkspacePath(p)));
        break;
      }
      case "set": {
        updated = [...new Set(normalized)];
        break;
      }
    }

    meta.workspacePaths = updated;
    await writeFile(metaPath, JSON.stringify(meta, null, 2), "utf-8");

    return success({ updated: true, slug, action, paths: updated });
  } catch (err) {
    return failure("write_error", err instanceof Error ? err.message : String(err));
  }
}
