// ---------------------------------------------------------------------------
// Output Envelope — structured JSON output for all CLI commands
// ---------------------------------------------------------------------------

import type { CLIResult } from "./command-registry.js";
import { leanify } from "./lean-output.js";

export { ERROR_CODES } from "./command-registry.js";

export function success(data: unknown): CLIResult {
  return { ok: true, data };
}

export function failure(
  code: string,
  message: string,
  opts?: { hint?: string; usage?: string; param?: string },
): CLIResult {
  return { ok: false, code, message, ...opts };
}

export function render(result: CLIResult, flags: { json: boolean; lean: boolean }): void {
  if (flags.json) {
    const output =
      flags.lean && result.ok ? { ...result, data: leanify(result.data) } : result;
    if (result.ok) {
      console.log(JSON.stringify(output));
    } else {
      console.error(JSON.stringify(result));
    }
  } else {
    if (result.ok) {
      console.log(formatHuman(result.data));
    } else {
      console.error(formatError(result));
    }
  }
}

export function formatHuman(data: unknown): string {
  if (data === null || data === undefined) return "";
  if (typeof data === "string") return data;
  return JSON.stringify(data, null, 2);
}

export function stripTimestamps(data: unknown): unknown {
  if (data === null || data === undefined || typeof data !== "object") return data;
  if (Array.isArray(data)) return data.map(stripTimestamps);
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (key === "createdAt" || key === "updatedAt") continue;
    result[key] = stripTimestamps(value);
  }
  return result;
}

function formatError(result: CLIResult & { ok: false }): string {
  const lines = [`Error: ${result.message}`];
  if (result.hint) lines.push(`Hint: ${result.hint}`);
  if (result.usage) lines.push(`Usage: ${result.usage}`);
  return lines.join("\n");
}
