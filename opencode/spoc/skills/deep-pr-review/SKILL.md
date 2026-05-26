---
name: deep-pr-review
description: Use when the user provides a GitHub PR link with a "deep review" trigger inside a locally cloned repo, to perform a thorough multi-dimensional code review grounded in SPOC DAG context, AGENTS.md conventions, and optional graphify coupling analysis, then post findings as inline GitHub review comments under explicit user gate
---

# Skill: deep-pr-review

## When

User gives a GitHub PR URL plus a "deep review" trigger inside the locally cloned repo of that PR. Reviewer-side workflow: read-only by default, posts to GitHub only after explicit user gate.

> CLI: `spoc --commands --json` for discovery. Posting is user-gated. SPOC writes (optional knowledge harvest) run directly via the CLI.

## Flow

```mermaid
flowchart TD
    classDef bail fill:#ef4444,color:#fff

    A[User: 'deep review' + PR URL] --> B[gh repo view + gh pr view]
    B --> C{cwd repo == PR repo?}
    C -->|no| Z[Halt — wrong checkout]:::bail
    C -->|yes| D[gh pr diff + files + author + labels]
    D --> E[spoc context --audience=implementer --lean --json]
    E -->|found| F[Load AGENTS.md + targeted spoc search]
    E -->|missing| G[Degraded mode — heuristics only]
    F --> H{Prior AI review exists?}
    G --> H
    H -->|yes| I[Diff against prior review commit_id only]
    H -->|no| J[Use full PR diff]
    I --> K[Pick adaptive rubric from diff context]
    J --> K
    K --> L{Diff size?}
    L -->|huge >40 files OR >2000 lines| M[Force summary mode]
    L -->|normal| N{graphify available?}
    N -->|yes| O[Run affected/query on changed symbols]
    N -->|no| P[Skip coupling check — note in report]
    M --> Q[Aggregate findings + cite each]
    O --> Q
    P --> Q
    Q --> R[Present report + 5 posting modes]
    R --> S{User choice}
    S -->|don't post| END1[Show report only]
    S -->|post| T[gh api: review + inline comments]
    T --> U{Recurring pattern surfaced?}
    U -->|yes + opt-in| V[Propose knowledge:create]
    U -->|no| END2[Done]
    V --> END2
```

## Adaptive Rubric

Agent picks dimensions from diff context. **Correctness is always evaluated.** Other dimensions activate when the diff signals them:

| Dimension | Activates when |
|-----------|----------------|
| **Correctness** | Always — bugs, off-by-one, error handling, null safety |
| **DRY** | New code resembles existing patterns; cross-module grep finds duplicates |
| **KISS** | New abstraction layers, deep nesting, premature generalization |
| **SOLID** | Module gains responsibilities, dependency direction shifts, large classes touched |
| **Convention fit** | AGENTS.md or DAG `pattern`/`architecture` knowledge applies to changed files |
| **Architectural risk** → handoff `architecture-review` | Diff crosses module boundaries, touches god nodes, changes public API |
| **Performance risk** → handoff `performance-diagnosis` | Hot paths, loops over external IO, new queries, allocations in render |

Skipped dimensions are reported as `cleared (not applicable: <reason>)`. Never silently dropped.

## Severity Prefixes

Reuses `caveman-review` format for inline output:

| Prefix | Meaning | Posting default |
|--------|---------|-----------------|
| `🔴 bug:` | Broken behavior, will cause incident | Always post |
| `🟠 risk:` | Works but fragile, edge case unhandled | Always post |
| `🟡 suggestion:` | Concrete fix improving quality | Posted in modes 2/3 |
| `🔵 nit:` | Style / naming / minor consistency | Posted only in mode 3 |
| `❓ q:` | Genuine question for the author | Always post |

## Posting Modes

User picks one before any `gh` write:

| # | Mode | What posts |
|---|------|------------|
| 1 | **Critical-only** | 🔴 bug + 🟠 risk + ❓ q only |
| 2 | **Critical + actionable** | Above + 🟡 suggestion |
| 3 | **All findings** | Above + 🔵 nit |
| 4 | **Summary only** | Single top-level review body, no inline comments |
| 5 | **Don't post** | Show report only — no `gh` calls |

## Citation Rule

Every finding cites a source. No uncited findings:

- `see knowledge/<id>: <title>` — SPOC knowledge entry
- `AGENTS.md §<section>` — project convention
- `graphify: <observation>` — coupling/affected result
- `principle: <KISS|DRY|SOLID|correctness>` — first-principles label

If only first-principles applies, that is sufficient — but it must be stated.

## Inline Suggestion Rule

GitHub `​```suggestion` blocks render an "Apply suggestion" button. Use **only** when the fix is a one-to-few-line replacement of existing lines on the diff. For larger fixes:

- Multi-line code restructure → inline review comment with a fenced code block (no `suggestion` tag)
- Missing block / new file content → top-level review body bullet
- Cross-file refactor → handoff finding with `architecture-review` recommendation

## Iron Law

**READ ONLY until user picks a posting mode.** No `gh` writes, no SPOC writes, no auto-approve. Approval is only ever produced via explicit user override (`approve it`, `lgtm post approve`) — never inferred from finding count.

## Pre-Flight Gates

```mermaid
flowchart TD
    classDef bail fill:#ef4444,color:#fff

    A[gh repo view] --> B{cwd matches PR repo?}
    B -->|no| Z1[Halt — tell user to clone right repo]:::bail
    B -->|yes| C[gh pr view --json author,labels,reviews]
    C --> D{Label = wip/draft?}
    D -->|yes| E[Soften severity language — flag as 'WIP']
    D -->|no| F[Standard severity language]
    E --> G[Continue]
    F --> G
```

## Report Structure

```
# Deep PR Review: <repo>#<number> — <title>
## Pre-flight (repo match, PR state, prior reviews)
## Scope (files touched, LOC delta, modules affected)
## Rubric Selection (which dimensions activated, why)
## Findings (grouped by severity)
## Cleared Dimensions (with evidence)
## Architectural / Performance Handoffs (if any)
## Posting Plan (mode chosen → exact comments to be posted)
## Confidence & Gaps
```

## Constraints

- Never auto-approve; approval only on explicit user override
- Never post to GitHub before user picks a posting mode
- Cite every finding — no uncited claims
- ` ```suggestion ` blocks only for small line-replacement fixes
- Defer to `architecture-review` for full structural drift; surface as handoff flag, do not run inline
- Defer to `performance-diagnosis` for perf investigation; surface as risk flag
- Compose with `auditing-a-feature` rubric and `caveman-review` inline format — do not duplicate
- Re-review detection: if AI has reviewed before, scope to diff since last review's commit_id
- Tag each posted suggestion with `<!-- spoc:deep-review:<finding-id> -->` for re-review tracking
- See `review-template.md` for GitHub review body template
- See `graphify-diff.md` for the changed-symbols-to-affected algorithm
