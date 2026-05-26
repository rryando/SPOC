// ---------------------------------------------------------------------------
// Lean Output — strips noise from JSON output for LLM token savings
// ---------------------------------------------------------------------------

const STRIP_FIELDS = new Set(["createdAt", "updatedAt"]);

/**
 * Recursively strips noise from an object for leaner JSON output.
 * Removes: null/undefined values, empty arrays/objects/strings,
 * timestamp fields, and redundant normalizedId.
 */
export function leanify(obj: unknown): unknown {
  if (obj === null || obj === undefined) return undefined;

  if (Array.isArray(obj)) {
    const cleaned = obj.map((item) => leanify(item)).filter((item) => item !== undefined);
    return cleaned.length === 0 ? undefined : cleaned;
  }

  if (typeof obj === "object") {
    const input = obj as Record<string, unknown>;
    const hasId = "id" in input;
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(input)) {
      // Strip known noisy fields
      if (STRIP_FIELDS.has(key)) continue;
      // Strip normalizedId when id is present
      if (key === "normalizedId" && hasId) continue;

      const cleaned = leanify(value);
      if (cleaned === undefined) continue;

      // Skip empty strings
      if (cleaned === "") continue;
      // Skip empty arrays (already handled by recursive leanify returning undefined)
      // Skip empty objects
      if (
        typeof cleaned === "object" &&
        !Array.isArray(cleaned) &&
        Object.keys(cleaned as object).length === 0
      )
        continue;

      result[key] = cleaned;
    }

    return Object.keys(result).length === 0 ? undefined : result;
  }

  // Primitives (number, boolean, non-empty string)
  if (typeof obj === "string" && obj === "") return undefined;
  return obj;
}

/**
 * Check if lean mode is active from args or environment.
 */
export function isLeanMode(args: string[]): boolean {
  if (args.includes("--lean")) return true;
  if (process.env.SPOC_LEAN === "1") return true;
  return false;
}

/**
 * Format JSON output, applying leanify when lean mode is active.
 */
export function formatJsonOutput(data: unknown, lean: boolean): string {
  const output = lean ? leanify(data) : data;
  return JSON.stringify(output);
}
