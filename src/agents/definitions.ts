import type { AgentId } from "../cli/config.js";

// ---------------------------------------------------------------------------
// Agent Definition — TUI metadata only.
// System prompts live in src/prompts/cc-dag-*.ts (the actual MCP registrations).
// ---------------------------------------------------------------------------

export interface AgentDefinition {
  id: AgentId;
  /** Human-readable name shown in TUI multiselect. */
  name: string;
  /** Short description for TUI multiselect hint. */
  hint: string;
  /** MCP prompt name (slash command). */
  promptName: string;
}

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

export const AGENT_DEFINITIONS: Record<AgentId, AgentDefinition> = {
  orchestrate: {
    id: "orchestrate",
    name: "Orchestrate",
    hint: "Intelligent routing across all cc-dag workflows",
    promptName: "cc-dag-orchestrate",
  },
  "init-project": {
    id: "init-project",
    name: "Init Project",
    hint: "Initialize a new project in the DAG",
    promptName: "cc-dag-init",
  },
  brainstorm: {
    id: "brainstorm",
    name: "Brainstorm",
    hint: "Brainstorm features and tasks for a project",
    promptName: "cc-dag-brainstorm",
  },
  execute: {
    id: "execute",
    name: "Execute",
    hint: "Execute a task from a project's backlog",
    promptName: "cc-dag-execute",
  },
  "sync-knowledge": {
    id: "sync-knowledge",
    name: "Sync Knowledge",
    hint: "Sync project knowledge from codebase changes",
    promptName: "cc-dag-sync",
  },
};
