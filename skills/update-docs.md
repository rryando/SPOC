---
name: update-docs
description: Update project documents with structured content
---

> **Canonical source:** `src/cli/arcs-orchestrate.ts` `## Content Guidelines`.

## When

Codebase analyzed and findings need recording, task statuses changed, dependencies updated, or knowledge needs capturing.

## Flow

```mermaid
flowchart TD
    A[Read current doc: arcs project get] --> B[Prepare updated content]
    B --> C[Present summary to user]
    C -->|confirmed| D[arcs project update-doc]
    D --> E[Verify: arcs project get]
```

## CLI Primer

```bash
arcs <command> --json
```
Discovery: `arcs --commands --json`

## Content Guidelines

| Doc | Format |
|-----|--------|
| overview | 2-3 sentence summary + concrete goals |
| tasks | `[ ]` backlog / `[/]` in-progress / `[x]` done — execution queue state only |
| dependencies | Upstream + downstream with notes on *why* |
| knowledge | Summary landing page → point to structured knowledge entries |

## Structured Plans for Feature Work

Use structured plans for feature work that spans multiple tasks. Create via:
```bash
arcs plan create <slug> "Title" --summary="..." --keywords="implementation-plan" --json
arcs plan update-body <slug> <planId> --body="..." --json
```

List existing: `arcs plan list <slug> --json`

## Structured Knowledge Entries

For durable project memory (lessons, gotchas, patterns, architecture):
```bash
arcs knowledge create <slug> "Title" --kind=<kind> --summary="..." --body="..." --json
```

List existing: `arcs knowledge list <slug> --json`

| Section | What to include |
|---------|----------------|
| Tech Stack | Languages, frameworks, runtimes, key libraries |
| Architecture | Module boundaries, service topology, data flow |
| Patterns | Naming conventions, file organization, coding patterns |
| Gotchas | Non-obvious behaviors, common pitfalls, workarounds |
| Key Files | Entry points, config files, main modules |

> **Tip**: Summary table in knowledge.md. Deep dives in knowledge entries.

## Plan Keyword Conventions

| Keywords | Status | Origin |
|----------|--------|--------|
| `spec`, `design` | `proposed` | Design specs from brainstorming |
| `implementation-plan` | `planned` | Step-by-step implementation plans |
