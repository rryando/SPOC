import { accessSync, constants, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { readJsonSafeSync } from "../utils/json.js";
import { cliConfigSchema } from "../utils/json-schemas.js";
import { ensureDataDir, getDataDir } from "../utils/paths.js";

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
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
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

// ---------------------------------------------------------------------------
// OpenCode Model Config
// ---------------------------------------------------------------------------

export type ModelTierConfig = {
  heavy: string;
  standard: string;
  light: string;
  perAgent?: Record<string, string>;
};

/**
 * Reads ~/.config/opencode/opencode.json. Returns parsed JSON or null on failure.
 */
export async function readOpenCodeConfig(): Promise<unknown | null> {
  try {
    const filePath = join(homedir(), ".config", "opencode", "opencode.json");
    const content = await readFile(filePath, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Extracts model tier pre-fills from parsed opencode config.
 */
export function extractModelPreFills(config: unknown): ModelTierConfig {
  if (config === null || config === undefined || typeof config !== "object") {
    return { heavy: "", standard: "", light: "" };
  }
  const obj = config as Record<string, unknown>;
  const model = typeof obj.model === "string" ? obj.model : "";
  const smallModel = typeof obj.small_model === "string" ? obj.small_model : "";
  return {
    heavy: model,
    standard: model,
    light: smallModel || model,
  };
}
