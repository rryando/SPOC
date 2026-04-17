import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ORCHESTRATE_PROMPT_TEXT } from "../prompts/spoc-orchestrate.js";
import { readJsonSafeSync } from "../utils/json.js";

// ---------------------------------------------------------------------------
// IDE MCP Configuration — Definitions + Auto-Write
// ---------------------------------------------------------------------------

export type IdeId = "vscode" | "copilot-cli" | "claude-code" | "opencode";

interface IdeInfo {
  label: string;
  hint: string;
  /** Human-readable path shown in confirmation prompt. */
  configPath: () => string;
  /** Read existing config, merge SPOC entry, return new content. */
  merge: () => string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Safely parse a JSON file. Returns empty object on any error. */
function readJsonFile(path: string): Record<string, unknown> {
  return readJsonSafeSync<Record<string, unknown>>(path) ?? {};
}

/** Write JSON content to disk, creating parent dirs as needed. */
function writeJsonFile(path: string, data: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
}

/**
 * Deep-set a nested key path on an object (mutates in place).
 * E.g. deepSet(obj, ["mcp", "servers", "spoc"], value)
 */
function deepSet(obj: Record<string, unknown>, keys: string[], value: unknown): void {
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (typeof current[k] !== "object" || current[k] === null || Array.isArray(current[k])) {
      current[k] = {};
    }
    current = current[k] as Record<string, unknown>;
  }
  current[keys[keys.length - 1]] = value;
}

// ---------------------------------------------------------------------------
// MCP server entry per IDE
// ---------------------------------------------------------------------------

/**
 * Resolves the absolute path to the SPOC entry point (dist/index.js).
 * Used so that MCP registrations always point at the local install
 * rather than relying on `npx -y spoc` (the npm name is taken by an
 * unrelated package).
 */
function getEntryPath(): string {
  // import.meta.url → file:///…/dist/cli/instructions.js
  // Walk up two levels (cli/ → dist/) to reach dist/index.js
  const thisFile = fileURLToPath(import.meta.url);
  return resolve(dirname(thisFile), "..", "index.js");
}

function makeStdioEntry() {
  const entry = getEntryPath();
  return { command: "node", args: [entry] };
}

function makeOpencodeEntry() {
  const entry = getEntryPath();
  return { type: "local" as const, command: ["node", entry], enabled: true };
}

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
      deepSet(existing, ["mcp", "spoc"], makeOpencodeEntry());
      return `${JSON.stringify(existing, null, 2)}\n`;
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
      deepSet(existing, ["servers", "spoc"], makeStdioEntry());
      return `${JSON.stringify(existing, null, 2)}\n`;
    },
  },

  // ── Copilot CLI ──────────────────────────────────────────────────────────
  "copilot-cli": {
    label: "GitHub Copilot CLI",
    hint: "gh copilot with MCP support",
    configPath: () => resolve(homedir(), ".config", "github-copilot", "mcp.json"),
    merge() {
      const p = this.configPath();
      const existing = readJsonFile(p);
      deepSet(existing, ["mcpServers", "spoc"], makeStdioEntry());
      return `${JSON.stringify(existing, null, 2)}\n`;
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
      deepSet(existing, ["mcpServers", "spoc"], makeStdioEntry());
      return `${JSON.stringify(existing, null, 2)}\n`;
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
 * Checks whether the SPOC MCP entry already exists in the IDE config.
 * Uses key-path inspection rather than raw string search to avoid false
 * positives (e.g. agent.spoc being mistaken for mcp.spoc in OpenCode).
 */
export function ideHasSpoc(id: IdeId): boolean {
  const p = IDE_MAP[id].configPath();
  if (!existsSync(p)) return false;
  try {
    const config = readJsonFile(p);
    switch (id) {
      case "opencode": {
        // MCP entry lives at config.mcp["spoc"]
        const mcp = config.mcp as Record<string, unknown> | undefined;
        return mcp != null && "spoc" in mcp;
      }
      case "vscode": {
        // Entry lives at config.servers["spoc"]
        const servers = config.servers as Record<string, unknown> | undefined;
        return servers != null && "spoc" in servers;
      }
      case "copilot-cli":
      case "claude-code": {
        // Entry lives at config.mcpServers["spoc"]
        const mcpServers = config.mcpServers as Record<string, unknown> | undefined;
        return mcpServers != null && "spoc" in mcpServers;
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
 * Writes (or merges) the SPOC MCP server entry into the IDE's config file.
 * Returns a WriteResult describing what happened.
 */
export function writeIdeConfig(id: IdeId): WriteResult {
  const info = IDE_MAP[id];
  const configFilePath = info.configPath();
  const alreadyConfigured = ideHasSpoc(id);
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
  return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
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

/** Path to the SPOC orchestrator prompt file. */
function opencodePromptPath(): string {
  return resolve(opencodePromptsDir(), "spoc-orchestrate.txt");
}

/**
 * The OpenCode agent entry for SPOC orchestrator.
 */
export const SPOC_AGENT_ENTRY = {
  description: "SPOC - (Orchestrator)",
  mode: "primary" as const,
  prompt: "{file:./prompts/spoc-orchestrate.txt}",
  color: "#00bcd4",
};

/** The key used for the SPOC agent entry in opencode.json → agent.<key>. */
const SPOC_AGENT_KEY = "SPOC Orchestrator";

/**
 * Checks whether the SPOC agent is already registered in opencode.json.
 */
export function opencodeHasAgent(): boolean {
  const configFile = resolve(opencodeConfigDir(), "opencode.json");
  if (!existsSync(configFile)) return false;
  try {
    const config = readJsonSafeSync<Record<string, unknown>>(configFile) ?? {};
    const agents = config.agent as Record<string, unknown> | undefined;
    return agents != null && SPOC_AGENT_KEY in agents;
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
 * Registers the SPOC orchestrator as a primary agent in opencode.json.
 * Also writes the prompt text file to ~/.config/opencode/prompts/.
 */
export function writeOpencodeAgent(): AgentWriteResult {
  const alreadyConfigured = opencodeHasAgent();
  const configFile = resolve(opencodeConfigDir(), "opencode.json");
  const promptFile = opencodePromptPath();
  const existed = existsSync(configFile);

  // Write the prompt text file
  mkdirSync(opencodePromptsDir(), { recursive: true });
  writeFileSync(promptFile, `${ORCHESTRATE_PROMPT_TEXT}\n`, "utf-8");

  // Merge agent entry into opencode.json with controlled key order:
  // 1. SPOC Orchestrator (always first — controls Tab-cycle position in OpenCode)
  // 2. build (second, if already present in config)
  // 3. all other existing agents in their original order
  const existing = readJsonFile(configFile);
  const existingAgents = (existing.agent ?? {}) as Record<string, unknown>;

  const orderedAgents: Record<string, unknown> = {
    [SPOC_AGENT_KEY]: SPOC_AGENT_ENTRY,
  };
  if ("build" in existingAgents) {
    orderedAgents.build = existingAgents.build;
  }
  for (const [key, value] of Object.entries(existingAgents)) {
    if (key !== SPOC_AGENT_KEY && key !== "build") {
      orderedAgents[key] = value;
    }
  }

  existing.agent = orderedAgents;
  // Set SPOC Orchestrator as the startup default agent
  existing.default_agent = SPOC_AGENT_KEY;
  writeJsonFile(configFile, existing);

  return {
    configPath: configFile,
    promptPath: promptFile,
    action: existed ? "updated" : "created",
    alreadyConfigured,
  };
}
