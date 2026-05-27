---
name: code-agent
description: Use when the task is mostly clear (50-90%) with one or two open decisions that can likely be resolved by inspecting the repo — not fully bounded, not a blank-slate design problem
---

# Skill: code-agent

## When

Task is mostly clear (50-90%) but 1-2 decisions remain open — resolvable by inspecting the repo.

## Flow

```mermaid
flowchart TD
    A[Orient: spoc brief --lean --json] --> K[Knowledge: spoc knowledge search slug keywords]
    K --> B[Search: spoc search slug keywords]
    B --> C[Inspect repo — patterns, types, fixtures]
    C --> D{Confidence score >=80?}
    D -->|Yes| E[Implement — TDD for new behavior]
    D -->|No, inferable| E
    D -->|No, genuine ambiguity| F[Ask ONE targeted question]
    F --> E
    E --> G[Verify — affected tests + lint on changed files]
    G --> H{Complexity expanded?}
    H -->|No| I[Done]
    H -->|Yes| J[Pause — state issue — offer brainstorming]
```

## Phase 0: Check Existing Knowledge

Before investigating or implementing, check what the DAG already knows:

```bash
spoc knowledge search <slug> "<task-keywords>" --lean --json
```

Look for:
- `kind: pattern` — existing conventions that apply to this change
- `kind: gotcha` — known traps in this area
- `kind: lesson` — prior learnings from similar work

If relevant entries exist, incorporate their guidance. Don't rediscover what's already known.

## Behaviour

- Inspect repo before asking anything
- Score self-confidence per `confidence-gate` before any code edit; <80% triggers explore/web recovery, not improvisation
- Proceed on inferred defaults when repo makes it clear
- Ask at most one targeted question (product direction, naming, breaking trade-off)
- TDD for new non-trivial behavior; skip for structural changes covered by existing tests
- Lightweight bullet plan only when 3+ files and sequencing matters
- Verify scoped: lint + test only files you touched (full suite only if change is pervasive — shared types, config, build)

## NOT for

- Fully bounded, no decisions → `quick-dev`
- Unclear/creative/design-shaping → `brainstorming`
