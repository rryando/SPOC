// ---------------------------------------------------------------------------
// project-resolver — Shared project resolution from path or slug
// ---------------------------------------------------------------------------

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { CLIResult } from "../cli/command-registry.js";
import { failure } from "../cli/output-envelope.js";
import { ERROR_CODES } from "../cli/command-registry.js";
import { type RootMeta, readRootMeta } from "./dag.js";
import { readJsonSafe, validateJson } from "./json.js";
import { projectMetaSchema } from "./json-schemas.js";
import { getDataDir, getProjectDir } from "./paths.js";
import { findBestMatch, type WorkspaceProject } from "./workspace-match.js";

// ---------------------------------------------------------------------------

export interface ResolvedProject {
  slug: string;
  name: string;
  description: string;
  projectDir: string;
}

type ResolveSuccess = { ok: true } & ResolvedProject;
type ResolveFailure = { ok: false; result: CLIResult };
export type ResolveResult = ResolveSuccess | ResolveFailure;

/**
 * Resolve a project from:
 * - undefined → uses cwd
 * - absolute path → workspace match
 * - slug (no `/` or `.`) → direct meta lookup then workspace match
 * - relative path → resolved then workspace match
 *
 * Returns `{ ok: true, slug, name, projectDir }` on success,
 * or `{ ok: false, result: CLIResult }` with a failure envelope.
 */
export async function resolveProject(pathOrSlug: string | undefined): Promise<ResolveResult> {
  let queryPath: string;

  if (!pathOrSlug) {
    queryPath = process.cwd();
  } else if (pathOrSlug.startsWith("/")) {
    queryPath = pathOrSlug;
  } else if (!pathOrSlug.includes("/") && !pathOrSlug.includes(".")) {
    // Slug resolution
    const dataDir = getDataDir();
    const projMetaPath = resolve(dataDir, "projects", pathOrSlug, "meta.json");
    if (!existsSync(projMetaPath)) {
      return {
        ok: false,
        result: failure(ERROR_CODES.PROJECT_NOT_FOUND, `Project "${pathOrSlug}" not found in SPOC`),
      };
    }
    try {
      const raw = await readFile(projMetaPath, "utf-8");
      const projMeta = JSON.parse(raw);
      const paths: string[] = Array.isArray(projMeta.workspacePaths) ? projMeta.workspacePaths : [];
      if (paths.length === 0) {
        return {
          ok: false,
          result: failure(
            "no_workspace_paths",
            `Project "${pathOrSlug}" has no workspace paths configured`,
          ),
        };
      }
      const first = paths[0];
      queryPath = first.startsWith("~") ? resolve(homedir(), first.slice(2)) : resolve(first);
    } catch {
      return {
        ok: false,
        result: failure("read_error", `Could not read project metadata for "${pathOrSlug}"`),
      };
    }
  } else {
    queryPath = resolve(pathOrSlug);
    if (!existsSync(queryPath)) {
      return {
        ok: false,
        result: failure("path_not_found", `Path "${pathOrSlug}" does not exist.`),
      };
    }
  }

  const dataDir = getDataDir();
  let rootMeta: RootMeta;
  try {
    rootMeta = await readRootMeta(dataDir);
  } catch {
    return { ok: false, result: failure("read_error", "Could not read SPOC data directory") };
  }

  type PM = { id: string; name: string; description?: string; workspacePaths: string[] };
  const workspaceProjects: WorkspaceProject[] = [];
  const projectMetas = new Map<string, PM>();

  for (const node of rootMeta.projects) {
    const metaPath = resolve(dataDir, "projects", node.id, "meta.json");
    if (!existsSync(metaPath)) continue;
    const raw = await readJsonSafe<unknown>(metaPath);
    if (raw === undefined) continue;
    const meta = validateJson(raw, projectMetaSchema, metaPath) as PM;
    const paths = Array.isArray(meta.workspacePaths) ? meta.workspacePaths : [];
    if (paths.length > 0) {
      workspaceProjects.push({ slug: node.id, workspacePaths: paths });
      projectMetas.set(node.id, meta);
    }
  }

  const matchResult = findBestMatch(queryPath, workspaceProjects);
  if (matchResult.kind === "none") {
    return {
      ok: false,
      result: failure("no_match", `No project found matching path "${queryPath}"`),
    };
  }
  if (matchResult.kind === "ambiguous") {
    return {
      ok: false,
      result: failure("ambiguous_match", `Ambiguous match for "${queryPath}"`),
    };
  }

  const slug = matchResult.slug;
  const meta = projectMetas.get(slug);
  return {
    ok: true,
    slug,
    name: meta?.name ?? slug,
    description: meta?.description ?? "",
    projectDir: getProjectDir(slug),
  };
}
