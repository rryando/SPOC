---
name: update-docs
description: Update project documents with structured content
---

> **Canonical source of truth:** document content guidelines in the runtime
> orchestrator prompt (`src/prompts/spoc-orchestrate.ts`, `## Content
> Guidelines`) take precedence when this skill file disagrees.

## When to Use

Use this skill when:
- You've analyzed a codebase and want to record findings
- The user asks you to document a project's architecture, patterns, or tech stack
- Task statuses change and need to be reflected in the DAG
- Dependency relationships change

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

1. **Read the current doc** by running `spoc project get <slug> --json` to understand existing content.

2. **Prepare updated content** following the guidelines below for each doc type.

3. **Write the update** using the write-gate flow:
   ```bash
   TOKEN=$(spoc write propose "Update <doc> for <slug>" --ops=project:update-doc --slug=<slug> --json | jq -r .data.token)
   spoc project update-doc <slug> <doc> --content="..." --token=$TOKEN --json
   ```

4. **Verify** by running `spoc project get <slug> --json` again to confirm the update.

## Content Guidelines by Document Type

### `overview` — Project Overview
- Summarize what the project does in 2-3 sentences
- List concrete goals (not vague aspirations)
- Include any relevant links (docs, dashboards, etc.)

### `tasks` — Task Tracking
- Use `[ ]` for backlog, `[/]` for in-progress, `[x]` for completed
- Keep task descriptions actionable and specific
- Group related tasks under sub-headings if needed

### `dependencies` — Dependency Map
- **Upstream**: Projects this one imports from, calls into, or requires
- **Downstream**: Projects that depend on this one
- Include brief notes on *why* the dependency exists

### `knowledge` — Structured Code Knowledge

`knowledge.md` is the summary landing page. Use it for high-level project context and pointers — tech stack, architecture overview, key files, and links to deeper knowledge entries.

For durable project memory (lessons, gotchas, patterns, detailed architecture, modules, feature notes), use structured knowledge entries instead of writing everything in the monolithic knowledge.md:

1. **Create a knowledge entry:**
   ```bash
   TOKEN=$(spoc write propose "Create knowledge entry" --ops=knowledge:create --slug=<slug> --json | jq -r .data.token)
   spoc knowledge create <slug> "Authentication Module" --kind=architecture --summary="..." --body="<markdown content>" --token=$TOKEN --json
   ```

2. **Write the body:**
   ```bash
   TOKEN=$(spoc write propose "Update knowledge body" --ops=knowledge:update-body --slug=<slug> --json | jq -r .data.token)
   spoc knowledge update-body <slug> <entryId> --body="## Authentication Module\n\n..." --token=$TOKEN --json
   ```

3. **List existing entries** with `spoc knowledge list <slug> --json` to avoid duplicates.

| Section | What to include |
|---------|----------------|
| **Tech Stack** | Languages, frameworks, runtimes, key libraries with versions |
| **Architecture** | Module boundaries, service topology, data flow diagrams (mermaid) |
| **Patterns & Conventions** | Naming conventions, file organization, coding patterns used |
| **Known Gotchas** | Non-obvious behaviors, common pitfalls, workarounds |
| **Key Files** | Entry points, config files, main modules with their purpose |
| **API Surface** | Endpoints, interfaces, exported functions |
| **Data Model** | Schemas, database tables, key data structures |

> **Tip**: Put the summary table in knowledge.md. Put the deep dives in knowledge entries.

### `plans/` — Structured Plans for Feature Work

Use structured plans for feature work that spans multiple tasks or decisions. Plans live in the `plans/` subdirectory, separate from the `tasks.md` execution queue.

Use `tasks.md` for execution queue state, not full feature planning narratives. When a feature needs design rationale, phased steps, or decision records, create a plan instead:

1. **Create a plan:**
   ```bash
   TOKEN=$(spoc write propose "Create plan" --ops=plan:create --slug=<slug> --json | jq -r .data.token)
   spoc plan create <slug> --title="API v2 Migration" --status=in_progress --token=$TOKEN --json
   ```

2. **Write the plan body:**
   ```bash
   TOKEN=$(spoc write propose "Update plan body" --ops=plan:update-body --slug=<slug> --json | jq -r .data.token)
   spoc plan update-body <slug> <planId> --body="## Goal\n\nMigrate all endpoints to v2...\n\n## Phases\n\n..." --token=$TOKEN --json
   ```

3. **List existing plans** with `spoc plan list <slug> --json` to see what's in progress.

#### Plan Keyword Conventions

External agent workflows (e.g. SPOC skills) store documents in SPOC as plans with specific keywords:

| Keywords | Status | Origin |
|----------|--------|--------|
| `spec`, `design` | `proposed` | Design specs from brainstorming |
| `implementation-plan` | `planned` | Step-by-step implementation plans |

Use `spoc plan list <slug> --json` with keyword filters to discover these.

When creating plans through SPOC workflows, you don't need to follow these conventions — they're specific to external agent integration.

> **Tip**: When analyzing a new repo, start with Key Files and Tech Stack — they give you the scaffolding to fill the rest.
