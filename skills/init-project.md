---
name: init-project
description: Initialize a new project in the DAG
---

> **Canonical source of truth:** the runtime INIT workflow specification
> lives in `src/prompts/spoc-orchestrate.ts` under `### INIT Workflow`.
> This skill file is a condensed summary. When they disagree, the TS
> prompt wins.

## When to Use

Use this skill when the user wants to:
- Track a new project / codebase in the DAG
- Start working on a new initiative that should be connected to existing projects
- Bootstrap project documentation for a repository

## SPOC CLI — Preferred for DAG Reads

For all DAG read operations, prefer the CLI over MCP tools. It's faster (no write-gate overhead) and supports batch queries in a single shell call.

**Usage:** `node scripts/spoc-cli.mjs <command> [args]`

**Available commands:**
- `context [--path <dir>]` — resolve project context from workspace path
- `task <slug> [--status <s>]` — list tasks, optionally filtered
- `search <slug> <query> [--limit N]` — BM25 knowledge search
- `plan <slug> [--status <s>]` — list plans
- `knowledge <slug> [--kind <k>]` — list knowledge entries
- `diagram <slug> <planId> <action>` — inspect/ready/validate diagram
- `batch <json>` — batch operations in one call
- `validate <slug>` — validate project state

**Output:** JSON to stdout, errors to stderr. Parse with standard JSON tools.

**Rule:** CLI for reads, MCP for writes (task transitions, knowledge creation, plan updates require write-gates).

**Prerequisite:** `dist/` must be current (`npm run build` if stale).

## Steps

1. **Gather information** from the user or context:
   - `name` (required) — Human-readable project name
   - `description` (required) — One-line description of what this project is
   - `repoUrl` (optional) — Git repository URL
   - `dependsOn` (optional) — Array of existing project slugs this depends on

2. **Check existing projects** by calling the `list_projects` tool to:
   - Avoid duplicate names
   - Verify any `dependsOn` targets exist

3. **Call the `init_project` tool** with the gathered params:
   ```json
   {
     "name": "My Project",
     "description": "A brief description",
     "repoUrl": "https://github.com/org/repo",
     "dependsOn": ["other-project"]
   }
   ```

4. **Verify** by calling `get_project` with the new slug to confirm the project was created.

5. **Populate knowledge** (optional) — If the repo already exists, read the skill `spoc://skills/update-docs` to learn how to populate the knowledge doc with structured information about the codebase.

## Content Guidelines

The init tool renders templates with placeholder content. After init, guide the user to fill in:

- **overview.md** — Project summary, goals, notes
- **tasks.md** — Concrete backlog items (execution queue state, not full feature narratives)
- **dependencies.md** — Upstream/downstream context
- **knowledge.md** — High-level project context and pointers; see the `update-docs` skill for detailed guidelines

The init tool also creates empty indexes for structured subresources:

- **plans/** — Structured plans for feature work that spans multiple tasks or decisions. Create plans with `create_project_plan`.
- **knowledge/** — Durable knowledge entries for lessons, gotchas, patterns, architecture, and feature notes. Create entries with `create_project_knowledge_entry`.

## Knowledge Categories for New Projects

During INIT codebase analysis, the explore/analysis sub-agent should create one knowledge entry per applicable category from the table below.

| Category | Kind | What to discover |
|----------|------|------------------|
| tech stack | `architecture` | Languages, frameworks, runtimes, build tools, versions |
| key files | `reference` | Entry points, config files, main modules, purposes |
| code patterns | `pattern` | Recurring design patterns, abstractions, error handling |
| coding style | `pattern` | Formatting, linting, import ordering, file organization |
| core modules | `module` | Core modules/shared functions — what, where, interconnections |
| external services | `module` | APIs, databases, message queues the project interacts with |
| third-party libraries | `reference` | Key dependencies and why they are used |
| features | `feature` | Major user-facing or system-facing features |
