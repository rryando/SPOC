import { readFileSync, writeFileSync, accessSync, constants } from "node:fs";
import { resolve } from "node:path";
import { getDataDir, ensureDataDir } from "../utils/paths.js";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export interface AgentConfig {
  enabled: boolean;
}

export interface CcDagConfig {
  version: "1";
  ides: string[];
  agents: {
    "init-project": AgentConfig;
    brainstorm: AgentConfig;
    execute: AgentConfig;
    "sync-knowledge": AgentConfig;
  };
}

export type AgentId = keyof CcDagConfig["agents"];

export const AGENT_IDS: AgentId[] = [
  "init-project",
  "brainstorm",
  "execute",
  "sync-knowledge",
];

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export function defaultConfig(): CcDagConfig {
  return {
    version: "1",
    ides: [],
    agents: {
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
 * Returns true if ~/.cc-dag/config.json exists.
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
export function readConfig(): CcDagConfig {
  try {
    const raw = readFileSync(configPath(), "utf-8");
    return JSON.parse(raw) as CcDagConfig;
  } catch {
    return defaultConfig();
  }
}

/**
 * Writes config to disk. Ensures data dir exists first.
 */
export function writeConfig(config: CcDagConfig): void {
  ensureDataDir();
  writeFileSync(configPath(), JSON.stringify(config, null, 2) + "\n", "utf-8");
}
