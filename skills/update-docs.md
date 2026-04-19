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

## Steps

1. **Read the current doc** by calling `get_project` with the project `slug` and `doc` type to understand existing content.

2. **Prepare updated content** following the guidelines below for each doc type.

3. **Call `update_project_doc`** with:
   ```json
   {
     "slug": "my-project",
     "doc": "knowledge",
     "content": "# Knowledge — My Project\n\n..."
   }
   ```

4. **Verify** by calling `get_project` again to confirm the update.

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

1. **Create a knowledge entry** by calling `create_project_knowledge_entry`:
   ```json
   {
     "slug": "my-project",
     "title": "Authentication Module",
      "kind": "architecture"
   }
   ```

2. **Write the body** by calling `update_project_knowledge_body`:
   ```json
   {
     "slug": "my-project",
     "entryId": "authentication-module",
     "body": "## Authentication Module\n\n..."
   }
   ```

3. **List existing entries** with `list_project_knowledge_entries` to avoid duplicates.

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

1. **Create a plan** by calling `create_project_plan`:
   ```json
   {
     "slug": "my-project",
     "title": "API v2 Migration",
      "status": "in_progress"
   }
   ```

2. **Write the plan body** by calling `update_project_plan_body`:
   ```json
   {
     "slug": "my-project",
     "planId": "api-v2-migration",
     "body": "## Goal\n\nMigrate all endpoints to v2...\n\n## Phases\n\n..."
   }
   ```

3. **List existing plans** with `list_project_plans` to see what's in progress.

#### Plan Keyword Conventions

External agent workflows (e.g. superpowers skills) store documents in SPOC as plans with specific keywords:

| Keywords | Status | Origin |
|----------|--------|--------|
| `spec`, `design` | `proposed` | Design specs from brainstorming |
| `implementation-plan` | `planned` | Step-by-step implementation plans |

Use `list_project_plans` with keyword filters to discover these:
- `list_project_plans(slug, keywords: ["spec"])` — find design specs
- `list_project_plans(slug, keywords: ["implementation-plan"])` — find implementation plans

When creating plans through SPOC workflows, you don't need to follow these conventions — they're specific to external agent integration.

> **Tip**: When analyzing a new repo, start with Key Files and Tech Stack — they give you the scaffolding to fill the rest.
