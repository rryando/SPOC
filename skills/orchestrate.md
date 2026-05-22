---
name: orchestrate
description: Classify intent and route work across all SPOC workflows
---

> **Canonical source of truth:** the runtime orchestrator prompt lives in
> `src/prompts/spoc-orchestrate.ts` (`ORCHESTRATE_PROMPT_TEXT`). This skill
> file is a condensed user-facing summary for hosts that load skills by
> name. Keep this file consistent with the TS prompt; when they disagree,
> the TS prompt wins.

## When to Use

Use this skill when:
- The user request could map to multiple SPOC workflows
- You want one default entry point that decides init vs brainstorm vs execute vs sync vs explore
- The user asks for a multi-step flow like "create it, plan it, then start"

## How it Works

### 1) Intent classification
Classify each request into one intent:
- **INIT** — Track a new project
- **BRAINSTORM** — Plan tasks/architecture/dependencies
- **EXECUTE** — Perform the next concrete task
- **SYNC** — Reconcile docs with current reality
- **EXPLORE** — Inspect DAG/project state without mutating
- **MULTI** — Chain several intents in sequence

If ambiguous, ask one clarifying question. If clear, proceed directly.

### 2) Context loading tiers
Load only what each step needs. Do NOT front-load all docs for every request.
The orchestrator must NEVER read codebase files directly — use the DAG, then
delegate to explore sub-agents only when the DAG lacks the answer.

| Tier | What | When |
|------|------|------|
| **T0** | `resolve_project_context` | Always — session start. Contains overview, brief, focus, top knowledge, active plans. |
| **T1** | Single doc fetch (`get_project` with specific `doc`) | When a workflow step needs one specific doc |
| **T2** | Index listings (`list_project_plans`, `list_project_knowledge_entries`) | When discovering what plans/knowledge exist — metadata only |
| **T3** | Full body (`get_project_plan(includeBody)`, `get_project_knowledge_entry(includeBody)`) | Only when actively working with a specific plan or entry |
| **T4** | Multi-doc read | Only for SYNC or when cross-referencing docs — prefer delegating to sub-agents |

**Key principle:** T0 is usually sufficient for routing and task selection.
Escalate tiers on-demand. Never jump to codebase exploration before exhausting
DAG tiers T0–T3.

**CLI preference for T1–T2:** When the agent has bash access, prefer the SPOC CLI
for all read operations (T0–T3). It's faster and supports batch queries:
`node scripts/spoc-cli.mjs <command> [args]` — commands: `context`, `task`,
`search`, `plan`, `knowledge`, `diagram`, `batch`, `validate`. Fall back to
MCP tools when CLI is unavailable.

### 3) Information resolution order (Non-Negotiable)

Before any codebase exploration, follow this strict resolution order:

1. **DAG context (T0–T3)** — Project overview, knowledge entries, plans, tasks,
   dependencies. This is the primary source of truth and costs no context.
2. **Dispatch explore sub-agent** — ONLY when DAG lacks the needed information.
   Give the sub-agent a precise question, file scope, and expected output format.
   The orchestrator receives a concise summary, not raw file contents.
3. **Capture to DAG** — If the explore sub-agent returns durable information,
   persist it via `create_project_knowledge_entry` so the next session skips
   the exploration entirely.

**The orchestrator reads the DAG. Sub-agents read the codebase. Never the reverse.**

### 4) Sub-agent delegation
When the host has sub-agent capabilities (Task tool), **always** delegate
context-heavy work. The orchestrator must stay lean — its job is routing and
coordination, not holding implementation or exploration context.

| Situation | Delegate | Orchestrator keeps |
|-----------|----------|-------------------|
| **Any codebase read** (file contents, grep, git log) | Explore sub-agent with precise question | DAG context, routing decision |
| **Reference lookup** (how does X work, what pattern does Y use) | Explore sub-agent — check DAG knowledge first | Summary from sub-agent, persist if durable |
| EXPLORE across multiple projects | One sub-agent per project | Routing, aggregation, presentation |
| SYNC codebase re-scan | Explore sub-agent scans repo | Doc reconciliation, write operations |
| INIT codebase analysis | Analysis sub-agent reads code | Project creation, doc writes |
| EXECUTE implementation | Implementer sub-agent via skills | Task selection, status updates |
| MULTI independent phases | Dispatch in parallel | Sequencing, consolidated summary |

**Fallback (no sub-agents):** Proceed inline but rely on T0, fetch docs on-demand (T1), avoid full body reads (T3) unless actively executing.

### 5) Routing to workflow
Run the matching tool sequence:
- **INIT**: T0 context → `list_projects` → `init_project` → `update_project_doc` → delegate codebase analysis to sub-agent
- **BRAINSTORM**: T0 context → `list_project_plans` (T2) → planning → `create_project_plan` or `update_project_plan_body` → `update_project_doc` (tasks)
- **EXECUTE**: T0 context (operating brief) → select task → delegate implementation to sub-agent via work-mode skill → `update_project_doc`
- **SYNC**: T0 context → delegate codebase scan to explore sub-agent → audit docs on-demand → propose fixes → `update_project_doc`
- **EXPLORE**: T0 context (DAG first) → answer from DAG if possible → delegate codebase deep dives to explore sub-agents only if DAG insufficient → report
- **MULTI**: decompose → dispatch independent phases in parallel → consolidate

### 6) Work mode hints (EXECUTE only)
When routing to EXECUTE, annotate the selected task with a suggested work mode for the host agent:
- Fully bounded, no open decisions → `quick-dev`
- Mostly clear, 1-2 decisions resolvable from repo → `code-agent`
- New non-trivial feature with known criteria → `test-driven-development`
- Design direction unclear → reclassify as BRAINSTORM

This is informational — the host agent makes the final skill decision.

### 7) Completion contract
Always end with:
1. What was done
2. Current project state
3. Suggested next steps

### 8) Loop tools (self-referential development)

For long-running, iterative work that should continue until a completion
promise is emitted, use the SPOC loop tools rather than manually re-prompting:

- `spoc_start_project_loop` — Start a self-referential development loop for a
  project. Accepts a `prompt` (task description), `sessionId`, and optional
  `completionPromise` (default `DONE`), `maxIterations`, and `strategy`
  (`continue` to stay in the same session, `reset` to start fresh per
  iteration). The loop automatically re-prompts the agent when idle until the
  completion promise appears in output.
- `spoc_cancel_project_loop` — Cancel an active loop. Requires the current
  `sessionId` to match the loop's owning session.
- `spoc_get_project_loop_state` — Inspect loop state for a project, or search
  across all projects for any active loop when called without a slug.

Pair these tools with the `loop` skill, which documents the iteration
discipline (how to structure prompts for self-continuation, when to emit the
completion promise, how to handle idle detection). Prefer loops over manual
re-prompting whenever a task has a well-defined completion signal and
independent iteration steps.

## Tips

- Verbalize detected intent and plan before acting
- Keep users informed at phase transitions
- For doc updates, follow standard formats:
  - tasks: `[ ]` / `[/]` / `[x]` — execution queue state only, not full feature narratives
  - overview: concise summary + concrete goals
  - dependencies: upstream/downstream
  - knowledge.md: high-level project context and pointers
- For structured memory stores:
  - Use `create_project_plan` / `update_project_plan_body` for structured plans for feature work
  - Use `create_project_knowledge_entry` / `update_project_knowledge_body` for durable knowledge entries (lessons, gotchas, patterns, architecture, modules, feature notes)
  - Use `list_project_plans` / `list_project_knowledge_entries` to inspect plan and knowledge indexes
