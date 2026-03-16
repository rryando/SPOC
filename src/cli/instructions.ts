import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { homedir } from "node:os";
import color from "picocolors";
import { ORCHESTRATE_PROMPT_TEXT } from "../prompts/cc-dag-orchestrate.js";

// ---------------------------------------------------------------------------
// IDE MCP Configuration — Definitions + Auto-Write
// ---------------------------------------------------------------------------

export type IdeId = "vscode" | "copilot-cli" | "claude-code" | "opencode";

interface IdeInfo {
  label: string;
  hint: string;
  /** Human-readable path shown in confirmation prompt. */
  configPath: () => string;
  /** Read existing config, merge cc-dag entry, return new content. */
  merge: () => string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Safely parse a JSON file. Returns empty object on any error. */
function readJsonFile(path: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Write JSON content to disk, creating parent dirs as needed. */
function writeJsonFile(path: string, data: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

/**
 * Deep-set a nested key path on an object (mutates in place).
 * E.g. deepSet(obj, ["mcp", "servers", "cc-dag"], value)
 */
function deepSet(
  obj: Record<string, unknown>,
  keys: string[],
  value: unknown,
): void {
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (
      typeof current[k] !== "object" ||
      current[k] === null ||
      Array.isArray(current[k])
    ) {
      current[k] = {};
    }
    current = current[k] as Record<string, unknown>;
  }
  current[keys[keys.length - 1]] = value;
}

// ---------------------------------------------------------------------------
// MCP server entry per IDE
// ---------------------------------------------------------------------------

const CC_DAG_STDIO_ENTRY = {
  command: "npx",
  args: ["-y", "cc-dag"],
};

const CC_DAG_OPENCODE_ENTRY = {
  type: "local" as const,
  command: ["npx", "-y", "cc-dag"],
  enabled: true,
};

// ---------------------------------------------------------------------------
// IDE Map
// ---------------------------------------------------------------------------

const IDE_MAP: Record<IdeId, IdeInfo> = {
  // ── OpenCode ─────────────────────────────────────────────────────────────
  opencode: {
    label: "OpenCode",
    hint: "OhMyOpenCode editor",
    configPath: () => resolve(homedir(), ".config", "opencode", "opencode.json"),
    merge() {
      const p = this.configPath();
      const existing = readJsonFile(p);
      deepSet(existing, ["mcp", "cc-dag"], CC_DAG_OPENCODE_ENTRY);
      return JSON.stringify(existing, null, 2) + "\n";
    },
  },

  // ── VS Code ──────────────────────────────────────────────────────────────
  vscode: {
    label: "VS Code (Copilot)",
    hint: "GitHub Copilot MCP in VS Code",
    configPath: () => resolve(homedir(), ".vscode", "mcp.json"),
    merge() {
      const p = this.configPath();
      const existing = readJsonFile(p);
      deepSet(existing, ["servers", "cc-dag"], CC_DAG_STDIO_ENTRY);
      return JSON.stringify(existing, null, 2) + "\n";
    },
  },

  // ── Copilot CLI ──────────────────────────────────────────────────────────
  "copilot-cli": {
    label: "GitHub Copilot CLI",
    hint: "gh copilot with MCP support",
    configPath: () =>
      resolve(homedir(), ".config", "github-copilot", "mcp.json"),
    merge() {
      const p = this.configPath();
      const existing = readJsonFile(p);
      deepSet(existing, ["mcpServers", "cc-dag"], CC_DAG_STDIO_ENTRY);
      return JSON.stringify(existing, null, 2) + "\n";
    },
  },

  // ── Claude Code ──────────────────────────────────────────────────────────
  "claude-code": {
    label: "Claude Code",
    hint: "Anthropic Claude Code CLI",
    configPath: () => resolve(homedir(), ".claude", "claude_desktop_config.json"),
    merge() {
      const p = this.configPath();
      const existing = readJsonFile(p);
      deepSet(existing, ["mcpServers", "cc-dag"], CC_DAG_STDIO_ENTRY);
      return JSON.stringify(existing, null, 2) + "\n";
    },
  },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const IDE_IDS: IdeId[] = ["vscode", "copilot-cli", "claude-code", "opencode"];

/** Returns the multiselect option for a given IDE id. */
export function ideOption(id: IdeId): { value: IdeId; label: string; hint: string } {
  const info = IDE_MAP[id];
  return { value: id, label: info.label, hint: info.hint };
}

/** Returns the human-readable config file path for an IDE. */
export function ideConfigPath(id: IdeId): string {
  return IDE_MAP[id].configPath();
}

/** Returns true if the IDE config file already exists on disk. */
export function ideConfigExists(id: IdeId): boolean {
  return existsSync(IDE_MAP[id].configPath());
}

/**
 * Checks whether the cc-dag MCP entry already exists in the IDE config.
 * Uses key-path inspection rather than raw string search to avoid false
 * positives (e.g. agent.cc-dag being mistaken for mcp.cc-dag in OpenCode).
 */
export function ideHasCcDag(id: IdeId): boolean {
  const p = IDE_MAP[id].configPath();
  if (!existsSync(p)) return false;
  try {
    const config = readJsonFile(p);
    switch (id) {
      case "opencode": {
        // MCP entry lives at config.mcp["cc-dag"]
        const mcp = config.mcp as Record<string, unknown> | undefined;
        return mcp != null && "cc-dag" in mcp;
      }
      case "vscode": {
        // Entry lives at config.servers["cc-dag"]
        const servers = config.servers as Record<string, unknown> | undefined;
        return servers != null && "cc-dag" in servers;
      }
      case "copilot-cli":
      case "claude-code": {
        // Entry lives at config.mcpServers["cc-dag"]
        const mcpServers = config.mcpServers as Record<string, unknown> | undefined;
        return mcpServers != null && "cc-dag" in mcpServers;
      }
    }
  } catch {
    return false;
  }
}

export interface WriteResult {
  id: IdeId;
  path: string;
  action: "created" | "updated" | "skipped";
  alreadyConfigured: boolean;
}

/**
 * Writes (or merges) the cc-dag MCP server entry into the IDE's config file.
 * Returns a WriteResult describing what happened.
 */
export function writeIdeConfig(id: IdeId): WriteResult {
  const info = IDE_MAP[id];
  const configFilePath = info.configPath();
  const alreadyConfigured = ideHasCcDag(id);
  const existed = existsSync(configFilePath);

  const merged = info.merge();
  writeJsonFile(configFilePath, JSON.parse(merged));

  return {
    id,
    path: configFilePath,
    action: existed ? "updated" : "created",
    alreadyConfigured,
  };
}

/**
 * Formats a short summary of an IDE config path for display.
 * Replaces $HOME with ~ for readability.
 */
export function displayPath(p: string): string {
  const home = homedir();
  return p.startsWith(home) ? "~" + p.slice(home.length) : p;
}

// ---------------------------------------------------------------------------
// OpenCode Agent Registration
// ---------------------------------------------------------------------------

/** Path to the OpenCode config directory. */
function opencodeConfigDir(): string {
  return resolve(homedir(), ".config", "opencode");
}

/** Path to the OpenCode prompts directory. */
function opencodePromptsDir(): string {
  return resolve(opencodeConfigDir(), "prompts");
}

/** Path to the cc-dag orchestrator prompt file. */
function opencodePromptPath(): string {
  return resolve(opencodePromptsDir(), "cc-dag-orchestrate.txt");
}

/**
 * The OpenCode agent entry for cc-dag orchestrator.
 */
const CC_DAG_AGENT_ENTRY = {
  description:
    "CC-DAG project orchestrator — classifies intent and routes across init, brainstorm, execute, sync, and explore workflows",
  mode: "primary" as const,
  prompt: "{file:./prompts/cc-dag-orchestrate.txt}",
  color: "#00bcd4",
};

/**
 * Checks whether the cc-dag agent is already registered in opencode.json.
 */
export function opencodeHasAgent(): boolean {
  const configFile = resolve(opencodeConfigDir(), "opencode.json");
  if (!existsSync(configFile)) return false;
  try {
    const raw = readFileSync(configFile, "utf-8");
    const config = JSON.parse(raw) as Record<string, unknown>;
    const agents = config.agent as Record<string, unknown> | undefined;
    return agents != null && "cc-dag" in agents;
  } catch {
    return false;
  }
}

export interface AgentWriteResult {
  configPath: string;
  promptPath: string;
  action: "created" | "updated";
  alreadyConfigured: boolean;
}

/**
 * Registers the cc-dag orchestrator as a primary agent in opencode.json.
 * Also writes the prompt text file to ~/.config/opencode/prompts/.
 */
export function writeOpencodeAgent(): AgentWriteResult {
  const alreadyConfigured = opencodeHasAgent();
  const configFile = resolve(opencodeConfigDir(), "opencode.json");
  const promptFile = opencodePromptPath();
  const existed = existsSync(configFile);

  // Write the prompt text file
  mkdirSync(opencodePromptsDir(), { recursive: true });
  writeFileSync(promptFile, ORCHESTRATE_PROMPT_TEXT + "\n", "utf-8");

  // Merge agent entry into opencode.json
  const existing = readJsonFile(configFile);
  deepSet(existing, ["agent", "cc-dag"], CC_DAG_AGENT_ENTRY);
  writeJsonFile(configFile, existing);

  return {
    configPath: configFile,
    promptPath: promptFile,
    action: existed ? "updated" : "created",
    alreadyConfigured,
  };
}
