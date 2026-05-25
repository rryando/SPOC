---
name: auditing-a-feature
description: Use when a feature, module, or user/data flow is about to be refactored or has just been completed pre-merge, to guard against code bloat, redundancy across modules, KISS/SOLID drift, and convention drift
---

# Auditing a Feature

Read-only guardrail audit for a slice of the codebase (a feature, module, user flow, or data flow). Produces a structured report; never edits code. Accepted findings hand off to SPOC as tasks, knowledge entries, or plans.

**Core principle:** Keep code lean and straightforward. Redundancy, over-engineering, dead code, and convention drift are the enemy. The audit's job is to *find* them, not fix them.

## When to Use

- **Before a major refactor** — baseline the slice's health so the refactor has a target
- **After feature completion, pre-merge** — catch bloat and drift before it ships
- **On request** for any coherent slice — feature, module, user flow, or data flow

**Do NOT use for:**
- General code review of a diff (use `requesting-code-review`)
- Debugging a specific failure (use `systematic-debugging`)
- Verifying correctness before claiming done (use `verification-before-completion`)
- Performance profiling, security review, or test coverage analysis (out of scope)

## SPOC CLI — Preferred for DAG Reads

For all DAG read operations, prefer the CLI over MCP tools. It's faster (no write-gate overhead) and supports batch queries in a single shell call.

**Usage:** `spoc <command> [args]`

**Available commands:**
- `context [<path>]` — resolve project context from workspace path
- `task <slug> [--status <s>]` — list tasks, optionally filtered
- `search <slug> <query> [--limit N]` — BM25 knowledge search
- `plan <slug> [--status <s>]` — list plans
- `knowledge <slug> [--kind <k>]` — list knowledge entries
- `diagram <slug> <planId> <action>` — inspect/ready/validate diagram
- `batch <json>` — batch operations in one call
- `validate <slug>` — validate project state

**Output:** JSON to stdout, errors to stderr. Parse with standard JSON tools.

**Rule:** CLI for reads, MCP for writes (task transitions, knowledge creation, plan updates require write-gates).

**Prerequisite:** `dist/` must be current (`npm run build` if stale).

## The Iron Law

```
READ ONLY. NEVER EDIT CODE DURING AN AUDIT.
```

The audit produces a report. The report becomes SPOC artifacts (tasks / knowledge / plans). Execution of fixes happens in a separate session under `quick-dev` / `code-agent` / `test-driven-development`.

**No exceptions:**
- Not for "trivial unused imports"
- Not for "obvious dead code"
- Not for "while I'm here"
- Delete this temptation

## Scope Resolution (Mandatory First Step)

Before reading any code, resolve what "the slice" means.

**Prefer SPOC `sourceFiles`:** If the slice is tracked in a SPOC plan or knowledge entry with `sourceFiles`, those are the starting set. Use `spoc context --audience=implementer --lean --json` CLI (preferred) or `spoc_resolve_project_context` MCP fallback on the workspace path and look for plans/knowledge matching the slice name.

**Fall back to user-specified files** if SPOC has nothing. Ask the user to name files, modules, or entry points.

**Expand surface area one hop:** Follow imports/exports **one level out** from the starting set to capture direct collaborators (types, helpers, tests). Do not expand further — audits drift when they follow dependencies infinitely.

**State the final scope in the report.** List every file audited. If you skipped a file in the starting set, say why.

## Audit Dimensions (All Seven, Every Time)

Every audit checks all seven. Each dimension reports `checked / cleared / findings` — negative evidence matters. An empty dimension is a valid outcome, but "I didn't check" is not.

**Cleared dimensions must show their work.** A one-line "cleared" is not acceptable — it lets agents rubber-stamp. For every cleared dimension, state at least: what specifically was looked for, what search/inspection was performed, and why the result is clean. If you cannot state this in a sentence, you did not actually check.

| # | Dimension | What to look for |
|---|-----------|------------------|
| 1 | **Redundancy** | Duplicated logic across modules, parallel implementations, copy-paste patterns. **Must include cross-module grep:** before flagging something as novel, search the repo for existing helpers/utilities solving the same concern. |
| 2 | **KISS violations** | Unnecessary abstraction, premature generalization, over-engineered indirection, dead flexibility (unused config, flags, params, generic type params) |
| 3 | **SOLID violations** | SRP (modules doing too much), DRY-adjacent issues. Skip LSP/ISP/DIP unless they bite. |
| 4 | **Dead code** | Unused exports (check callers), unreachable branches, orphaned helpers, stale feature flags, unreferenced types |
| 5 | **Flow correctness** | Trace the happy path end-to-end. Flag confusing control flow, masked failures, silently-swallowed errors. **Not** general bug-hunting. |
| 6 | **Refactor surface** | Concrete, actionable refactor candidates. Cluster findings from other dimensions into proposed actions. |
| 7 | **Style / convention drift** | Compliance with AGENTS.md, project pattern docs (e.g. BE_CORE_PATTERNS.md), SPOC knowledge entries of kind `pattern` / `architecture`. Must consult these explicitly. |

## Cross-Module Redundancy Check (Mandatory)

The most common finding we miss: **we flag local duplication but not cross-module duplication.**

Before finalizing any finding about "this logic is duplicated" or "this helper could be extracted," run at least one of:
- `rg` / `grep` for key function names or distinctive string literals across the repo
- Search SPOC knowledge entries for related patterns (`spoc knowledge list <slug> --json` CLI preferred, or `spoc_list_project_knowledge_entries` MCP fallback)
- Check sibling directories for similarly-named utilities (`crypto.ts`, `http.ts`, `auth.ts`, etc.)

If you skipped this, say so explicitly in the report.

## Severity Rubric (Use These Thresholds)

Assign severity deterministically:

- **Critical (act before merge)** — correctness bugs, data loss risk, silently masked failures, security-adjacent drift (auth/crypto/secrets), or any finding where shipping it makes the feature user-visibly broken or unsafe.
- **Recommended (cleanup sweep)** — redundancy, SOLID/KISS violations, non-trivial dead code, refactor surface that costs real maintenance time. Not broken today, will hurt tomorrow.
- **Nice-to-have** — style/convention drift, minor dead code (stale log line, unused import, one-off unused type), cosmetic consistency.

When a finding straddles two tiers, pick the higher one and justify in one sentence.

## Report Format (Required Structure)

```markdown
# Audit: <slice name>

## Scope
- Starting set: <files from SPOC / user>
- Expanded (one hop): <additional files>
- Explicitly excluded: <files skipped and why>

## Out of Scope
This audit does NOT cover: performance, security review, test coverage,
architectural redesign, general bug-hunting.

## Severity Summary
| Severity | Count | Handoff |
|----------|-------|---------|
| Critical (act before merge) | N | [plan] or [task] |
| Recommended (cleanup sweep) | N | [task] |
| Nice-to-have | N | [knowledge] |

### Critical
- `[redundancy]` <one-line finding> → [task]
- `[flow]` <one-line finding> → [plan]

### Recommended
- `[kiss]` <one-line finding> → [task]

### Nice-to-have
- `[style]` <one-line finding> → [knowledge]

## Dimension Details

### 1. Redundancy — <findings | cleared>
Cross-module check performed: <yes, what was searched / no, why not>
- <finding with file:line, severity, suggested action, handoff tag>

### 2. KISS — <findings | cleared>
- ...

### 3. SOLID — <findings | cleared>
- ...

### 4. Dead code — <findings | cleared>
Caller-check performed: <yes / no>
- ...

### 5. Flow correctness — <findings | cleared>
Happy path traced: <entry point → ... → exit>
- ...

### 6. Refactor surface — <proposed consolidations | none>
- <cluster: combines findings X, Y, Z into "extract shared webhookHandler()">

### 7. Style / convention drift — <findings | cleared>
Convention sources consulted: <AGENTS.md, BE_CORE_PATTERNS.md, SPOC knowledge entry X>
- ...

## SPOC Handoff Proposal
- **Tasks:** <list of [task]-tagged findings, ready for `spoc_create_project_task`>
- **Knowledge entries:** <list of [knowledge]-tagged findings, kind suggestion>
- **Plans:** <list of [plan]-tagged multi-step refactors, ready for `spoc_create_project_plan`>

## Confidence & Gaps
- What I was confident about: ...
- What I was unsure about: ...
- What I did not check and should be re-run separately: ...
```

## Handoff Tags

Every finding carries a handoff tag indicating how it becomes a SPOC artifact:

- `[task]` — Small, actionable, single-file or single-concern cleanup. Becomes one SPOC task.
- `[knowledge]` — Durable observation about the codebase (a pattern, gotcha, or reference fact). Becomes a knowledge entry. Don't turn mechanical cleanups into knowledge.
- `[plan]` — Multi-step refactor affecting multiple files or requiring a sequence. Becomes a proposed SPOC plan.

User chooses which to persist. Do not write to SPOC during the audit itself — only propose.

## Red Flags — STOP and Restart

- Editing code during the audit
- Skipping a dimension without saying so
- Reporting findings without the cross-module redundancy check on redundancy findings
- Reporting findings without consulting AGENTS.md / pattern docs on style findings
- Flat list of findings with no severity summary
- No "cleared" dimensions reported — you almost certainly skipped checking
- Expanding scope past one hop of imports
- Writing to SPOC before user reviews the report

**All of these mean: stop. Restart the relevant section.**

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "All 7 dimensions is overkill for this slice" | Slice is small → audit is fast. Skip nothing. |
| "I can tell there's no dead code without checking callers" | You can't. Grep for references. |
| "AGENTS.md is generic, not worth consulting" | Convention drift compounds. Consult it. |
| "I'll just fix the unused import while I'm here" | No. Read-only. Put it in the report as `[task]`. |
| "The user said audit X, not X's imports" | Surface expansion one hop out is required. Ask if unsure about the specific file. |
| "Severity is subjective, I'll skip the summary" | Triage is the point. Pick severities, defend them briefly. |
| "This finding is trivial, no handoff tag needed" | Every finding gets a tag, even `[task]` for one-liners. |

## Integration with Other Skills

- **Before audit:** resolve SPOC context. If slice isn't tracked and should be, flag that as a `[knowledge]` meta-finding.
- **After audit:** user reviews report, approves findings, then:
  - `[task]` items → `spoc_create_project_task`
  - `[knowledge]` items → `spoc_create_project_knowledge_entry`
  - `[plan]` items → `spoc_create_project_plan` (status `proposed`)
- **For actual refactor execution:** a separate session under `quick-dev` (bounded), `code-agent` (1-2 open decisions), or `test-driven-development` (non-trivial).

## The Bottom Line

The audit's value is in the **coverage guarantee** (all 7 dimensions, cross-module checks, convention consultation) and the **handoff structure** (severity summary, handoff tags, SPOC mapping). A flat list of clever findings is not an audit.
