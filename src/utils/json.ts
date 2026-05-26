import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { ZodType } from "zod";

/**
 * Async: read & parse a JSON file. Returns undefined on missing/parse-error.
 */
export async function readJsonSafe<T>(filePath: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(filePath, "utf-8")) as T;
  } catch {
    return undefined;
  }
}

/**
 * Sync: read & parse a JSON file. Returns undefined on missing/parse-error.
 */
export function readJsonSafeSync<T>(filePath: string): T | undefined {
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as T;
  } catch {
    return undefined;
  }
}

/**
 * Validate a parsed value against a Zod schema.
 * Returns the typed value on success; throws with file path context on failure.
 */
export function validateJson<T>(data: unknown, schema: ZodType<T>, filePath: string): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid JSON in ${filePath}:\n${issues}`);
  }
  return result.data;
}
