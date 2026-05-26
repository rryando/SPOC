---
name: explore-dag
description: Navigate and understand the project DAG
---

> **Canonical source of truth:** the runtime EXPLORE workflow
> specification and context-loading tiers live in
> `src/prompts/spoc-orchestrate.ts`. This skill file is a condensed
> summary. When they disagree, the TS prompt wins.

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

## When to Use

Use this skill when:
- You need to understand how projects relate to each other
- The user asks about project dependencies or status
- You need to find context about a specific project before making changes
- Planning work that may span multiple projects

## Steps

### List all projects
1. Run `spoc project list --json` to get the full DAG graph.
2. Each entry has: `id`, `name`, `status`, `dependsOn[]`.

### Inspect a specific project
1. Run `spoc project get <slug> --json` to get the project's meta (doc paths, repo URL, timestamps).
2. Read individual docs by running `spoc project get <slug> --doc=<doc> --json`:
   - `--doc=overview` — What is this project?
   - `--doc=tasks` — What's being worked on?
   - `--doc=dependencies` — What does it connect to?
   - `--doc=knowledge` — How does the code work?

### Inspect plan and knowledge indexes
Beyond the four core docs, each project can have structured plans and knowledge entries:
1. Run `spoc plan list <slug> --json` to see all plans (feature designs, migration strategies, etc.).
2. Run `spoc knowledge list <slug> --json` to see all knowledge entries (architecture, patterns, gotchas, etc.).
3. Use `spoc plan get <slug> <planId> --body --json` or `spoc knowledge get <slug> <entryId> --body --json` to read the full body of any item.

### Traverse dependencies
1. From the `spoc project list --json` output, find a project's `dependsOn` array.
2. For each dependency, run `spoc project get <slug> --json` to read its meta and docs recursively.
3. Build a mental model of the dependency chain.

### Example: Find all downstream projects
Given project `core-lib`, find everything that depends on it:
```
1. Run spoc project list --json
2. Filter projects where dependsOn includes "core-lib"
3. These are the downstream dependents
```

## Tips
- Start with `spoc project list --json` for the big picture
- Use `knowledge` docs to quickly understand unfamiliar codebases
- Use `spoc plan list <slug> --json` and `spoc knowledge list <slug> --json` to discover deeper project context
- Filter plans by keyword: `spoc plan list <slug> --json` then filter output for specific keywords
- Check `status` to know if a dependency is still actively maintained
- Use `spoc dependency add <slug> <target> --token=$TOKEN --json` to add/remove edges as you discover relationships
