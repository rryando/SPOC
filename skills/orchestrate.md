---
name: orchestrate
description: Classify intent and route work across all cc-dag workflows
---

## When to Use

Use this skill when:
- The user request could map to multiple cc-dag workflows
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
- **BRAINSTORM**: `get_project` (all docs) → planning → `update_project_doc`
- **EXECUTE**: `get_project` (tasks + context) → choose highest-priority task → execute → `update_project_doc` → optional `update_project_status`
- **SYNC**: `get_project` (all docs) → audit → propose fixes → `update_project_doc` → optional `update_project_status`
- **EXPLORE**: `list_projects` → `get_project` as needed → report
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
  - tasks: `[ ]` / `[/]` / `[x]`
  - overview: concise summary + concrete goals
  - dependencies: upstream/downstream
  - knowledge: stack, architecture, patterns, gotchas, key files
