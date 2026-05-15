---
name: to-diagram
description: Use when creating or updating a Mermaid diagram in a SPOC plan body — selecting dialect, encoding task status via classDef, placing the diagram section, and detecting or resolving diagram/metadata drift.
---

# To-Diagram

## Overview

Generate and maintain Mermaid diagrams as supplementary visual companions to SPOC plan bodies. The diagram communicates plan structure and task status at a glance. Prose, metadata, and task status remain authoritative — the diagram is always derived from them.

## When to Use

- Creating a new SPOC plan body (called from writing-plans skill)
- Adding a visual layer to an existing plan
- Updating diagram node status after task status changes in metadata
- Auditing diagram vs metadata drift during SYNC workflow

## Dialect Selection

Pick dialect based on the primary structure of the plan:

| Use case | Dialect |
|----------|---------|
| Task dependency graph (what to build, in what order) | `flowchart TD` + classDef |
| Feature lifecycle phases (macro: Draft → Spec → Build → Shipped) | `stateDiagram-v2` |
| Entity/data lifecycle inside a feature (state machines, order states) | `stateDiagram-v2` |

**Rule of thumb:** If the diagram is primarily about tasks and their dependencies, use `flowchart TD`. If it is primarily about states and transitions, use `stateDiagram-v2`.

**Tiebreaker:** When a plan has both task dependencies AND lifecycle phases, prefer `flowchart TD` for work/implementation plans and `stateDiagram-v2` for entity/order state machines. Default to `flowchart TD` when uncertain.

## classDef Status Conventions (flowchart TD only)

Always declare these four classes at the top of every `flowchart TD` diagram:

```
classDef done fill:#22c55e,color:#fff
classDef inProgress fill:#f59e0b,color:#fff
classDef blocked fill:#ef4444,color:#fff
classDef backlog fill:#94a3b8,color:#fff
```

Assign status to nodes via `:::className` suffix:

```
A[Design schema]:::done --> B[Build API]:::inProgress
B --> C[Build UI]:::backlog
B --> D[Write tests]:::backlog
D --> E[Deploy]:::blocked
```

**At plan creation time, all nodes start as `:::backlog`.** The diagram is a structural sketch — status encoding activates as work progresses.

### Node Labeling

- Node labels should match task titles from the plan
- If label exceeds ~40 characters, truncate to a readable short form
- Use consistent style within a diagram (all verb phrases or all noun phrases)
- For `stateDiagram-v2`, state names should be PascalCase descriptors

### Color Compatibility

These hex colors are from the Tailwind CSS palette. They render correctly on GitHub, GitLab, and standard Mermaid renderers. If colors fail on a specific renderer, substitute Mermaid's standard color names.

## Placement Rule

The `## Diagram` section goes immediately after `## Overview` in the plan body:

```
## Overview
[1-2 sentence plan summary]

## Diagram
[mermaid block]

## Phases / Tasks
[detailed task breakdown]
```

One diagram per plan. Do not add per-phase diagrams.

## Update vs Regenerate

Decision tree:

1. **Status-only update:** Task metadata shows different status, but all task names, counts, and dependencies unchanged → surgical update (`:::className` only)
2. **Scope change:** Task added, removed, or renamed; any dependency edge added/removed → full regeneration from current plan structure, then apply current status classes
3. **Mixed update:** If ANY scope change happened alongside status changes → treat as regeneration (scope takes priority)

| Trigger | Action |
|---------|--------|
| Task status changes | Update `:::className` assignments only — topology unchanged |
| New tasks added | Regenerate full diagram from current plan structure |
| Tasks removed | Regenerate full diagram from current plan structure |
| Dependencies reordered | Regenerate full diagram from current plan structure |
| Scope change | Regenerate full diagram from current plan structure |
| Status + scope together | Regenerate (scope takes priority) |

**Surgical update (status only):** Change `:::backlog` to `:::inProgress` on the relevant node. Nothing else changes.

**Regeneration:** Rebuild the full `flowchart TD` or `stateDiagram-v2` block from scratch based on current plan task list and dependencies.

## Drift Detection and Resolution

Four types of drift:

1. **classDef mismatch** — node has wrong status class vs metadata
2. **Phantom node** — diagram has a node with no corresponding task in metadata
3. **Missing node** — metadata has a task with no corresponding diagram node
4. **Topology mismatch** — diagram edges don't match task dependency metadata

All four types → regenerate from metadata. Never patch metadata to match the diagram.

**During SYNC workflow:** Check every node and edge against task metadata. Flag any of the four drift types. Regenerate the diagram block and update the plan body via `update_project_plan_body`.

## Scalability

- Plans with 15+ nodes: consider clustering into `subgraph` blocks by phase
- If diagram becomes unreadable, the plan may need splitting into sub-plans

```mermaid
flowchart TD
    classDef done fill:#22c55e,color:#fff
    classDef backlog fill:#94a3b8,color:#fff

    subgraph Phase1[Phase 1: Foundation]
        A[Design schema]:::done --> B[Build API]:::done
    end
    subgraph Phase2[Phase 2: Features]
        C[Build UI]:::backlog --> D[Add search]:::backlog
    end
    Phase1 --> Phase2
```

## Examples

### flowchart TD — Task Dependency Graph

```mermaid
flowchart TD
    classDef done fill:#22c55e,color:#fff
    classDef inProgress fill:#f59e0b,color:#fff
    classDef blocked fill:#ef4444,color:#fff
    classDef backlog fill:#94a3b8,color:#fff

    A[Design schema]:::done --> B[Build API]:::inProgress
    B --> C[Build UI]:::backlog
    B --> D[Write tests]:::backlog
    C --> E[Deploy]:::backlog
    D --> E
```

### stateDiagram-v2 — Feature Lifecycle (macro)

```mermaid
stateDiagram-v2
    [*] --> Draft
    Draft --> Spec
    Spec --> Build
    Build --> Review
    Review --> Shipped
    Review --> Build : revisions

    state Build {
        Schema --> API
        API --> UI
    }
```

### stateDiagram-v2 — Entity Lifecycle (micro)

```mermaid
stateDiagram-v2
    [*] --> Pending
    Pending --> Processing
    Processing --> Completed
    Processing --> Failed
    Failed --> Processing : retry
    Completed --> [*]
```
