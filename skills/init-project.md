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

## SPOC CLI

All DAG operations use the CLI. Reads are direct. Writes require a write-gate token:
```bash
TOKEN=$(spoc write propose "summary" --ops=<op> --slug=<slug> --json | jq -r .data.token)
spoc <mutating-command> --token=$TOKEN --json
```

**Available commands:**
- `spoc context [<path>] --lean --json` — project orientation
- `spoc task list <slug> [--status=<s>] --lean --json` — list tasks
- `spoc plan list <slug> [--status=<s>] --lean --json` — list plans
- `spoc knowledge list <slug> [--kind=<k>] --lean --json` — list knowledge entries
- `spoc knowledge search <slug> "<query>" --lean --json` — search knowledge
- `spoc project list --lean --json` — list all projects
- `spoc search <slug> "<query>" --lean --json` — cross-type search

**Output:** `{ok: true, data: {...}}` on success, `{ok: false, code: "...", message: "..."}` on failure.

**Discover all commands:** `spoc --commands --json`

**Verify SPOC is available:** `spoc --version`

## Steps

1. **Gather information** from the user or context:
   - `name` (required) — Human-readable project name
   - `description` (required) — One-line description of what this project is
   - `repoUrl` (optional) — Git repository URL
   - `dependsOn` (optional) — Array of existing project slugs this depends on

2. **Check existing projects** by running `spoc project list --json` to:
   - Avoid duplicate names
   - Verify any `dependsOn` targets exist

3. **Initialize the project** using the write-gate flow:
   ```bash
   TOKEN=$(spoc write propose "Init project <name>" --ops=project:init --slug=<slug> --json | jq -r .data.token)
   spoc project init --name="My Project" --description="A brief description" --repo-url="https://github.com/org/repo" --depends-on="other-project" --token=$TOKEN --json
   ```

4. **Verify** by running `spoc project get <slug> --json` to confirm the project was created.

5. **Populate knowledge** (optional) — If the repo already exists, read the skill `spoc://skills/update-docs` to learn how to populate the knowledge doc with structured information about the codebase.

## Content Guidelines

The init tool renders templates with placeholder content. After init, guide the user to fill in:

- **overview.md** — Project summary, goals, notes
- **tasks.md** — Concrete backlog items (execution queue state, not full feature narratives)
- **dependencies.md** — Upstream/downstream context
- **knowledge.md** — High-level project context and pointers; see the `update-docs` skill for detailed guidelines

The init tool also creates empty indexes for structured subresources:

- **plans/** — Structured plans for feature work that spans multiple tasks or decisions. Create plans with `spoc plan create <slug> --title="..." --token=$TOKEN --json`.
- **knowledge/** — Durable knowledge entries for lessons, gotchas, patterns, architecture, and feature notes. Create entries with `spoc knowledge create <slug> "<title>" --kind=<kind> --summary="..." --body="<content>" --token=$TOKEN --json`.

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
