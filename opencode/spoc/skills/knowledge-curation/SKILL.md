---
name: knowledge-curation
description: Use when auditing SPOC knowledge entries for staleness, duplication, taxonomy drift, discoverability gaps, and coverage completeness. Periodic maintenance skill for the spoc-docs sub-agent.
---

# Skill: Knowledge Curation

## When

Periodic audit of a project's knowledge base, after major refactors, or when agents report duplicates/conflicts.

> CLI Primer: `spoc --commands --json` for discovery. Mutating commands run directly — no token.

## Flow

```mermaid
flowchart TD
    A[spoc validate slug --json] --> B[Record broken sourceFile refs]
    B --> C[spoc knowledge list slug --json]
    C --> D[Note count, kind distribution, keyword spread]
    D --> E[Per-entry inspection]
    E --> F{Entry assessment}
    F -->|broken refs, content valid| G[Update refs]
    F -->|entirely stale| H[Delete]
    F -->|overlaps another entry| I[Merge into canonical]
    F -->|wrong kind| J[Re-kind]
    F -->|valid but unsearchable| K[Add keywords / rewrite summary]
    F -->|ok| L[Keep]
    G & H & I & J & K & L --> M{More entries?}
    M -->|yes| E
    M -->|no| N[Completeness gap analysis]
    N --> O[Cross-ref against overview, plans, AGENTS.md]
    O --> P[Propose new entries for gaps]
    P --> Q[Produce audit report]
```

## Per-Entry Decision

```mermaid
flowchart TD
    A[Read entry body + meta] --> B{sourceFiles exist?}
    B -->|no| C{Content still valid concept?}
    C -->|yes| D[Update refs to current paths]
    C -->|no| E[Delete]
    B -->|yes| F{Summary matches reality?}
    F -->|no| G[Rewrite body/summary]
    F -->|yes| H{Duplicates another entry?}
    H -->|yes| I[Merge — keep more complete one]
    H -->|no| J{Kind correct per taxonomy?}
    J -->|no| K[Re-kind]
    J -->|yes| L{Discoverable for obvious queries?}
    L -->|no| M[Add keywords]
    L -->|yes| N[Keep as-is]
```

## Staleness Heuristics

**Time-based:**
- Entry older than 3 months + no linked task activity → suspect
- sourceFiles modified since entry's `updatedAt` → content may be outdated

**Content-based:**
- References deleted files, renamed functions, or removed modules
- Describes patterns contradicted by current code
- Uses terminology the project has since abandoned

**Graphify-derived entries** (keywords contain `graphify`, `architecture-cluster`, `god-node`):
- Validate sourceFiles against current codebase
- If graphify available: re-run `graphify extract` and compare

## Merge vs Archive Decision

| Signal | Action |
|--------|--------|
| Two entries same concept, one more complete | Merge keywords into complete one, delete other |
| Two entries same concept, different angles both valuable | Consolidate into single entry with both perspectives |
| Entry outdated but historically interesting | Delete — knowledge base is for current state, not history |
| Entry partially stale (some refs broken, some valid) | Update: fix refs, trim stale sections, keep valid content |

## Taxonomy Reference

| Kind | Use for | NOT for |
|------|---------|---------|
| `lesson` | Hard-won insight from mistakes | General docs |
| `gotcha` | Non-obvious recurring trap | One-time bugs |
| `pattern` | Recurring code pattern (the "how") | Architectural decisions |
| `architecture` | System-level design decisions (the "why") | Implementation details |
| `module` | Module boundaries and API surface | Internal implementation |
| `feature` | User-facing behavior and integration | Technical implementation |
| `reference` | Factual lookup (config, API shapes, env vars) | Opinions or guidelines |

## Audit Dimensions (check ALL five)

| # | Dimension | Signal |
|---|-----------|--------|
| 1 | Staleness | Broken refs, contradicted content |
| 2 | Duplication | Overlapping scope, similar titles/keywords |
| 3 | Taxonomy | Wrong kind assignment |
| 4 | Discoverability | Missing keywords, vague titles |
| 5 | Completeness | Important concepts with no entry |

## Constraints

- Always run `spoc validate` first — never skip automated staleness check
- Never delete without checking if the concept (not just the ref) is still valid
- Never merge without reading both bodies
- Never report "cleared" without stating what was checked
- Delete confidently: empty + trusted > full + unreliable
- Group related mutations into a single `spoc batch` invocation
- Two modes: direct execution (run mutating commands) or recommendation-only (CLI commands in report)
- Taxonomy disputes → escalate to human, document decision as `lesson`
