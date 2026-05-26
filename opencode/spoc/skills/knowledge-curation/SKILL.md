---
name: knowledge-curation
description: Use when auditing SPOC knowledge entries for staleness, duplication, taxonomy drift, discoverability gaps, and coverage completeness. Periodic maintenance skill for the spoc-docs sub-agent.
---

# Knowledge Curation

Read-and-repair audit for a project's SPOC knowledge base. Produces a structured report and optionally executes fixes via SPOC CLI. Ensures knowledge entries remain findable, accurate, and non-redundant.

**Core principle:** Keep knowledge lean, accurate, and discoverable. Stale knowledge actively misleads agents. Duplicates fragment search results. Misclassified entries hide in the wrong filters.

## SPOC CLI

All DAG operations use the CLI. Reads are direct. Writes require a write-gate token:
```bash
TOKEN=$(spoc write propose "summary" --ops=<op> --slug=<slug> --json | jq -r .data.token)
spoc <mutating-command> --token=$TOKEN --json
```

**Available commands:**
- `spoc context [<path>] --lean --json` — project orientation
- `spoc task list <slug> [--status=<s>] --lean --json` — list tasks
- `spoc plan list <slug> [--status=<s>] --lean --json` — list plans
- `spoc knowledge list <slug> [--kind=<k>] --lean --json` — list knowledge entries
- `spoc knowledge search <slug> "<query>" --lean --json` — search knowledge
- `spoc project list --lean --json` — list all projects
- `spoc search <slug> "<query>" --lean --json` — cross-type search

**Output:** `{ok: true, data: {...}}` on success, `{ok: false, code: "...", message: "..."}` on failure.

**Discover all commands:** `spoc --commands --json`

**Verify SPOC is available:** `spoc --version`

## The Iron Law

```
KNOWLEDGE MUST BE FINDABLE AND ACCURATE. STALE KNOWLEDGE IS WORSE THAN NO KNOWLEDGE.
```

An entry that references a deleted file, describes a pattern that no longer exists, or uses keywords no one searches for is not just useless — it's harmful. It wastes context, misleads agents, and erodes trust in the knowledge base.

**Corollary:** Delete confidently. An empty knowledge base with high trust is better than a full one with low trust.

## When to Use

- **Periodic maintenance** — scheduled knowledge base health checks (monthly or after sprints)
- **After major refactors** — file renames, module restructures, API changes that invalidate sourceFile refs
- **When knowledge search returns duplicates** — signal that entries have drifted into overlap
- **When `spoc validate <slug> --json` reports broken sourceFile refs** — immediate staleness signal
- **Before onboarding new contributors** — ensure knowledge base is trustworthy for newcomers
- **When a sub-agent reports "conflicting knowledge entries"** — taxonomy or duplication issue

**Do NOT use for:**
- Writing new knowledge entries from scratch (use `code-agent` or `brainstorming`)
- Auditing code quality (use `auditing-a-feature`)
- Debugging why a search isn't finding something (fix the entry directly with `quick-dev`)

## Dual Mode Operation

This skill works in two modes:

1. **Direct execution** — When the agent has bash/CLI access, perform fixes immediately after reporting (with write-gate tokens).
2. **Recommendation mode** — When producing a report for human review, output structured recommendations with exact CLI commands to execute.

State which mode you're operating in at the top of every report.

## Audit Dimensions (All Five, Every Time)

Every audit checks all five. Each dimension reports `checked / cleared / findings`. An empty dimension is valid; "I didn't check" is not.

| # | Dimension | What to look for |
|---|-----------|------------------|
| 1 | **Staleness** | sourceFiles referencing paths that no longer exist; summaries contradicting current code; anchors (function/class names) that were renamed or deleted; entries about removed features |
| 2 | **Duplication** | Multiple entries covering the same concept with different wording or keywords; overlapping scope between entries; entries that should be merged into one canonical entry |
| 3 | **Taxonomy** | Incorrect `kind` assignments (e.g., a `reference` that's actually a `gotcha`, a `pattern` that's really `architecture`); inconsistent kind usage across similar entries |
| 4 | **Discoverability** | Missing keywords that agents would search for; vague titles; summaries that don't contain searchable terms; entries that `spoc knowledge search <slug> "<query>" --json` would miss for obvious queries |
| 5 | **Completeness** | Important modules/patterns/gotchas not captured in knowledge; features with no corresponding entries; architectural decisions with no record; recurring agent mistakes that should be a `gotcha` |

## Procedure

### Step 1: Automated Staleness Check

Run `spoc validate <slug> --json` for the project. This gives immediate signal on broken sourceFile references. Record all broken refs.

### Step 2: Full Inventory

Run `spoc knowledge list <slug> --json` to get the complete list. Note total count, kind distribution, and keyword spread.

### Step 3: Per-Entry Inspection

For entries flagged by Step 1 (broken refs) and any entries with suspiciously generic titles/summaries, run `spoc knowledge get <slug> <entryId> --body --json`. Assess:

- Does the body match current code reality?
- Is the kind correct?
- Are keywords sufficient for discovery?
- Does this overlap with another entry?

### Step 4: Duplication Detection

Group entries by:
- Similar titles (fuzzy match)
- Overlapping keywords
- Same sourceFiles
- Same kind + similar summary

Flag groups of 2+ as potential duplicates.

### Step 5: Completeness Gap Analysis

Cross-reference knowledge entries against:
- Project overview (major modules mentioned but not in knowledge)
- Active plans (patterns discovered during planning but not captured)
- AGENTS.md patterns section (documented patterns without knowledge entries)
- sourceFiles across all entries (files heavily referenced vs. important files never referenced)

### Step 6: Graphify-Generated Entry Validation

Some knowledge entries are derived from graphify code-graph analysis. These entries often have keywords like `architecture-cluster`, `god-node`, `cross-module-coupling`, or `graphify` in their metadata.

**Detection:**
```bash
spoc knowledge search <slug> "graphify" --lean --json
spoc knowledge search <slug> "architecture-cluster" --lean --json
spoc knowledge search <slug> "god-node" --lean --json
```

**Drift indicators for graphify-derived entries:**
- `sourceFiles` reference paths that no longer exist in the codebase
- Module boundaries described in the entry no longer match actual import graph
- Connectivity metrics (fan-in/fan-out) have shifted significantly

**Refresh workflow (if graphify is available):**
1. Run `graphify extract <workspace>` to regenerate `graphify-out/graph.json`
2. Compare new graph output against existing knowledge entries
3. Flag entries where sourceFiles have moved or disappeared
4. Propose new entries for newly-detected patterns not yet captured

**If graphify is NOT available:** Validate graphify-derived entries manually by checking their `sourceFiles` against the current codebase. Flag any with broken references as potentially stale.

## Actions

For each finding, propose one of these actions:

| Action | When | CLI Command |
|--------|------|-------------|
| **Delete** | Entry is entirely stale, references removed code, provides no value | `spoc knowledge delete <slug> <entryId> --token=$TOKEN --json` |
| **Merge** | Two+ entries cover same concept; pick canonical, archive or delete others | `spoc knowledge update-body <slug> <entryId> --token=$TOKEN --json` + `spoc knowledge delete <slug> <otherId> --token=$TOKEN --json` |
| **Update refs** | sourceFiles broken but entry content still valid | `spoc knowledge update-meta <slug> <entryId> --token=$TOKEN --json` (new sourceFiles) |
| **Re-kind** | Entry assigned wrong kind | `spoc knowledge update-meta <slug> <entryId> --token=$TOKEN --json` (new kind) |
| **Add keywords** | Entry is valid but unsearchable for obvious queries | `spoc knowledge update-meta <slug> <entryId> --token=$TOKEN --json` (expanded keywords) |
| **Rewrite summary** | Summary is vague or doesn't contain searchable terms | `spoc knowledge update-meta <slug> <entryId> --token=$TOKEN --json` (new summary) |
| **Propose new entry** | Gap identified — important concept not captured | `spoc knowledge create <slug> --title="..." --kind=<kind> --token=$TOKEN --json` |

## Taxonomy Reference

Use these kind assignments consistently:

| Kind | Use for | NOT for |
|------|---------|---------|
| `lesson` | Hard-won insight from a mistake or unexpected behavior | General documentation |
| `gotcha` | Non-obvious trap that agents/devs repeatedly fall into | One-time bugs |
| `pattern` | Recurring code pattern to follow (the "how") | Architectural decisions |
| `architecture` | System-level design decisions and constraints (the "why") | Implementation details |
| `module` | What a module does, its boundaries, its API surface | Internal implementation notes |
| `feature` | User-facing feature behavior and integration points | Technical implementation |
| `reference` | Factual lookup info (config values, API shapes, env vars) | Opinions or guidelines |

## Report Format (Required Structure)

```markdown
# Knowledge Audit: <project slug>

**Mode:** Direct execution | Recommendation only
**Date:** <ISO date>
**Entries audited:** N total (N lesson, N gotcha, N pattern, ...)

## Health Summary

| Dimension | Status | Findings | Actions |
|-----------|--------|----------|---------|
| Staleness | findings/cleared | N | N deletes, N updates |
| Duplication | findings/cleared | N | N merges |
| Taxonomy | findings/cleared | N | N re-kinds |
| Discoverability | findings/cleared | N | N keyword additions |
| Completeness | findings/cleared | N | N proposed entries |

## 1. Staleness

### Broken sourceFile References
(from `spoc validate <slug> --json`)
- `entry-id`: path/that/no/longer/exists.ts → **action:** update ref to new/path.ts | delete entry

### Contradicted Content
- `entry-id`: summary says "uses Redis" but module switched to Postgres in <commit/PR> → **action:** rewrite body + summary

## 2. Duplication

### Merge Candidates
- **Group A:** `entry-1` + `entry-3` — both describe error handling patterns
  - Canonical: `entry-1` (more complete body)
  - Action: merge keywords from entry-3 into entry-1, delete entry-3

## 3. Taxonomy

### Misclassified Entries
- `entry-id`: currently `reference`, should be `gotcha` — describes a non-obvious trap, not factual lookup
  - Action: re-kind to `gotcha`

## 4. Discoverability

### Missing Keywords
- `entry-id`: title "Auth Flow" but missing keywords: ["authentication", "oauth", "token", "session"]
  - Action: add keywords

### Vague Summaries
- `entry-id`: summary "Some notes about the API" → rewrite to "REST API rate limiting configuration and retry behavior"

## 5. Completeness

### Coverage Gaps
- Module `src/services/billing/` — no knowledge entries, handles critical payment logic
  - Proposed: new `module` entry with sourceFiles, keywords ["billing", "payment", "stripe"]
- Pattern: all tools use write-gate tokens — no `pattern` entry documenting this
  - Proposed: new `pattern` entry

## Execution Plan

(Direct mode only — ordered list of CLI commands to execute)
1. `TOKEN=$(spoc write propose "Curation fixes" --ops=knowledge:update-meta,knowledge:delete --slug=<slug> --json | jq -r .data.token)`
2. `spoc knowledge update-meta <slug> <entryId> --source-files='[...]' --token=$TOKEN --json`
3. `spoc knowledge delete <slug> <entryId> --token=$TOKEN --json`
```

## Red Flags — STOP and Restart

- Deleting entries without checking if the concept is still valid (only the ref is broken)
- Merging entries without reading both bodies
- Proposing new entries that duplicate existing ones (check first!)
- Skipping the automated `spoc validate <slug> --json` step
- Changing kinds without consulting the taxonomy reference above
- Operating in direct execution mode without write-gate tokens
- Reporting "cleared" on a dimension without stating what was checked

**All of these mean: stop. Restart the relevant section.**

## Write-Gate Protocol (Direct Execution Mode)

All mutating operations require the write-gate flow:

1. `spoc write propose "summary" --ops=<operations> --slug=<slug> --json` — scope: list all operations you intend to perform
2. Extract token from response: `jq -r .data.token`
3. Pass `--token=$TOKEN` to each mutating CLI command

Batch related operations under a single proposal when possible (e.g., "merge entries A+B" = one proposal covering the meta update + delete).

## Integration with Other Skills

- **After knowledge audit:** findings may trigger `auditing-a-feature` (if stale entries reveal code drift)
- **Completeness gaps:** may spawn `brainstorming` sessions to determine what knowledge to capture
- **Broken refs from refactors:** pair with `quick-dev` to update sourceFiles in bulk
- **Taxonomy disputes:** escalate to human; document decision as a `lesson` entry

## The Bottom Line

A knowledge base is a search engine for agents. Every entry must earn its place by being findable (keywords, title, summary), accurate (sourceFiles exist, content matches reality), and non-redundant (one canonical entry per concept). This audit ensures that contract is maintained.
