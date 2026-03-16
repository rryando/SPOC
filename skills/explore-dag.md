---
name: explore-dag
description: Navigate and understand the project DAG
---

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
- Check `status` to know if a dependency is still actively maintained
- Use `manage_dependency` tool to add/remove edges as you discover relationships
