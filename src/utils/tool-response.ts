/**
 * Standard CLI tool response helpers.
 */

type ToolErrorResponse = { content: [{ type: "text"; text: string }]; isError: true };

export function jsonResult(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

/**
 * Build a code-tagged CLI command error response.
 *
 * Every error surfaced to the caller carries a stable `[CODE]` prefix so
 * clients can programmatically distinguish error classes.
 *
 * @param code  Stable upper-case error code (e.g. `"NOT_FOUND"`, `"INVALID_INPUT"`).
 * @param message  Human-readable description.
 * @param cause  Optional underlying error — appended as `" — <detail>"` when present.
 */
export function toolError(code: string, message: string, cause?: unknown): ToolErrorResponse {
  let text = `[${code}] ${message}`;
  if (cause !== undefined && cause !== null) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    if (detail && detail !== message) {
      text += ` — ${detail}`;
    }
  }
  return { content: [{ type: "text" as const, text }], isError: true as const };
}

/**
 * Fallback error helper for truly unknown exceptions caught at the top-level.
 *
 * Prefer `toolError(code, ...)` for known error conditions, or
 * `formatError(DagError)` for typed DAG errors. Use `errorResult` only
 * in generic `catch (err)` blocks where the error type is not known.
 */
export function errorResult(err: unknown): ToolErrorResponse {
  return toolError("INTERNAL_ERROR", err instanceof Error ? err.message : String(err));
}
