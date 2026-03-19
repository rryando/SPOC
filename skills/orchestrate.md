---
name: orchestrate
description: Classify intent and route work across all SPOC workflows
---

## When to Use

Use this skill when:
- The user request could map to multiple SPOC workflows
- You want one default entry point that decides init vs brainstorm vs execute vs sync vs explore
- The user asks for a multi-step flow like "create it, plan it, then start"

## How it Works

### 1) Intent classification
Classify each request into one intent:
- **INIT** — Track a new project
- **BRAINSTORM** — Plan tasks/architecture/dependencies
- **EXECUTE** — Perform the next concrete task
- **SYNC** — Reconcile docs with current reality
- **EXPLORE** — Inspect DAG/project state without mutating
- **MULTI** — Chain several intents in sequence

If ambiguous, ask one clarifying question. If clear, proceed directly.

### 2) Routing to workflow
Run the matching tool sequence:
- **INIT**: `list_projects` → `init_project` → optional `update_project_doc`
- **BRAINSTORM**: `get_project` (all docs) → `list_project_plans` → planning → `create_project_plan` or `update_project_plan_body` → `update_project_doc` (tasks)
- **EXECUTE**: `get_project` (tasks + context) → `get_project_plan` (active plan) → choose highest-priority task → execute → `update_project_doc` → optional `update_project_status`
- **SYNC**: `get_project` (all docs) → `list_project_plans` + `list_project_knowledge_entries` → audit → propose fixes → `update_project_doc` → optional `update_project_status`
- **EXPLORE**: `list_projects` → `get_project` as needed → `list_project_plans` + `list_project_knowledge_entries` → report
- **MULTI**: run ordered phases, passing context from each phase to the next

### 3) Completion contract
Always end with:
1. What was done
2. Current project state
3. Suggested next steps

## Example Scenarios

- "Track repo X and add initial docs" → **INIT**
- "What should we build next for api-gateway?" → **BRAINSTORM**
- "Do the next task in mobile-app" → **EXECUTE**
- "Sync docs for billing-service" → **SYNC**
- "Show all active projects and blockers" → **EXPLORE**
- "Create project A, plan tasks, then start execution" → **MULTI**

## Tips

- Verbalize detected intent and plan before acting
- Keep users informed at phase transitions
- For doc updates, follow standard formats:
  - tasks: `[ ]` / `[/]` / `[x]` — execution queue state only, not full feature narratives
  - overview: concise summary + concrete goals
  - dependencies: upstream/downstream
  - knowledge.md: high-level project context and pointers
- For structured memory stores:
  - Use `create_project_plan` / `update_project_plan_body` for structured plans for feature work
  - Use `create_project_knowledge_entry` / `update_project_knowledge_body` for durable knowledge entries (lessons, gotchas, patterns, architecture, modules, feature notes)
  - Use `list_project_plans` / `list_project_knowledge_entries` to inspect plan and knowledge indexes
