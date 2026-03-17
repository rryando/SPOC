# Template Efficiency and Per-Project Plans and Knowledge Design

## Goal

Reduce the token cost of project initialization and repeated project reads, while adding structured per-project systems for feature plans and project knowledge.

## Current State

The current project model creates these files for every project:

- `meta.json`
- `overview.md`
- `tasks.md`
- `dependencies.md`
- `knowledge.md`

This is simple, but the markdown templates are verbose for agent use. They include instructional comments, mostly empty tables, and repeated scaffolding that adds little value after initialization.

The current system also has no first-class way to store plan state for individual features within a project. Planning is implied through `tasks.md` or external notes rather than a structured project-local plan store.

Knowledge is also stored only in a single `knowledge.md` file. That makes durable project understanding expensive to read and hard to query selectively as projects accumulate lessons learned, gotchas, patterns, architecture notes, modules, and feature knowledge.

## Design Goals

- Keep root DAG state small and graph-focused
- Reduce token usage for project initialization and repeated reads
- Add structured, project-scoped plan storage
- Add structured, project-scoped knowledge storage
- Make plan discovery cheap through metadata-first reads
- Make knowledge discovery cheap through metadata-first reads
- Preserve human-editable markdown for longer narrative plan content
- Preserve human-editable markdown for longer narrative knowledge content
- Keep the existing four core docs stable for backward compatibility

## Non-Goals

- Adding a global root-level plan index across all projects
- Adding a global root-level knowledge index across all projects
- Replacing all markdown docs with JSON
- Turning plans into a fifth top-level project doc type
- Turning knowledge into a fully JSON-only system
- Adding full-text search infrastructure

## Recommended Approach

Keep the existing four top-level project docs, simplify their templates, add a new per-project `plans/` subresource family, and evolve knowledge into a hybrid model with a short summary doc plus structured `knowledge/` entries.

### Why this approach

- It improves token efficiency without changing the core DAG model
- It avoids bloating root `meta.json` as the number of projects and plans grows
- It gives callers cheap structured reads through indexes before they fetch full markdown bodies
- It preserves a clear separation between durable project context and per-feature development planning
- It lets project knowledge scale without turning `knowledge.md` into a large monolith

## Storage Model

### Root DAG

Keep root `meta.json` unchanged in responsibility. It should continue to store only:

- project identity
- project status
- dependency edges

No plan or knowledge metadata should be stored at the root level.

### Per-Project Core Docs

Continue creating these files for each project:

- `overview.md`
- `tasks.md`
- `dependencies.md`
- `knowledge.md`

Their templates should become shorter and more agent-oriented.

`knowledge.md` should become a compact summary doc rather than the only place long-lived knowledge is stored.

### Per-Project Plans

Add a new directory layout under each project:

```text
projects/{slug}/plans/
  index.json
  {planId}/
    meta.json
    plan.md
```

This makes plans a project subresource family rather than a top-level doc type.

### Per-Project Knowledge

Add a new directory layout under each project:

```text
projects/{slug}/knowledge/
  index.json
  {entryId}/
    meta.json
    entry.md
```

This keeps `knowledge.md` as a short summary while moving detailed knowledge into structured entries.

## Plan Schema

### `plans/index.json`

This file is the cheap searchable summary for the project's plans. It must always use this exact JSON shape:

```json
{
  "plans": []
}
```

`plans` contains compact plan records.

Recommended entry shape:

```json
{
  "id": "reduce-template-token-cost",
  "title": "Reduce template token cost",
  "status": "planned",
  "keywords": ["templates", "token-efficiency"],
  "summary": "Trim default project templates and add structured plan storage.",
  "createdAt": "2026-03-16T00:00:00.000Z",
  "updatedAt": "2026-03-16T00:00:00.000Z"
}
```

### `plans/{planId}/meta.json`

This file is the authoritative structured record for a single plan.

Recommended initial schema:

```json
{
  "id": "reduce-template-token-cost",
  "title": "Reduce template token cost",
  "status": "planned",
  "keywords": ["templates", "token-efficiency"],
  "summary": "Trim default project templates and add structured plan storage.",
  "createdAt": "2026-03-16T00:00:00.000Z",
  "updatedAt": "2026-03-16T00:00:00.000Z"
}
```

This should intentionally stay small. Future fields such as `owner`, `dependsOnPlans`, `stage`, or `targetFiles` can be added later without changing the directory model.

`planId` should be normalized with the same slug-style rules used for project IDs:

- lowercase only
- words separated by hyphens
- strip unsupported punctuation
- reject empty output after normalization
- reject collisions after normalization

If a caller provides a title but not an explicit ID, the implementation should derive `planId` from the title using the same normalization.

### `plans/{planId}/plan.md`

This file stores the human-readable plan body. It should support:

- feature rationale
- implementation outline
- open questions
- milestones
- notes gathered during execution

The markdown body should not duplicate the full metadata schema beyond a minimal title line.

`plan.md` should begin with a single H1 using the plan title. When plan metadata changes the title, the implementation should rewrite that H1 to keep the body aligned with `meta.json`.

## Status and Keyword Conventions

### Status

Use a normalized enumerated status so callers can filter reliably. Initial allowed values:

- `proposed`
- `planned`
- `in_progress`
- `blocked`
- `done`
- `archived`

### Keywords

`keywords` must be a normalized string array in both `plans/index.json` and the individual plan `meta.json`.

Guidelines:

- use lowercase strings
- prefer short canonical terms
- avoid duplicates
- treat keywords as exact-match filter tokens rather than full-text search

This gives callers a cheap way to search within a project without introducing a global index.

Filtering semantics:

- keyword filtering defaults to `any` match semantics
- exact string matching only after normalization
- duplicate keywords are removed during write operations
- writing or updating `plan.md` must bump `updatedAt` in both `plans/{planId}/meta.json` and the matching `plans/index.json` entry

## Knowledge Schema

### `knowledge/index.json`

This file is the cheap searchable summary for the project's knowledge entries. It must always use this exact JSON shape:

```json
{
  "entries": []
}
```

`entries` contains compact knowledge records.

Recommended entry shape:

```json
{
  "id": "module-auth-flow",
  "title": "Auth flow module",
  "kind": "module",
  "keywords": ["auth", "module", "session"],
  "summary": "Explains the auth flow boundaries and state transitions.",
  "createdAt": "2026-03-16T00:00:00.000Z",
  "updatedAt": "2026-03-16T00:00:00.000Z"
}
```

### `knowledge/{entryId}/meta.json`

This file is the authoritative structured record for a single knowledge entry.

Recommended initial schema:

```json
{
  "id": "module-auth-flow",
  "title": "Auth flow module",
  "kind": "module",
  "keywords": ["auth", "module", "session"],
  "summary": "Explains the auth flow boundaries and state transitions.",
  "createdAt": "2026-03-16T00:00:00.000Z",
  "updatedAt": "2026-03-16T00:00:00.000Z"
}
```

This should intentionally stay small.

`entryId` should be normalized with the same slug-style rules used for project IDs and `planId`:

- lowercase only
- words separated by hyphens
- strip unsupported punctuation
- reject empty output after normalization
- reject collisions after normalization

If a caller provides a title but not an explicit ID, the implementation should derive `entryId` from the title using the same normalization.

### `knowledge/{entryId}/entry.md`

This file stores the detailed human-readable knowledge body. It should support:

- lessons learned
- gotchas
- architecture explanations
- project patterns and conventions
- module notes
- feature notes

The markdown body should not duplicate the full metadata schema beyond a minimal title line.

`entry.md` should begin with a single H1 using the entry title. When knowledge metadata changes the title, the implementation should rewrite that H1 to keep the body aligned with `meta.json`.

### Knowledge Kind

Use a normalized enumerated `kind` field so callers can filter reliably. Initial allowed values:

- `lesson`
- `gotcha`
- `pattern`
- `architecture`
- `module`
- `feature`
- `reference`

### Knowledge Keywords

`keywords` must be a normalized string array in both `knowledge/index.json` and the individual knowledge `meta.json`.

Filtering semantics:

- keyword filtering defaults to `any` match semantics
- exact string matching only after normalization
- duplicate keywords are removed during write operations
- writing or updating `entry.md` must bump `updatedAt` in both `knowledge/{entryId}/meta.json` and the matching `knowledge/index.json` entry

## Template Simplification

### Overview Template

Replace instructional comments and unnecessary table structure with a compact scaffold:

- project title
- one-line description
- status and repo URL only if present
- short sections for summary, goals, current focus

### Tasks Template

Keep only the three operational sections:

- backlog
- in progress
- done

Remove instructional comments and minimize starter content.

### Dependencies Template

Replace empty tables with short bullet-based sections for:

- upstream
- downstream

This is cheaper to read and easier for agents to update.

### Knowledge Template

Replace empty tables and comments with a short summary doc such as:

- stack
- key architecture points
- active patterns
- key files or entry pointers

Keep it compact so it acts as a landing page into the structured knowledge store rather than a growing monolith.

## MCP Surface

Plans should be exposed as dedicated project-scoped resources and tools, not folded into the existing document API.

Structured knowledge should also be exposed as dedicated project-scoped resources and tools, while keeping `get_project(..., doc="knowledge")` for the summary doc.

### Resources

Recommended additions:

- `cc-dag://projects/{slug}/plans`
- `cc-dag://projects/{slug}/plans/{planId}`
- `cc-dag://projects/{slug}/plans/{planId}/meta`
- `cc-dag://projects/{slug}/knowledge`
- `cc-dag://projects/{slug}/knowledge/{entryId}`
- `cc-dag://projects/{slug}/knowledge/{entryId}/meta`

Behavior:

- project plan index returns `plans/index.json`
- plan resource returns `plan.md`
- plan meta resource returns `meta.json`
- project knowledge index returns `knowledge/index.json`
- knowledge resource returns `entry.md`
- knowledge meta resource returns `meta.json`

### Tools

Recommended additions:

- `create_project_plan`
- `list_project_plans`
- `get_project_plan`
- `update_project_plan_meta`
- `update_project_plan_body`
- `create_project_knowledge_entry`
- `list_project_knowledge_entries`
- `get_project_knowledge_entry`
- `update_project_knowledge_meta`
- `update_project_knowledge_body`

These operations should remain project-scoped.

Recommended initial contracts:

- `create_project_plan(slug, title, summary?, status?, keywords?, body?, planId?)`
- `list_project_plans(slug, status?, keywords?)`
- `get_project_plan(slug, planId, includeBody?)`
- `update_project_plan_meta(slug, planId, title?, summary?, status?, keywords?)`
- `update_project_plan_body(slug, planId, body)`
- `create_project_knowledge_entry(slug, title, kind, summary?, keywords?, body?, entryId?)`
- `list_project_knowledge_entries(slug, kind?, keywords?)`
- `get_project_knowledge_entry(slug, entryId, includeBody?)`
- `update_project_knowledge_meta(slug, entryId, title?, kind?, summary?, keywords?)`
- `update_project_knowledge_body(slug, entryId, body)`

Parameter conventions:

- `slug`, `planId`, and `entryId` are strings
- `title`, `summary`, and `body` are strings
- `status` is one of the allowed plan status enum values
- `kind` is one of the allowed knowledge kind enum values
- `keywords` is always an array of strings on input and output, never a comma-separated string
- `includeBody` is a boolean and defaults to `false`

Return conventions:

- `create_project_plan` returns `{ meta, body }`
- `list_project_plans` returns `{ plans }`
- `get_project_plan(includeBody=false)` returns `{ meta }`
- `get_project_plan(includeBody=true)` returns `{ meta, body }`
- `update_project_plan_meta` returns `{ meta }`
- `update_project_plan_body` returns `{ meta, body }`
- `create_project_knowledge_entry` returns `{ meta, body }`
- `list_project_knowledge_entries` returns `{ entries }`
- `get_project_knowledge_entry(includeBody=false)` returns `{ meta }`
- `get_project_knowledge_entry(includeBody=true)` returns `{ meta, body }`
- `update_project_knowledge_meta` returns `{ meta }`
- `update_project_knowledge_body` returns `{ meta, body }`

Behavior notes:

- `list_project_plans` returns records from `plans/index.json`
- `get_project_plan(..., includeBody=false)` returns only metadata to keep reads cheap
- `get_project_plan(..., includeBody=true)` returns both metadata and markdown body
- metadata updates must sync both the per-plan `meta.json` and the matching `plans/index.json` entry
- `list_project_knowledge_entries` returns records from `knowledge/index.json`
- `get_project_knowledge_entry(..., includeBody=false)` returns only metadata to keep reads cheap
- `get_project_knowledge_entry(..., includeBody=true)` returns both metadata and markdown body
- metadata updates must sync both the per-entry `meta.json` and the matching `knowledge/index.json` entry
- list operations accept `keywords` as an optional string array and use `any`-match semantics after normalization

## Prompt, Skill, and Agent Surface

The current MCP-facing prompts, local skills, and agent definitions assume a four-doc model and treat `knowledge.md` as the entire knowledge surface. The implementation must update these layers to match the new structured plan and knowledge model.

### Prompt Updates

Update these prompt registrations:

- `src/prompts/cc-dag-orchestrate.ts`
- `src/prompts/cc-dag-brainstorm.ts`
- `src/prompts/cc-dag-execute.ts`
- `src/prompts/cc-dag-sync.ts`
- `src/prompts/cc-dag-init.ts`

Required changes:

- describe plans as a project-scoped subresource family rather than a top-level doc
- describe knowledge as a hybrid model: summary in `knowledge.md`, detailed entries in `knowledge/`
- teach brainstorm flows to create or update structured plans when planning feature work
- teach execute flows to update structured knowledge entries when implementation reveals lessons, gotchas, patterns, architecture details, modules, or feature notes
- teach sync flows to audit both summary docs and structured plan/knowledge indexes
- teach init flows that new projects start with empty `plans/` and `knowledge/` indexes
- update tool lists and workflow steps to reference the new plan and knowledge tools where relevant
- ensure `MULTI` workflows in orchestration can chain plan and knowledge operations across phases when relevant

### Skill Guide Updates

Update these local skill docs:

- `skills/orchestrate.md`
- `skills/update-docs.md`
- `skills/explore-dag.md`
- `skills/init-project.md`

Required changes:

- explain the distinction between core docs, structured plans, and structured knowledge entries
- update documentation guidance so `knowledge.md` becomes a short summary plus pointers into indexed knowledge entries
- add guidance for when to create a new plan vs update `tasks.md`
- add guidance for when to create a new knowledge entry vs updating the `knowledge.md` summary
- teach exploration flows to inspect plan and knowledge indexes, not just the four core docs

### Agent and Subagent Metadata Updates

Update agent-facing metadata so the TUI and prompt selection surface reflect the richer model.

Primary file:

- `src/agents/definitions.ts`

Required changes:

- rename or reword hints that currently imply only task execution or only monolithic knowledge syncing
- ensure the sync-oriented agent description reflects syncing project docs, plans, and structured knowledge, not only `knowledge.md`
- ensure brainstorm and execute hints mention planning and structured project memory where helpful

If additional agent configuration or prompt registration files reference the old four-doc-only model, those must be updated too.

### Behavior Expectations for Agents

After the change:

- planning-oriented agents should prefer creating structured plan records for feature-development work
- execution-oriented agents should continue updating `tasks.md` for workflow state, but record durable implementation knowledge in structured knowledge entries
- sync-oriented agents should reconcile both summary docs and index-backed subresources
- orchestration should treat plan and knowledge operations as normal parts of INIT, BRAINSTORM, EXECUTE, SYNC, and MULTI workflows when relevant

## Decision Rules for Structured Plans and Knowledge

To keep prompts, skills, and agents consistent, the implementation should use these default policies.

### When to create or update a structured plan

Use a structured plan record when the work is feature-like and benefits from its own durable planning artifact, especially when one or more of these is true:

- the work spans multiple concrete tasks
- the work has meaningful design or sequencing decisions
- the work needs its own lifecycle state beyond checkbox tracking
- the work may be resumed, handed off, or revisited later

Use `tasks.md` without a structured plan when the work is a small standalone task that does not need separate planning context.

Practical rule:

- `tasks.md` is the execution queue and progress tracker
- structured plans are the project-local feature planning records

If a structured plan exists for a piece of work, related task items in `tasks.md` should reference or align with that plan rather than duplicating the full planning narrative.

### When to create or update a structured knowledge entry

Create or update a structured knowledge entry when the information is likely to remain useful beyond the current task or session, especially when it captures one of these categories:

- lessons learned
- gotchas
- project patterns or conventions
- architecture explanations
- module-level understanding
- feature-level behavior or boundaries

Update only the short `knowledge.md` summary when the change is high-level project context that should remain visible at a glance, such as:

- current stack summary
- a short architecture overview
- pointers to important knowledge entry categories

Practical rule:

- `knowledge.md` is the landing page
- structured knowledge entries are the durable detailed memory

When a new knowledge entry is added, `knowledge.md` should only be updated if the summary or entry pointers become stale; it should not mirror the full contents of the entry.

## Backward Compatibility

The existing doc model should keep working unchanged:

- `get_project` continues to support only `overview`, `tasks`, `dependencies`, and `knowledge`
- `update_project_doc` continues to update only those four docs

Plans and structured knowledge should be introduced through separate tool and resource entry points. This avoids breaking callers that assume a fixed doc enum.

## Initialization Flow Changes

`init_project` should begin creating the `plans/` directory and a minimal `plans/index.json` alongside the existing docs.

`init_project` should also begin creating the `knowledge/` directory and a minimal `knowledge/index.json`, while keeping `knowledge.md` as a short summary doc.

Recommended initial state:

- create `projects/{slug}/plans/`
- create `projects/{slug}/plans/index.json` with the exact canonical shape `{ "plans": [] }`
- create `projects/{slug}/knowledge/`
- create `projects/{slug}/knowledge/index.json` with the exact canonical shape `{ "entries": [] }`
- do not create a default starter plan unless explicitly requested
- do not create default knowledge entries unless explicitly requested

This keeps initialization cheap while making the feature available immediately.

## Data Flow

### Project initialization

1. Create project directory
2. Render lean core doc templates
3. Create `plans/index.json`
4. Create `knowledge/index.json`
5. Write project `meta.json`
6. Update root DAG `meta.json`

### Plan creation

1. Validate project exists
2. Normalize `planId`, `status`, and `keywords`
3. Create `plans/{planId}/meta.json`
4. Create `plans/{planId}/plan.md`
5. Insert compact summary into `plans/index.json`

### Plan update

1. Read existing plan metadata
2. Apply requested updates
3. Rewrite `plans/{planId}/meta.json`
4. Sync corresponding record in `plans/index.json`
5. Update `updatedAt`

### Knowledge entry creation

1. Validate project exists
2. Normalize `entryId`, `kind`, and `keywords`
3. Create `knowledge/{entryId}/meta.json`
4. Create `knowledge/{entryId}/entry.md`
5. Insert compact summary into `knowledge/index.json`

### Knowledge entry update

1. Read existing entry metadata
2. Apply requested updates
3. Rewrite `knowledge/{entryId}/meta.json`
4. Sync corresponding record in `knowledge/index.json`
5. Update `updatedAt`

## Error Handling

Handle these cases explicitly:

- creating a duplicate `planId`
- creating a duplicate `entryId`
- referencing a missing project
- referencing a missing plan
- referencing a missing knowledge entry
- invalid status values
- invalid knowledge kind values
- malformed or duplicate keywords
- stale or corrupted `plans/index.json`
- stale or corrupted `knowledge/index.json`

When possible, keep both indexes derivable from per-item metadata so repair tooling can rebuild them later if needed.

If an index file is missing, stale, or corrupted:

- list and get operations should attempt to rebuild the index from per-item metadata directories
- successful rebuild should rewrite the canonical on-disk index file before returning
- if rebuild cannot complete because per-item metadata is also unreadable, the operation should fail with a descriptive error rather than returning partial silent data

## Testing Strategy

Add coverage for:

- lean template rendering during `init_project`
- creation of the `plans/` directory and `index.json`
- creation of the `knowledge/` directory and `index.json`
- creating a plan and syncing index metadata
- updating plan metadata and plan body
- creating a knowledge entry and syncing index metadata
- updating knowledge metadata and entry body
- keyword filtering behavior
- invalid status and duplicate plan validation
- invalid knowledge kind and duplicate entry validation
- project-scoped resource reads for plans
- project-scoped resource reads for knowledge entries
- lazy migration behavior for existing projects without `plans/`
- lazy migration behavior for existing projects without `knowledge/`
- automatic index rebuild behavior for missing or corrupted `plans/index.json`
- automatic index rebuild behavior for missing or corrupted `knowledge/index.json`

## Migration Notes

Existing projects may not have a `plans/` directory. The implementation should use lazy creation as the default migration strategy.

Rules:

- plain reads of existing core project docs do not create `plans/`
- the first plan create/update operation creates `projects/{slug}/plans/` and `plans/index.json` if missing
- project-scoped plan list reads on older projects should return an empty result shape equivalent to `{ "plans": [] }` without failing

Apply the same lazy strategy to structured knowledge:

- plain reads of existing core project docs do not create `knowledge/`
- the first knowledge create/update operation creates `projects/{slug}/knowledge/` and `knowledge/index.json` if missing
- project-scoped knowledge list reads on older projects should return an empty result shape equivalent to `{ "entries": [] }` without failing

This keeps rollout low-risk and avoids mandatory migration logic.

## Open Decisions Resolved

- Plans are project-scoped, not root-scoped
- Structured knowledge is project-scoped, not root-scoped
- Search happens per project, not globally
- Keywords are part of the schema and are exact-match filter tokens
- Plans are not a fifth top-level doc type
- Individual plans use separate `meta.json` and `plan.md` files
- Knowledge keeps `knowledge.md` as a summary doc but moves detailed entries into `knowledge/`
- Individual knowledge entries use separate `meta.json` and `entry.md` files

## Expected Outcome

After implementation:

- project initialization produces less verbose default content
- repeated project reads cost fewer tokens
- each project can store structured feature plans with searchable metadata
- each project can store structured knowledge entries with searchable metadata
- callers can use stable MCP routes to list, inspect, and update plan state without scanning large markdown files
- callers can use stable MCP routes to list, inspect, and update project knowledge without scanning a large `knowledge.md`
