---
name: update-docs
description: Update project documents with structured content
---

> **Canonical source:** `src/cli/spoc-orchestrate.ts` `## Content Guidelines`.

## When

Codebase analyzed and findings need recording, task statuses changed, dependencies updated, or knowledge needs capturing.

## Flow

```mermaid
flowchart TD
    classDef gate fill:#f59e0b,color:#fff

    A[Read current doc: spoc project get] --> B[Prepare updated content]
    B --> C[spoc write propose]:::gate
    C -->|confirmed| D[spoc project update-doc --token]
    D --> E[Verify: spoc project get]
```

## CLI Primer

```bash
TOKEN=$(spoc write propose "summary" --ops=<op> --slug=<slug> --json | jq -r .data.token)
spoc <command> --token=$TOKEN --json
```
Discovery: `spoc --commands --json`

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
spoc plan create <slug> "Title" --summary="..." --keywords="implementation-plan" --token=$TOKEN --json
spoc plan update-body <slug> <planId> --body="..." --token=$TOKEN --json
```

List existing: `spoc plan list <slug> --json`

## Structured Knowledge Entries

For durable project memory (lessons, gotchas, patterns, architecture):
```bash
spoc knowledge create <slug> "Title" --kind=<kind> --summary="..." --body="..." --token=$TOKEN --json
```

List existing: `spoc knowledge list <slug> --json`

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
