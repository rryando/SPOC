import { accessSync, constants, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Root of the installed package (read-only assets: templates/, skills/).
 * Resolves from the compiled JS location: dist/utils/paths.js -> ../../
 */
const __filename = fileURLToPath(import.meta.url);
export const PACKAGE_ROOT = resolve(dirname(__filename), "../..");

const DEFAULT_DATA_DIR_NAME = ".spoc";

/**
 * Returns the data directory path.
 * Priority: SPOC_DATA_DIR env var > ~/.spoc
 */
export function getDataDir(): string {
  const envDir = process.env.SPOC_DATA_DIR;
  if (envDir) {
    return resolve(envDir);
  }
  return resolve(homedir(), DEFAULT_DATA_DIR_NAME);
}

/**
 * Checks if a directory is writable by attempting a test write.
 * Throws a descriptive error if not writable.
 */
function assertWritable(dir: string): void {
  try {
    accessSync(dir, constants.W_OK);
  } catch {
    const source = process.env.SPOC_DATA_DIR
      ? `SPOC_DATA_DIR="${process.env.SPOC_DATA_DIR}"`
      : `~/${DEFAULT_DATA_DIR_NAME}`;
    throw new Error(
      `Data directory "${dir}" is not writable.\n` +
        `Source: ${source}\n` +
        `Fix: check permissions, or set SPOC_DATA_DIR to a writable path.`,
    );
  }
}

const SEED_META = JSON.stringify({ version: "1.0", projects: [] }, null, 2);

/**
 * Returns the absolute path to a project's data directory.
 */
export function getProjectDir(slug: string): string {
  return resolve(getDataDir(), "projects", slug);
}

/**
 * Ensures the data directory exists, is writable, and contains a seed meta.json.
 * Call once at startup.
 */
export function ensureDataDir(): void {
  const dataDir = getDataDir();

  // Create dir (and parents) if missing
  mkdirSync(dataDir, { recursive: true });

  // Verify writable
  assertWritable(dataDir);

  // Seed meta.json if absent
  const metaPath = resolve(dataDir, "meta.json");
  try {
    accessSync(metaPath, constants.F_OK);
  } catch {
    writeFileSync(metaPath, SEED_META, "utf-8");
  }
}
