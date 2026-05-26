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
    A[Orient: spoc context --lean --json] --> B[Search: spoc search slug keywords]
    B --> C[Inspect repo — patterns, types, fixtures]
    C --> D{Decisions resolved?}
    D -->|Yes| E[Implement — TDD for new behavior]
    D -->|No, inferable| E
    D -->|No, genuine ambiguity| F[Ask ONE targeted question]
    F --> E
    E --> G[Verify — tests, lint, build]
    G --> H{Complexity expanded?}
    H -->|No| I[Done]
    H -->|Yes| J[Pause — state issue — offer brainstorming]
```

## Behaviour

- Inspect repo before asking anything
- Proceed on inferred defaults when repo makes it clear
- Ask at most one targeted question (product direction, naming, breaking trade-off)
- TDD for new non-trivial behavior; skip for structural changes covered by existing tests
- Lightweight bullet plan only when 3+ files and sequencing matters

## NOT for

- Fully bounded, no decisions → `quick-dev`
- Unclear/creative/design-shaping → `brainstorming`
