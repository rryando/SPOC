---
name: finishing-a-development-branch
description: Use when implementation is complete, all tests pass, and you need to decide how to integrate the work - guides completion of development work by presenting structured options for merge, PR, or cleanup
---

# Skill: finishing-a-development-branch

## When

Implementation complete, ready to integrate — verify tests, present options, execute choice, clean up.

> CLI: `spoc --commands --json`. Writes: `spoc write propose` → token → `--token`.

## Flow

```mermaid
flowchart TD
    A[Run test suite] --> B{Tests pass?}
    B -->|No| C[Report failures — STOP]
    B -->|Yes| D[Determine base branch]
    D --> E[Present 4 options]
    E --> F{User choice?}
    F -->|1. Merge locally| G[checkout base → pull → merge → test → delete branch]
    F -->|2. Create PR| H[push -u origin → gh pr create]
    F -->|3. Keep as-is| I[Report: keeping branch]
    F -->|4. Discard| J[Require typed 'discard' confirmation]
    J --> K{Confirmed?}
    K -->|No| E
    K -->|Yes| L[checkout base → branch -D]
    G & H & I & L --> M[Done]
```

## Strategy Quick Reference

| Option | Merge | Push | Cleanup Branch |
|--------|-------|------|----------------|
| 1. Merge locally | yes | - | yes |
| 2. Create PR | - | yes | - |
| 3. Keep as-is | - | - | - |
| 4. Discard | - | - | yes (force) |

## When to Choose Each Strategy

- **Merge locally** — Solo work, small feature, no review needed, fast-forward preferred
- **Create PR** — Team collaboration, needs review, CI required, want discussion record
- **Keep as-is** — Work-in-progress, waiting on dependency, want to revisit later
- **Discard** — Experimental spike that proved the wrong approach, superseded by different solution

## Constraints

- Never proceed with failing tests
- Never merge without verifying tests on the merged result
- Never delete work without typed "discard" confirmation
- Never force-push without explicit request
- Present exactly 4 options — no open-ended questions
- Always verify tests before offering options
