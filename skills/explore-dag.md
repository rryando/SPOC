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
1. Read `cc-dag://projects` to get the full DAG graph.
2. Each entry has: `id`, `name`, `status`, `dependsOn[]`.

### Inspect a specific project
1. Read `cc-dag://projects/{slug}` for the project's meta (doc paths, repo URL, timestamps).
2. Read individual docs as needed:
   - `cc-dag://projects/{slug}/overview` — What is this project?
   - `cc-dag://projects/{slug}/tasks` — What's being worked on?
   - `cc-dag://projects/{slug}/dependencies` — What does it connect to?
   - `cc-dag://projects/{slug}/knowledge` — How does the code work?

### Traverse dependencies
1. From the root graph, find a project's `dependsOn` array.
2. For each dependency, read its meta and docs recursively.
3. Build a mental model of the dependency chain.

### Example: Find all downstream projects
Given project `core-lib`, find everything that depends on it:
```
1. Read cc-dag://projects
2. Filter projects where dependsOn includes "core-lib"
3. These are the downstream dependents
```

## Tips
- Start with `cc-dag://projects` for the big picture
- Use `knowledge` docs to quickly understand unfamiliar codebases
- Check `status` to know if a dependency is still actively maintained
- Use `manage_dependency` tool to add/remove edges as you discover relationships
