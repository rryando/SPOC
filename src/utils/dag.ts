import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { withLock } from "./file-lock.js";
import { readJsonSafe, validateJson } from "./json.js";
import { rootMetaSchema } from "./json-schemas.js";
import { invalidFileFormat } from "./errors.js";

export interface DagNode {
  id: string;
  name: string;
  status: string;
  dependsOn: string[];
}

export interface RootMeta {
  version: string;
  projects: DagNode[];
}

/**
 * Reads and parses the root meta.json.
 */
export async function readRootMeta(dataDir: string): Promise<RootMeta> {
  const metaPath = resolve(dataDir, "meta.json");
  const raw = await readJsonSafe<unknown>(metaPath);
  if (raw === undefined) {
    throw invalidFileFormat(metaPath, "file missing or not valid JSON");
  }
  try {
    return validateJson(raw, rootMetaSchema, metaPath);
  } catch (err) {
    throw invalidFileFormat(metaPath, err instanceof Error ? err.message : String(err));
  }
}

/**
 * Detect if adding an edge (from → to) would create a cycle.
 * Uses DFS from `to` to see if we can reach `from`.
 */
export function wouldCreateCycle(projects: DagNode[], fromId: string, toId: string): boolean {
  const adjacency = new Map<string, string[]>();
  for (const p of projects) {
    adjacency.set(p.id, [...p.dependsOn]);
  }

  // Simulate adding the edge: fromId depends on toId
  const existing = adjacency.get(fromId) ?? [];
  adjacency.set(fromId, [...existing, toId]);

  // DFS from fromId following dependsOn — if we reach fromId again, cycle exists
  const visited = new Set<string>();
  const stack = [toId];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === fromId) return true;
    if (visited.has(current)) continue;
    visited.add(current);

    const deps = adjacency.get(current) ?? [];
    for (const dep of deps) {
      stack.push(dep);
    }
  }

  return false;
}

/**
 * Writes root meta.json under an advisory file lock.
 */
export async function writeRootMeta(dataDir: string, rootMeta: RootMeta): Promise<void> {
  const metaPath = resolve(dataDir, "meta.json");
  await withLock(metaPath, async () => {
    await writeFile(metaPath, JSON.stringify(rootMeta, null, 2), "utf-8");
  });
}

/**
 * Validate that all dependency targets exist in the project list.
 */
export function validateDependencies(projects: DagNode[], dependsOn: string[]): string[] {
  const knownIds = new Set(projects.map((p) => p.id));
  return dependsOn.filter((id) => !knownIds.has(id));
}
