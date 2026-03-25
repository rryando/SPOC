import { accessSync, constants, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ensureDataDir, getDataDir } from "../utils/paths.js";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export interface AgentConfig {
  enabled: boolean;
}

export interface SpocConfig {
  version: "1";
  ides: string[];
  agents: {
    orchestrate: AgentConfig;
    "init-project": AgentConfig;
    brainstorm: AgentConfig;
    execute: AgentConfig;
    "sync-knowledge": AgentConfig;
  };
}

export type AgentId = keyof SpocConfig["agents"];

export const AGENT_IDS: AgentId[] = [
  "orchestrate",
  "init-project",
  "brainstorm",
  "execute",
  "sync-knowledge",
];

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export function defaultConfig(): SpocConfig {
  return {
    version: "1",
    ides: [],
    agents: {
      orchestrate: { enabled: true },
      "init-project": { enabled: true },
      brainstorm: { enabled: true },
      execute: { enabled: true },
      "sync-knowledge": { enabled: true },
    },
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
  try {
    const raw = readFileSync(configPath(), "utf-8");
    return JSON.parse(raw) as SpocConfig;
  } catch {
    return defaultConfig();
  }
}

/**
 * Writes config to disk. Ensures data dir exists first.
 */
export function writeConfig(config: SpocConfig): void {
  ensureDataDir();
  writeFileSync(configPath(), `${JSON.stringify(config, null, 2)}\n`, "utf-8");
}
