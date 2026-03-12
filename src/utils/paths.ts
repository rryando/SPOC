import { mkdirSync, accessSync, writeFileSync, constants } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

/**
 * Root of the installed package (read-only assets: templates/, skills/).
 * Resolves from the compiled JS location: dist/utils/paths.js -> ../../
 */
const __filename = fileURLToPath(import.meta.url);
export const PACKAGE_ROOT = resolve(dirname(__filename), "../..");

const DEFAULT_DATA_DIR_NAME = ".cc-dag";

/**
 * Returns the data directory path.
 * Priority: CC_DAG_DATA_DIR env var > ~/.cc-dag
 */
export function getDataDir(): string {
  const envDir = process.env["CC_DAG_DATA_DIR"];
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
    const source = process.env["CC_DAG_DATA_DIR"]
      ? `CC_DAG_DATA_DIR="${process.env["CC_DAG_DATA_DIR"]}"`
      : `~/${DEFAULT_DATA_DIR_NAME}`;
    throw new Error(
      `Data directory "${dir}" is not writable.\n` +
        `Source: ${source}\n` +
        `Fix: check permissions, or set CC_DAG_DATA_DIR to a writable path.`
    );
  }
}

const SEED_META = JSON.stringify({ version: "1.0", projects: [] }, null, 2);

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
