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
| **T0** | `spoc context [<path>] --lean --json` | Always — session start. Contains overview, brief, focus, top knowledge, active plans. |
| **T1** | Single doc fetch (`spoc project get <slug> --json`) | When a workflow step needs one specific doc |
| **T2** | Index listings (`spoc plan list <slug> --lean --json`, `spoc knowledge list <slug> --lean --json`) | When discovering what plans/knowledge exist — metadata only |
| **T3** | Full body (`spoc plan get <slug> <planId> --body --json`, `spoc knowledge get <slug> <entryId> --body --json`) | Only when actively working with a specific plan or entry |
| **T4** | Multi-doc read | Only for SYNC or when cross-referencing docs — prefer delegating to sub-agents |

**Key principle:** T0 is usually sufficient for routing and task selection.
Escalate tiers on-demand. Never jump to codebase exploration before exhausting
DAG tiers T0–T3.

**All DAG operations use the CLI.** Reads are direct. Writes require a write-gate token:
```bash
TOKEN=$(spoc write propose "summary" --ops=<op> --slug=<slug> --json | jq -r .data.token)
spoc <mutating-command> --token=$TOKEN --json
```

**Output:** `{ok: true, data: {...}}` on success, `{ok: false, code: "...", message: "..."}` on failure.

**Discover all commands:** `spoc --commands --json`

**Verify SPOC is available:** `spoc --version`

### 3) Information resolution order (Non-Negotiable)

Before any codebase exploration, follow this strict resolution order:

1. **DAG context (T0–T3)** — Project overview, knowledge entries, plans, tasks,
   dependencies. This is the primary source of truth and costs no context.
2. **Dispatch explore sub-agent** — ONLY when DAG lacks the needed information.
   Give the sub-agent a precise question, file scope, and expected output format.
   The orchestrator receives a concise summary, not raw file contents.
3. **Capture to DAG** — If the explore sub-agent returns durable information,
   persist it via `spoc knowledge create <slug> "<title>" --kind=<kind> --summary="..." --body="<markdown content>" --token=$TOKEN --json`
   so the next session skips the exploration entirely.

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
Run the matching CLI command sequence:
- **INIT**: T0 context → `spoc project list --json` → `spoc project init --token=$TOKEN --json` → `spoc project update-doc <slug> <doc> --token=$TOKEN --json` → delegate codebase analysis to sub-agent
- **BRAINSTORM**: T0 context → `spoc plan list <slug> --lean --json` (T2) → planning → `spoc plan create <slug> --title="..." --status=proposed --token=$TOKEN --json` or `spoc plan update-body <slug> <planId> --token=$TOKEN --json` → `spoc project update-doc <slug> tasks --token=$TOKEN --json`
- **EXECUTE**: T0 context (operating brief) → diagram-first task selection via \`spoc diagram ready <slug> <planId>\` → select ready node → delegate implementation to sub-agent via work-mode skill → \`spoc task transition <slug> <taskId> <status> --planId=<planId> --diagramNodeId=<nodeId> --token=$TOKEN --json\` → re-scan ready nodes
- **SYNC**: T0 context → delegate codebase scan to explore sub-agent → audit docs on-demand → propose fixes → `spoc project update-doc <slug> <doc> --token=$TOKEN --json`
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
promise is emitted, use the SPOC loop commands rather than manually re-prompting:

- `spoc loop start <slug> --prompt="<task description>" --max-iterations=50 --json` —
  Start a self-referential development loop for a project. Accepts optional
  `--completion-promise` (default `DONE`), `--strategy` (`continue` to stay in
  the same session, `reset` to start fresh per iteration). The loop automatically
  re-prompts the agent when idle until the completion promise appears in output.
- `spoc loop cancel <slug> --json` — Cancel an active loop.
- `spoc loop status <slug> --json` — Inspect loop state for a project.

Pair these commands with the `loop` skill, which documents the iteration
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
  - Use `spoc plan create <slug> --title="..." --token=$TOKEN --json` / `spoc plan update-body <slug> <planId> --token=$TOKEN --json` for structured plans for feature work
  - Use `spoc knowledge create <slug> "<title>" --kind=<kind> --summary="..." --body="<content>" --token=$TOKEN --json` for durable knowledge entries (lessons, gotchas, patterns, architecture, modules, feature notes)
  - Use `spoc plan list <slug> --lean --json` / `spoc knowledge list <slug> --lean --json` to inspect plan and knowledge indexes
