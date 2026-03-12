---
name: init-project
description: Initialize a new project in the DAG
---

## When to Use

Use this skill when the user wants to:
- Track a new project / codebase in the DAG
- Start working on a new initiative that should be connected to existing projects
- Bootstrap project documentation for a repository

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

5. **Populate knowledge** (optional) — If the repo already exists, read the skill `cc-dag://skills/update-docs` to learn how to populate the knowledge doc with structured information about the codebase.

## Content Guidelines

The init tool renders templates with placeholder content. After init, guide the user to fill in:

- **overview.md** — Project summary, goals, notes
- **tasks.md** — Concrete backlog items
- **dependencies.md** — Upstream/downstream context
- **knowledge.md** — See the `update-docs` skill for detailed guidelines
