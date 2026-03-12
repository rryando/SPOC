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

/**
 * Format a DagError into an MCP tool error response.
 */
export function formatError(err: DagError): { content: Array<{ type: "text"; text: string }>; isError: true } {
  return {
    content: [{ type: "text" as const, text: `[${err.code}] ${err.message}` }],
    isError: true,
  };
}
