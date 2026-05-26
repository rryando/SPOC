---
name: dispatching-parallel-agents
description: Use when facing 2+ independent tasks that can be worked on without shared state or sequential dependencies
---

# Skill: dispatching-parallel-agents

## When

2+ independent tasks with no shared state that can run concurrently.

> CLI: `spoc --commands --json` for discovery. Mutating commands run directly — no token.

## Flow

```mermaid
flowchart TD
    A[Identify failures/tasks] --> B{Are they independent?}
    B -->|no — related| C[Single agent investigates all]
    B -->|yes| D{Outputs disjoint? No shared files?}
    D -->|no — would conflict| E[Sequential agents]
    D -->|yes| F{More than 4 agents needed?}
    F -->|no| G[Fan-out: 1 agent per domain]
    F -->|yes| H[Batch into rounds of ≤4]
    G --> I[Agents execute concurrently]
    H --> I
    I --> J[Collect results]
    J --> K{Conflicts between changes?}
    K -->|yes| L[Resolve conflicts manually]
    K -->|no| M[Run full test suite]
    M --> N[Integrate all changes]
```

## Agent Prompt Construction

Each agent gets exactly:

| Element | Required | Example |
|---------|----------|---------|
| **Scope** | ✓ | "Fix `agent-tool-abort.test.ts`" |
| **Goal** | ✓ | "Make these 3 tests pass" |
| **Context** | ✓ | Paste error messages, test names |
| **Constraints** | ✓ | "Don't change production code" |
| **Output format** | ✓ | "Return summary of root cause + changes" |

## Constraints

- Never dispatch agents that would edit the same files
- Each agent must be self-contained — no inherited session context
- Always run full test suite after integrating all agent results
- If failures are related (fix one might fix others), investigate together first
- Spot-check agent work — they can make systematic errors
- For exploratory debugging where you don't know what's broken, don't parallelize yet
