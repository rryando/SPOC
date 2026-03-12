---
name: update-docs
description: Update project documents with structured content
---

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

This is the most important document. Fill in each section thoroughly:

| Section | What to include |
|---------|----------------|
| **Tech Stack** | Languages, frameworks, runtimes, key libraries with versions |
| **Architecture** | Module boundaries, service topology, data flow diagrams (mermaid) |
| **Patterns & Conventions** | Naming conventions, file organization, coding patterns used |
| **Known Gotchas** | Non-obvious behaviors, common pitfalls, workarounds |
| **Key Files** | Entry points, config files, main modules with their purpose |
| **API Surface** | Endpoints, interfaces, exported functions |
| **Data Model** | Schemas, database tables, key data structures |

> **Tip**: When analyzing a new repo, start with Key Files and Tech Stack — they give you the scaffolding to fill the rest.
