/**
 * Loop state management for SPOC projects.
 *
 * Stores active loop state as loop-state.json in each project directory.
 * Used by CLI commands (start/cancel/get) and the OpenCode plugin hook
 * (which reads state directly from disk to drive iteration).
 */

import { constants } from "node:fs";
import { access, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DagError } from "./errors.js";
import { getDataDir } from "./paths.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LoopState {
  active: boolean;
  iteration: number;
  maxIterations: number;
  completionPromise: string;
  startedAt: string;
  prompt: string;
  sessionId: string;
  strategy: "continue" | "reset";
  projectSlug: string;
  messageCountAtStart?: number;
}

export interface StartLoopInput {
  sessionId: string;
  prompt: string;
  maxIterations?: number;
  completionPromise?: string;
  strategy?: "continue" | "reset";
  projectSlug: string;
  messageCountAtStart?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const LOOP_STATE_FILE = "loop-state.json";
export const DEFAULT_MAX_ITERATIONS = 100;
export const DEFAULT_COMPLETION_PROMISE = "DONE";
export const COMPLETION_TAG_PATTERN = /<promise>(.*?)<\/promise>/is;

// ---------------------------------------------------------------------------
// Filesystem helpers
// ---------------------------------------------------------------------------

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readJsonSafe<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf-8")) as T;
  } catch {
    return null;
  }
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Read loop-state.json from a project directory. Returns null if missing or corrupt. */
export async function readLoopState(projectDir: string): Promise<LoopState | null> {
  const filePath = join(projectDir, LOOP_STATE_FILE);
  return readJsonSafe<LoopState>(filePath);
}

/** Write loop-state.json to a project directory. */
export async function writeLoopState(projectDir: string, state: LoopState): Promise<void> {
  const filePath = join(projectDir, LOOP_STATE_FILE);
  await writeJson(filePath, state);
}

/** Delete loop-state.json from a project directory. Returns true if the file was removed. */
export async function clearLoopState(projectDir: string): Promise<boolean> {
  const filePath = join(projectDir, LOOP_STATE_FILE);
  if (!(await fileExists(filePath))) {
    return false;
  }
  await unlink(filePath);
  return true;
}

/** Read loop state, bump iteration count, write back, and return the updated state. */
export async function incrementLoopIteration(projectDir: string): Promise<LoopState | null> {
  const state = await readLoopState(projectDir);
  if (!state) {
    return null;
  }
  state.iteration += 1;
  await writeLoopState(projectDir, state);
  return state;
}

/** Create initial loop state for a project. Throws if a loop is already active. */
export async function startLoop(projectDir: string, input: StartLoopInput): Promise<LoopState> {
  const existing = await readLoopState(projectDir);
  if (existing?.active) {
    throw new DagError(
      "LOOP_ALREADY_ACTIVE",
      `A loop is already active for project "${input.projectSlug}" (session ${existing.sessionId}).`,
    );
  }

  const state: LoopState = {
    active: true,
    iteration: 0,
    maxIterations: input.maxIterations ?? DEFAULT_MAX_ITERATIONS,
    completionPromise: input.completionPromise ?? DEFAULT_COMPLETION_PROMISE,
    startedAt: new Date().toISOString(),
    prompt: input.prompt,
    sessionId: input.sessionId,
    strategy: input.strategy ?? "continue",
    projectSlug: input.projectSlug,
    ...(input.messageCountAtStart !== undefined && {
      messageCountAtStart: input.messageCountAtStart,
    }),
  };

  await writeLoopState(projectDir, state);
  return state;
}

/** Cancel an active loop if the session ID matches. Returns true if cleared. */
export async function cancelLoop(projectDir: string, sessionId: string): Promise<boolean> {
  const state = await readLoopState(projectDir);
  if (!state || !state.active || state.sessionId !== sessionId) {
    return false;
  }
  return clearLoopState(projectDir);
}

/** Scan all projects for an active loop-state.json. Returns the first match or null. */
export async function findActiveLoop(): Promise<{
  slug: string;
  projectDir: string;
  state: LoopState;
} | null> {
  const dataDir = getDataDir();
  const metaPath = join(dataDir, "meta.json");

  const rootMeta = await readJsonSafe<{ projects: Array<{ id: string }> }>(metaPath);
  if (!rootMeta?.projects) {
    return null;
  }

  for (const node of rootMeta.projects) {
    const projectDir = join(dataDir, "projects", node.id);
    const state = await readLoopState(projectDir);
    if (state?.active) {
      return { slug: node.id, projectDir, state };
    }
  }

  return null;
}
