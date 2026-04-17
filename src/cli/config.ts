import { accessSync, constants, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ensureDataDir, getDataDir } from "../utils/paths.js";
import { readJsonSafeSync } from "../utils/json.js";
import { cliConfigSchema } from "../utils/json-schemas.js";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export interface SpocConfig {
  version: "1";
  ides: string[];
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export function defaultConfig(): SpocConfig {
  return {
    version: "1",
    ides: [],
  };
}

// ---------------------------------------------------------------------------
// Read / Write
// ---------------------------------------------------------------------------

function configPath(): string {
  return resolve(getDataDir(), "config.json");
}

/**
 * Returns true if ~/.spoc/config.json exists.
 */
export function configExists(): boolean {
  try {
    accessSync(configPath(), constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads config from disk. Returns default config if file missing.
 */
export function readConfig(): SpocConfig {
  const raw = readJsonSafeSync<unknown>(configPath());
  if (raw === undefined) return defaultConfig();
  const result = cliConfigSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    console.error(`Invalid config at ${configPath()}:\n${issues}`);
    process.exit(1);
  }
  return result.data;
}

/**
 * Writes config to disk. Ensures data dir exists first.
 */
export function writeConfig(config: SpocConfig): void {
  ensureDataDir();
  writeFileSync(configPath(), `${JSON.stringify(config, null, 2)}\n`, "utf-8");
}
