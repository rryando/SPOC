/**
 * Typed error helpers for consistent MCP tool error responses.
 */

export class DagError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "DagError";
  }
}

export function projectNotFound(slug: string): DagError {
  return new DagError(
    "PROJECT_NOT_FOUND",
    `Project "${slug}" does not exist.`
  );
}

export function projectAlreadyExists(slug: string): DagError {
  return new DagError(
    "PROJECT_ALREADY_EXISTS",
    `Project "${slug}" already exists.`
  );
}

export function invalidDocType(doc: string): DagError {
  return new DagError(
    "INVALID_DOC_TYPE",
    `Invalid document type "${doc}". Must be one of: overview, tasks, dependencies, knowledge.`
  );
}

export function cycleDetected(fromSlug: string, toSlug: string): DagError {
  return new DagError(
    "CYCLE_DETECTED",
    `Adding dependency "${fromSlug}" → "${toSlug}" would create a cycle.`
  );
}

export function dependencyNotFound(ids: string[]): DagError {
  return new DagError(
    "DEPENDENCY_NOT_FOUND",
    `Unknown dependency target(s): ${ids.join(", ")}`
  );
}

export function invalidPlanStatus(status: string): DagError {
  return new DagError(
    "INVALID_PLAN_STATUS",
    `Invalid plan status "${status}".`
  );
}

export function invalidKnowledgeKind(kind: string): DagError {
  return new DagError(
    "INVALID_KNOWLEDGE_KIND",
    `Invalid knowledge kind "${kind}".`
  );
}

export function invalidKeyword(keyword: string): DagError {
  return new DagError(
    "INVALID_KEYWORD",
    `Invalid keyword "${keyword}".`
  );
}

export function normalizedIdCollision(
  kind: "plan" | "knowledge entry",
  requestedId: string,
  normalizedId: string
): DagError {
  return new DagError(
    "NORMALIZED_ID_COLLISION",
    `Cannot create ${kind} "${requestedId}" because normalized id "${normalizedId}" already exists.`
  );
}

export function itemNotFound(
  kind: "plan" | "knowledge entry",
  id: string
): DagError {
  return new DagError(
    "ITEM_NOT_FOUND",
    `Could not find ${kind} "${id}".`
  );
}

export function indexRebuildFailed(
  kind: "plans" | "knowledge",
  reason: string
): DagError {
  return new DagError(
    "INDEX_REBUILD_FAILED",
    `Unable to rebuild ${kind} index: ${reason}`
  );
}

export function noProjectMatch(workspacePath: string): DagError {
  return new DagError(
    "NO_PROJECT_MATCH",
    `No project found matching workspace path "${workspacePath}". ` +
      `Register a workspace path using update_project_paths(slug, "add", [path]).`
  );
}

export function ambiguousProjectMatch(
  workspacePath: string,
  slugs: string[]
): DagError {
  return new DagError(
    "AMBIGUOUS_PROJECT_MATCH",
    `Multiple projects match workspace path "${workspacePath}" at the same depth: ${slugs.join(", ")}. ` +
      `Use more specific workspace paths or remove duplicates with update_project_paths.`
  );
}

export function invalidWorkspacePath(path: string): DagError {
  return new DagError(
    "INVALID_WORKSPACE_PATH",
    `Workspace path "${path}" is not absolute. Paths must start with "/".`
  );
}

export function noWorkspacePaths(slug: string): DagError {
  return new DagError(
    "NO_WORKSPACE_PATHS",
    `No workspace paths registered for project "${slug}". Use update_project_paths to add paths first.`
  );
}

/**
 * Format a DagError into an MCP tool error response.
 */
export function formatError(err: DagError): { content: Array<{ type: "text"; text: string }>; isError: true } {
  return {
    content: [{ type: "text" as const, text: `[${err.code}] ${err.message}` }],
    isError: true,
  };
}
