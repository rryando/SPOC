---
name: explore-dag
description: Navigate and understand the project DAG
---

> **Canonical source of truth:** the runtime EXPLORE workflow
> specification and context-loading tiers live in
> `src/prompts/spoc-orchestrate.ts`. This skill file is a condensed
> summary. When they disagree, the TS prompt wins.

## SPOC CLI — Preferred for DAG Reads

For all DAG read operations, prefer the CLI over MCP tools. It's faster (no write-gate overhead) and supports batch queries in a single shell call. **Every MCP read listed below has a CLI equivalent.**

**Usage:** `node scripts/spoc-cli.mjs <command> [args]`

**Available commands:**
- `context [--path <dir>]` — resolve project context from workspace path (≈ `resolve_project_context`)
- `task <slug> [--status <s>]` — list tasks, optionally filtered (≈ `list_project_tasks`)
- `search <slug> <query> [--limit N]` — BM25 knowledge search (≈ `search_project_knowledge`)
- `plan <slug> [--status <s>]` — list plans (≈ `list_project_plans`)
- `knowledge <slug> [--kind <k>]` — list knowledge entries (≈ `list_project_knowledge_entries`)
- `diagram <slug> <planId> <action>` — inspect/ready/validate diagram
- `batch <json>` — batch operations in one call
- `validate <slug>` — validate project state (≈ `validate_project_state`)

**Output:** JSON to stdout, errors to stderr. Parse with standard JSON tools.

**Rule:** CLI for reads, MCP for writes (task transitions, knowledge creation, plan updates require write-gates). Prefer CLI; fall back to MCP tool if CLI unavailable (no bash access).

**Prerequisite:** `dist/` must be current (`npm run build` if stale).

## When to Use

Use this skill when:
- You need to understand how projects relate to each other
- The user asks about project dependencies or status
- You need to find context about a specific project before making changes
- Planning work that may span multiple projects

## Steps

### List all projects
1. Call `list_projects` to get the full DAG graph.
2. Each entry has: `id`, `name`, `status`, `dependsOn[]`.

### Inspect a specific project
1. Call `get_project` with the project slug to get the project's meta (doc paths, repo URL, timestamps).
2. Read individual docs by calling `get_project` with both `slug` and `doc` parameters:
   - `doc="overview"` — What is this project?
   - `doc="tasks"` — What's being worked on?
   - `doc="dependencies"` — What does it connect to?
   - `doc="knowledge"` — How does the code work?

### Inspect plan and knowledge indexes
Beyond the four core docs, each project can have structured plans and knowledge entries:
1. Call `list_project_plans` with the project slug to see all plans (feature designs, migration strategies, etc.).
2. Call `list_project_knowledge_entries` with the project slug to see all knowledge entries (architecture, patterns, gotchas, etc.).
3. Use `get_project_plan` or `get_project_knowledge_entry` to read the full body of any item.

### Traverse dependencies
1. From the `list_projects` output, find a project's `dependsOn` array.
2. For each dependency, call `get_project` to read its meta and docs recursively.
3. Build a mental model of the dependency chain.

### Example: Find all downstream projects
Given project `core-lib`, find everything that depends on it:
```
1. Call list_projects
2. Filter projects where dependsOn includes "core-lib"
3. These are the downstream dependents
```

## Tips
- Start with `list_projects` for the big picture
- Use `knowledge` docs to quickly understand unfamiliar codebases
- Use `list_project_plans` and `list_project_knowledge_entries` to discover deeper project context
- Filter plans by keyword to find specific document types: `list_project_plans(slug, keywords: ["spec"])` for design specs, `list_project_plans(slug, keywords: ["implementation-plan"])` for implementation plans
- Check `status` to know if a dependency is still actively maintained
- Use `manage_dependency` tool to add/remove edges as you discover relationships
