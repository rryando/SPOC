---
name: architecture-review
description: Use when evaluating module boundaries, coupling, dependency direction, API surface cohesion, and structural fitness of a system or subsystem — produces a read-only architectural assessment with severity-ranked findings and SPOC handoff artifacts
---

# Architecture Review

Read-only structural audit of module boundaries, dependency graphs, API surfaces, and layering discipline. Produces a structured report; never edits code. Accepted findings hand off to SPOC as tasks, knowledge entries, or plans.

**Core principle:** Good architecture makes the system easy to change in the directions it is likely to change, and hard to change in directions that would break invariants. The review's job is to *find* where the current structure fights this — not fix it.

## When to Use

- **Before a major restructuring** — baseline the system's structural health so changes have clear targets
- **When adding a new module/boundary** — verify the proposed boundary makes sense given existing coupling
- **Cross-project dependency evaluation** — when SPOC projects share concerns or depend on each other
- **Periodic health check** — on any coherent subsystem (service, library, feature domain)

**Do NOT use for:**
- Feature-level code quality audit (use `auditing-a-feature`)
- General code review of a diff (use `requesting-code-review`)
- Debugging a specific failure (use `systematic-debugging`)
- Performance profiling, security review, or test coverage analysis (out of scope)

## SPOC CLI — Preferred for DAG Reads

For all DAG read operations, prefer the CLI over MCP tools. It's faster (no write-gate overhead) and supports batch queries in a single shell call.

**Usage:** `spoc <command> [args]`

**Available commands:**
- `context [<path>] --lean --json` — resolve project context from workspace path
- `task list <slug> [--status <s>] --json` — list tasks, optionally filtered
- `search <slug> "<query>" [--limit N] --json` — BM25 knowledge search
- `plan list <slug> [--status <s>] --json` — list plans
- `knowledge list <slug> [--kind <k>] --json` — list knowledge entries
- `diagram <slug> <planId> <action> --json` — inspect/ready/validate diagram
- `batch <json>` — batch operations in one call
- `validate <slug> --json` — validate project state

**Output:** JSON to stdout, errors to stderr. Parse with standard JSON tools.

**Rule:** CLI for reads, MCP for writes (task transitions, knowledge creation, plan updates require write-gates).

**Prerequisite:** `dist/` must be current (`npm run build` if stale).

## The Iron Law

```
READ ONLY. NEVER EDIT CODE DURING AN ARCHITECTURE REVIEW.
```

The review produces a report. The report becomes SPOC artifacts (tasks / knowledge / plans). Execution of structural changes happens in a separate session under `code-agent` / `writing-plans` / `test-driven-development`.

**No exceptions:**
- Not for "trivial re-export cleanup"
- Not for "obvious circular import fix"
- Not for "while I'm here, let me move this file"
- Delete this temptation

## Scope Resolution (Mandatory First Step)

Before reading any code, resolve what "the system under review" means.

**Prefer SPOC context:** Use `spoc context --lean --json` CLI (preferred) or `spoc_resolve_project_context` MCP fallback on the workspace path. Check the project overview, knowledge entries (kind `architecture` / `module`), and plans for existing structural documentation. This establishes the intended architecture against which you evaluate the actual.

**Cross-project check:** Use `spoc project list --json` CLI (preferred) or `spoc_list_projects` MCP fallback to identify dependency edges. If the system under review imports from or exports to other SPOC projects, note these boundaries explicitly. Use `spoc project get <slug> --json` CLI or `spoc_get_project` with `doc: "dependencies"` for each relevant project.

**Fall back to user-specified boundaries** if SPOC has nothing. Ask the user to name the modules, layers, or entry points.

**Determine review depth:**
- **Full** — all 6 dimensions, all modules in scope (default)
- **Focused** — user specifies 1-3 dimensions or a single boundary to evaluate

**State the final scope in the report.** List every module/directory audited. If you skipped a module in the starting set, say why.

## Audit Dimensions (All Six, Every Time)

Every review checks all six. Each dimension reports `checked / cleared / findings` — negative evidence matters. An empty dimension is a valid outcome, but "I didn't check" is not.

**Cleared dimensions must show their work.** A one-line "cleared" is not acceptable. For every cleared dimension, state: what specifically was looked for, what inspection was performed, and why the result is clean.

| # | Dimension | What to look for |
|---|-----------|------------------|
| 1 | **Module Boundaries** | Are module boundaries aligned with domain concepts? Do modules own their data, or reach into siblings? Are there "god modules" with too many responsibilities? Is there clear ownership of types/schemas? Boundary leaks (internal types exported, implementation details in public API). |
| 2 | **Dependency Direction** | Do dependencies flow from high-level to low-level (or via abstractions)? Circular dependencies (direct or transitive). Dependency on concrete implementations where an interface would decouple. Import paths that skip layers. Dependency fan-out (one module importing from too many). |
| 3 | **API Surface Cohesion** | Does each module's public API form a coherent, minimal contract? Unrelated exports bundled in one module. Overly broad interfaces (kitchen-sink modules). Inconsistent naming/patterns across sibling module APIs. Unnecessary public surface (internal helpers exported "just in case"). |
| 4 | **Coupling Analysis** | Afferent coupling (who depends on this module — fan-in). Efferent coupling (what this module depends on — fan-out). Instability metric (Ce / (Ca + Ce)). Shared mutable state. Temporal coupling (must call A before B). Data coupling vs. stamp coupling vs. control coupling. |
| 5 | **Layering Violations** | Are architectural layers respected? Does the persistence layer import from the UI layer? Do utilities depend on domain modules? Cross-cutting concerns bleeding into domain logic. Framework/library types leaking across boundaries. |
| 6 | **Evolution Fitness** | How well does this structure support likely changes? What is hard to change that should be easy? What is easy to change that should be hard (dangerous mutations too accessible)? Extension points vs. modification points. Feature isolation — can a feature be added/removed without shotgun surgery? |

## Cross-Project Dependency Check (Mandatory When Applicable)

When the system under review has SPOC dependency edges or imports from other workspace projects:

1. Use `spoc project list --json` CLI (preferred) or `spoc_list_projects` to map the full dependency graph
2. For each dependency edge, evaluate:
   - Is the dependency direction correct? (high-level → low-level)
   - Is the coupling tight or loose? (interface vs. concrete)
   - Are there shared concerns that should be extracted into a shared project?
   - Are there circular dependencies at the project level?
3. Check if sibling projects have parallel implementations of the same concern (`spoc knowledge search <slug> "<query>" --json` CLI preferred, or `spoc_search_project_knowledge` MCP fallback)

If no cross-project dependencies exist, state this explicitly and mark as cleared.

**Optional: Graphify-Enhanced Validation**
If `graphify-out/graph.json` exists in the workspace, use its fan-in/fan-out metrics and community clusters to cross-check manually identified architectural concerns. Do not substitute graphify output for the dimension-based audit — use it to validate findings.

## Severity Rubric (Use These Thresholds)

Assign severity deterministically:

- **Critical (structural risk)** — Circular dependencies that prevent independent deployment/testing, layering violations that make the system untestable, module boundaries so wrong that features require shotgun surgery across 5+ files, dependency direction violations that propagate breaking changes upstream.
- **Recommended (structural improvement)** — Coupling that slows development, cohesion problems that confuse developers, missing abstractions that force duplication, boundaries that don't match domain concepts, fan-out/fan-in imbalances.
- **Nice-to-have (structural hygiene)** — Minor API surface cleanup, naming inconsistencies across module boundaries, slightly leaky abstractions that don't cause real pain, cosmetic layering drift.

When a finding straddles two tiers, pick the higher one and justify in one sentence.

## Report Format (Required Structure)

```markdown
# Architecture Review: <system/subsystem name>

## Scope
- Modules reviewed: <list of modules/directories>
- Cross-project dependencies: <SPOC project edges, or "none">
- Intended architecture: <from SPOC knowledge/overview, or stated by user>
- Review depth: <full | focused on dimensions X, Y>
- Explicitly excluded: <modules skipped and why>

## Out of Scope
This review does NOT cover: feature-level code quality, performance,
security, test coverage, individual function correctness.

## Severity Summary
| Severity | Count | Handoff |
|----------|-------|---------|
| Critical (structural risk) | N | [plan] |
| Recommended (structural improvement) | N | [task] or [plan] |
| Nice-to-have (structural hygiene) | N | [knowledge] or [task] |

### Critical
- `[boundaries]` <one-line finding> → [plan]
- `[dependency-direction]` <one-line finding> → [plan]

### Recommended
- `[coupling]` <one-line finding> → [task]
- `[cohesion]` <one-line finding> → [task]

### Nice-to-have
- `[layering]` <one-line finding> → [knowledge]

## Dimension Details

### 1. Module Boundaries — <findings | cleared>
Boundary inventory: <modules with their stated responsibility>
- <finding with module/file references, severity, suggested structural change, handoff tag>

### 2. Dependency Direction — <findings | cleared>
Dependency graph summary: <high-level flow direction>
Circular dependency check: <performed, results>
- ...

### 3. API Surface Cohesion — <findings | cleared>
Public API inventory: <module → export count, cohesion assessment>
- ...

### 4. Coupling Analysis — <findings | cleared>
Metrics (where calculable): <fan-in, fan-out, instability per module>
- ...

### 5. Layering Violations — <findings | cleared>
Layer map: <identified layers from top to bottom>
Cross-layer imports found: <yes/no, details>
- ...

### 6. Evolution Fitness — <findings | cleared>
Likely change vectors: <what this system will probably need to do next>
Structural support for those changes: <good/poor, why>
- ...

## Cross-Project Analysis
- Dependencies evaluated: <project slug → direction, coupling style>
- Shared concerns identified: <any, or "none">
- Project-level circular dependencies: <any, or "none">

## SPOC Handoff Proposal
- **Tasks:** <list of [task]-tagged findings, ready for `spoc_create_project_task`>
- **Knowledge entries:** <list of [knowledge]-tagged findings, kind: architecture>
- **Plans:** <list of [plan]-tagged multi-step restructurings, ready for `spoc_create_project_plan`>

## Confidence & Gaps
- What I was confident about: ...
- What I was unsure about (needs team input): ...
- What I did not check and should be reviewed separately: ...
```

## Handoff Tags

Every finding carries a handoff tag indicating how it becomes a SPOC artifact:

- `[task]` — Single bounded structural change (move a file, extract an interface, break one circular import). Becomes one SPOC task.
- `[knowledge]` — Durable architectural observation (a boundary decision, a coupling pattern, a layering rule). Becomes a knowledge entry with kind `architecture` or `pattern`.
- `[plan]` — Multi-step restructuring affecting multiple modules or requiring a migration sequence. Becomes a proposed SPOC plan.

## Dual-Mode Operation

This skill works in two modes depending on agent capabilities:

**Mode A — Direct SPOC access (sub-agent has MCP tools):**
- Resolve context via `spoc context --lean --json` CLI (preferred) or `spoc_resolve_project_context`
- List projects via `spoc project list --json` CLI (preferred) or `spoc_list_projects`
- Search knowledge via `spoc knowledge search <slug> "<query>" --json` CLI (preferred) or `spoc_search_project_knowledge`
- After user approval, write artifacts directly via `spoc_create_project_task`, `spoc_create_project_knowledge_entry`, `spoc_create_project_plan`

**Mode B — Artifact return (sub-agent returns to orchestrator):**
- Include all SPOC tool calls as structured proposals in the report
- Format proposals so orchestrator can copy-paste arguments into tool calls
- Include proposed `sourceFiles`, `keywords`, `priority`, `status` for each artifact

In both modes: never write to SPOC during the review itself — only propose. User (or orchestrator) chooses which to persist.

## Red Flags — STOP and Restart

- Editing code during the review
- Skipping a dimension without saying so
- Reporting dependency direction findings without tracing the actual import graph
- Reporting boundary findings without checking the module's public exports
- Not consulting SPOC project overview / knowledge for intended architecture
- Flat list of findings with no severity summary
- No "cleared" dimensions reported — you almost certainly skipped checking
- Expanding scope past stated boundaries without explicit justification
- Writing to SPOC before user reviews the report
- Ignoring cross-project dependencies when they exist

**All of these mean: stop. Restart the relevant section.**

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "All 6 dimensions is overkill for this subsystem" | Subsystem is small → review is fast. Skip nothing. |
| "I can tell there are no circular deps without tracing imports" | You can't. Trace them. |
| "The intended architecture isn't documented anywhere" | Flag that as a `[knowledge]` meta-finding. Still evaluate what exists. |
| "I'll just move this one file while I'm here" | No. Read-only. Put it in the report as `[task]`. |
| "Cross-project check doesn't apply, these are internal modules" | If modules could be separate packages/projects, the analysis still applies at module level. |
| "Coupling metrics are academic" | Fan-in/fan-out are concrete. Count them. High instability in stable modules is a finding. |
| "Evolution fitness is speculative" | Ask: what changed in the last 3 months? Would the structure have made it easy or hard? That's evidence. |
| "This boundary is fine, everyone knows not to cross it" | Undocumented conventions erode. If it matters, it should be in AGENTS.md or SPOC knowledge. Flag as `[knowledge]`. |

## Integration with Other Skills

- **Before review:** resolve SPOC context. If the system's architecture isn't documented and should be, flag that as a `[knowledge]` meta-finding.
- **After review:** user reviews report, approves findings, then:
  - `[task]` items → `spoc_create_project_task`
  - `[knowledge]` items → `spoc_create_project_knowledge_entry` (kind: `architecture` or `pattern`)
  - `[plan]` items → `spoc_create_project_plan` (status: `proposed`)
- **For actual restructuring execution:** a separate session under `code-agent` (bounded restructure), `writing-plans` (multi-step migration), or `test-driven-development` (restructure with safety net).
- **Pairs with `auditing-a-feature`:** architecture review evaluates structure between modules; feature audit evaluates code within a module. Run architecture review first when both are needed.

## The Bottom Line

The review's value is in the **structural coverage guarantee** (all 6 dimensions, cross-project checks, intended-vs-actual comparison) and the **handoff structure** (severity summary, handoff tags, SPOC mapping). A flat list of "this module is too big" observations is not an architecture review.
