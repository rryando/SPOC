import type { AgentId } from "../cli/config.js";

// ---------------------------------------------------------------------------
// Agent Definition — TUI metadata only.
// System prompts live in src/prompts/spoc-*.ts (the actual MCP registrations).
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
    hint: "Intelligent routing across queue, plan, and memory workflows",
    promptName: "spoc-orchestrate",
  },
  "init-project": {
    id: "init-project",
    name: "Init Project",
    hint: "Initialize a new project with queue, plan, and memory surfaces",
    promptName: "spoc-init",
  },
  brainstorm: {
    id: "brainstorm",
    name: "Brainstorm",
    hint: "Brainstorm queue items, multi-step plans, and durable memory",
    promptName: "spoc-brainstorm",
  },
  execute: {
    id: "execute",
    name: "Execute",
    hint: "Execute queue items with structured plan and memory awareness",
    promptName: "spoc-execute",
  },
  "sync-knowledge": {
    id: "sync-knowledge",
    name: "Sync Knowledge",
    hint: "Sync queue, plans, and knowledge memory surfaces from codebase changes",
    promptName: "spoc-sync",
  },
};
