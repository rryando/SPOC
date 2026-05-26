/**
 * Canonical write-gate operation names and their legacy aliases.
 *
 * Used by:
 * - `spoc batch` to validate op names from the batch JSON file
 * - `spoc write propose` to validate the --ops flag values
 * - `requireWriteGate()` to resolve handler-passed legacy strings against
 *   user-supplied canonical proposal entries (and vice versa)
 *
 * When adding a new gated operation, append a row here. Keep the canonical
 * form kebab-case (matching the CLI command shape, e.g. `plan-create`).
 */

export interface OpInfo {
  canonical: string;
  aliases: string[];
  description: string;
}

export const OP_REGISTRY: OpInfo[] = [
  { canonical: "task-create", aliases: ["create_project_task", "tool:create_project_task"], description: "Create a new task" },
  { canonical: "task-transition", aliases: ["transition_project_task", "tool:transition_project_task"], description: "Transition task status" },
  { canonical: "task-update", aliases: ["update_project_task", "tool:update_project_task"], description: "Update task metadata" },
  { canonical: "task-delete", aliases: ["delete_project_task", "tool:delete_project_task"], description: "Delete a task" },
  { canonical: "knowledge-create", aliases: ["create_knowledge_entry", "tool:create_project_knowledge_entry"], description: "Create a knowledge entry" },
  { canonical: "knowledge-update-meta", aliases: ["update_knowledge_entry", "tool:update_project_knowledge_meta"], description: "Update knowledge entry metadata" },
  { canonical: "knowledge-update-body", aliases: ["update_knowledge_body", "tool:update_project_knowledge_body"], description: "Update knowledge entry body" },
  { canonical: "knowledge-delete", aliases: ["delete_knowledge_entry", "tool:delete_project_knowledge_entry"], description: "Delete a knowledge entry" },
  { canonical: "plan-create", aliases: ["create_project_plan", "tool:create_project_plan"], description: "Create a plan" },
  { canonical: "plan-update-meta", aliases: ["update_project_plan", "tool:update_project_plan_meta"], description: "Update plan metadata" },
  { canonical: "plan-update-body", aliases: ["update_project_plan_body", "tool:update_project_plan_body"], description: "Update plan body" },
  { canonical: "plan-delete", aliases: ["delete_project_plan", "tool:delete_project_plan"], description: "Delete a plan" },
  { canonical: "doc-update", aliases: ["update_project_doc", "tool:update_project_doc", "cli:doc_update"], description: "Update a project document" },
  { canonical: "project-init", aliases: ["init_project", "tool:init_project"], description: "Initialize a project" },
  { canonical: "project-update-status", aliases: ["update_project_status", "tool:update_project_status"], description: "Update project lifecycle status" },
  { canonical: "project-update-paths", aliases: ["update_project_paths", "tool:update_project_paths"], description: "Update project workspace paths" },
  { canonical: "dependency-manage", aliases: ["manage_dependency", "cli:manage_dependency"], description: "Add or remove a dependency edge" },
  { canonical: "paths-update", aliases: ["update_paths", "cli:update_paths"], description: "Update workspace paths" },
  { canonical: "loop-start", aliases: ["start_project_loop", "tool:start_project_loop"], description: "Start a development loop" },
  { canonical: "loop-cancel", aliases: ["cancel_project_loop", "tool:cancel_project_loop"], description: "Cancel a development loop" },
  { canonical: "sync-agents-md", aliases: ["sync_agents_md", "tool:sync_agents_md"], description: "Regenerate AGENTS.md" },
  { canonical: "batch", aliases: [], description: "Multi-op batch (gate verified once at top level)" },
];

/**
 * Build a lookup table from any known alias OR canonical to the canonical name.
 * Includes the canonical itself so canonical→canonical resolves identity.
 */
const aliasIndex: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const info of OP_REGISTRY) {
    m.set(info.canonical, info.canonical);
    for (const alias of info.aliases) {
      m.set(alias, info.canonical);
    }
  }
  return m;
})();

/**
 * Resolve any op name (canonical, alias, or near-canonical) to its canonical form.
 * Falls back to a normalized form (lowercase, hyphens) if no exact alias match.
 * If still unknown, returns the input unchanged so callers can decide policy.
 */
export function resolveOpName(op: string): string {
  // Direct hit
  const direct = aliasIndex.get(op);
  if (direct) return direct;

  // Strip tool:/cli: prefixes and try again
  const stripped = op.replace(/^(tool|cli):/, "");
  const strippedHit = aliasIndex.get(stripped);
  if (strippedHit) return strippedHit;

  // Underscore → hyphen normalization
  const normalized = stripped.toLowerCase().replace(/[\s_]+/g, "-");
  const normalizedHit = aliasIndex.get(normalized);
  if (normalizedHit) return normalizedHit;

  // Colon-form short alias: e.g. "plan:create" → "plan-create"
  // Only when the resulting kebab-case form is in the canonical set —
  // protects against false matches on host:port or URL-like strings.
  if (op.includes(":")) {
    const colonAsHyphen = op.toLowerCase().replace(/:/g, "-").replace(/[\s_]+/g, "-");
    const colonHit = aliasIndex.get(colonAsHyphen);
    if (colonHit) return colonHit;
  }

  // Unknown — return as-is
  return op;
}

/** All canonical op names (for enum/validation). */
export const CANONICAL_OPS: string[] = OP_REGISTRY.map((o) => o.canonical);
