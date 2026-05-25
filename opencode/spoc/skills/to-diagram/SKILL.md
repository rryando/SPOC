---
name: to-diagram
description: Use when creating or updating a Mermaid diagram for a SPOC plan — selecting dialect, encoding task status via classDef, managing the standalone .mmd file, and detecting or resolving diagram/metadata drift.
---

# To-Diagram

## Overview

Generate and maintain Mermaid diagrams as standalone `.mmd` files alongside SPOC plan bodies. Diagrams serve two audiences:

1. **Users** — visual plan structure rendered by the visual companion (brainstorming server) via Mermaid.js
2. **Agents** — agentic execution maps that enable task selection, sub-agent delegation, and sequencing decisions from the diagram alone without loading full plan prose

Diagrams are always **derived** from the canonical source of truth (see Canonical Source of Truth section). They are regenerated on drift. But they must be rich enough that an agent can dispatch a sub-agent for the next task using only the `.mmd` file content.

## Canonical Source of Truth

The diagram is never authoritative. The canonical source of truth for task structure is, in priority order:

1. **Structured task metadata** — if the plan uses SPOC structured tasks (`create_project_task` / `update_project_task`), those records are canonical for status, title, priority, and dependencies.
2. **Plan body task checkboxes** — if no structured tasks exist, the plan body's `- [ ]` / `- [/]` / `- [x]` checkboxes and their ordering define task state.
3. **Plan-level `%%` comments in the `.mmd` file** — these are a cache/orientation layer for agent efficiency. They are never authoritative and are overwritten during any update or regeneration.

When drift is detected, metadata always wins. The `.mmd` file is regenerated from canonical metadata, never the reverse.

## When to Use

- Creating a new SPOC plan body (called from brainstorming or writing-plans skill)
- Adding a visual layer to an existing plan
- Updating diagram node status after task status changes in metadata
- Auditing diagram vs metadata drift during SYNC workflow
- Agent entering a session needs quick orientation on plan state

## Execution Modes

### Mode Detection

- Agent can run `bash` commands and has file write access → **Agent-Direct Mode**
- Agent cannot → **Orchestrator Mode** (return artifact for orchestrator to write)

### Agent-Direct Mode

Agent has filesystem access + SPOC MCP tools. Workflow:

1. Draft diagram in `/tmp/<plan-id>.diagram.mmd` during composition
2. Validate with `manage-diagram.mjs validate /tmp/<plan-id>.diagram.mmd`
3. After write-gate confirmation, write final `.mmd` to DAG path directly
4. Use `manage-diagram.mjs` commands (`inspect`, `ready`, `status`) via bash tool
5. Update diagram status classes directly when transitioning tasks (via `manage-diagram.mjs status`)

### Orchestrator Mode (Artifact Return)

Agent generates `.mmd` content in memory. Returns diagram as a tagged text block in the final message:

```
---diagram-artifact---
planId: <plan-id>
nodeCount: N
readyNodes: [T001, T003]
blockedNodes: [T002]
---mmd---
<full .mmd file content>
---end---
```

Orchestrator receives the artifact and writes to `~/.spoc/projects/<slug>/plans/<plan-id>.diagram.mmd` after its own write-gate flow.

---

## Agent Consumption

Agents read `.mmd` files as structured plan summaries. The diagram is the **first artifact** an agent should read when entering a plan execution session. The goal is diagram-first execution: read `.mmd`, choose a ready node, use its rich metadata to dispatch a sub-agent without loading the full plan prose unless the node metadata is insufficient.

### Status Scan Protocol

1. **Status scan** — read `:::className` on each node to determine execution state (done/inProgress/blocked/backlog)
2. **Ready-to-execute detection** — identify `:::backlog` nodes whose ALL incoming edges come from `:::done` nodes. These are the next candidates for execution
3. **Parallelism inference** — nodes with no shared dependency edges can run concurrently
4. **Blocked identification** — `:::blocked` nodes or `:::backlog` nodes with `:::inProgress`/`:::backlog` predecessors cannot start yet
5. **Rich metadata read** — for each ready node, read its per-node `%%` comment block (see Rich Per-Node Metadata section) to obtain skill, scope, files, acceptance criteria, and verification commands
6. **Dispatch** — use the node metadata to construct a full sub-agent prompt (scope, goal, constraints, expected output) without reading the plan body

When updating diagrams, maintain both plan-level and per-node `%%` comments so future agents can parse status summaries and dispatch context without re-analyzing the full graph.

### Agent Efficiency Test

Diagram-first execution quality should be measured by:

- **Tokens before first dispatch** — how many tokens/reads the agent consumed before selecting and dispatching the first task. Target: `.mmd` file read only.
- **Time to choose next task** — from session start to task selection. Should require zero additional reads beyond the `.mmd` file.
- **Extra reads needed** — how many plan body or knowledge reads were needed beyond the `.mmd` file to construct the sub-agent prompt. Target: zero for well-annotated diagrams.
- **Dispatch quality** — does the dispatched sub-agent have correct skill, scope, verification command, and acceptance criteria from node metadata alone?
- **Completion success** — did the sub-agent succeed without needing follow-up clarification that could have been in the node metadata?

If an agent consistently needs to fall back to the plan body, the diagram's rich metadata is incomplete and should be upgraded during the next SYNC or scope-change regeneration.

## Creation Write-Gate Safety

Diagram drafts may be generated in memory or written to `/tmp` for preview during BRAINSTORM. The final `.mmd` file under the SPOC DAG path (`~/.spoc/projects/<slug>/plans/<plan-id>.diagram.mmd`) must be written **only after the user confirms the DAG write-gate**.

**Write-gate summary must include:**
- Diagram file path (e.g., `plans/<plan-id>.diagram.mmd`)
- Node count (total tasks in the diagram)
- Ready nodes (backlog nodes with all dependencies done)
- Blocked nodes (nodes that cannot start)
- Whether this is a **new** diagram or an **update** to an existing one
- For updates: what changed (status-only vs scope change)

**Sequence:**
1. Generate diagram content in memory or `/tmp/<plan-id>.diagram.mmd`
2. Present preview to user (via visual companion URL or inline Mermaid block)
3. Include diagram details in the write-gate summary
4. Write to DAG path only after user confirms

## Presentation

`to-diagram` is an INTERNAL skill — its conventions guide diagram generation but are never narrated to the user. Follow these rules:

- Do not explain dialect selection, classDef conventions, or node labeling rules to the user
- The user sees the rendered diagram (via visual companion URL or inline Mermaid block), not the generation process
- **Visual companion rendering:** read the `.mmd` file → write an HTML fragment to the visual companion project directory wrapping the Mermaid source with `<script type="module">` loading Mermaid.js from CDN → present the visual companion URL to the user
- When presenting a new diagram: "I've created a plan diagram showing [brief description]. Review it at [visual companion URL]" — or present the raw Mermaid block inline if no visual companion is available
- When presenting an update: "I've updated the plan diagram — [what changed]. Check [visual companion URL]"
- The skill load itself should be silent — no "Loading to-diagram skill..." messages

## Dialect Selection

Pick dialect based on the primary structure of the plan:

| Use case | Dialect |
|----------|---------|
| Task dependency graph (what to build, in what order) | `flowchart TD` + classDef |
| Feature lifecycle phases (macro: Draft → Spec → Build → Shipped) | `stateDiagram-v2` |
| Entity/data lifecycle inside a feature (state machines, order states) | `stateDiagram-v2` |

**Rule of thumb:** If the diagram is primarily about tasks and their dependencies, use `flowchart TD`. If it is primarily about states and transitions, use `stateDiagram-v2`.

**Tiebreaker:** When a plan has both task dependencies AND lifecycle phases, prefer `flowchart TD` for work/implementation plans and `stateDiagram-v2` for entity/order state machines. Default to `flowchart TD` when uncertain.

## classDef Status Conventions (flowchart TD only)

Always declare these four classes at the top of every `flowchart TD` diagram:

```
classDef done fill:#22c55e,color:#fff
classDef inProgress fill:#f59e0b,color:#fff
classDef blocked fill:#ef4444,color:#fff
classDef backlog fill:#94a3b8,color:#fff
```

Assign status to nodes via `:::className` suffix:

```
T001[Design schema]:::done --> T002[Build API]:::inProgress
T002 --> T003[Build UI]:::backlog
T002 --> T004[Write tests]:::backlog
T004 --> T005[Deploy]:::blocked
```

## Stable Node IDs

Node IDs must be **stable across renames, reorders, and regeneration**. They serve as the durable link between diagram nodes, structured task metadata, and plan body tasks.

**ID assignment rules:**
- Use `T001`, `T002`, `T003`, etc. as node IDs — sequential, zero-padded to 3 digits.
- If structured SPOC tasks exist (`create_project_task` IDs), use those canonical task IDs as node IDs instead.
- Once a node ID is assigned, it must never change even if the node is renamed or reordered.
- During regeneration, preserve existing node IDs for tasks that still exist. Assign new sequential IDs only for newly added tasks.
- Removed tasks: their IDs are retired, never reused within the same diagram.

**Why stability matters:** Agents, sub-agent prompts, and external references may cite node IDs (e.g., "implement T003"). If IDs shift on every regeneration, these references break silently.

**At plan creation time, all nodes start as `:::backlog`.** The diagram is a structural sketch — status encoding activates as work progresses.

### Node Labeling

- Node labels MUST be descriptive enough for agent comprehension — an agent reading only the diagram should understand what each task involves
- Use full task titles from the plan (e.g., "Build REST API endpoints" not "API", "Write unit tests for auth module" not "Tests")
- Include scope hints when the title alone is ambiguous (e.g., "Design database schema for orders" not "Design schema")
- If label exceeds ~50 characters, shorten to a readable form that preserves scope and intent
- Use consistent style within a diagram (all verb phrases or all noun phrases)
- For `stateDiagram-v2`, state names should be PascalCase descriptors

### Color Compatibility

These hex colors are from the Tailwind CSS palette. They render correctly on GitHub, GitLab, and standard Mermaid renderers. If colors fail on a specific renderer, substitute Mermaid's standard color names.

## File Convention

Diagrams are standalone `.mmd` files, not embedded in plan body markdown.

- **File path:** `plans/<plan-id>.diagram.mmd` (same directory as the plan body)
- **File format:** pure Mermaid syntax — no markdown wrapping, no ` ```mermaid ` fences
- **Plan body reference:** add `> Diagram: plans/<plan-id>.diagram.mmd` in the overview section of the plan body
- **Diagram header comment:** first line of the `.mmd` file must be `%% plan: <plan-id>`
- **One diagram file per plan.** Do not create per-phase diagram files.

## Mermaid Comments for Agent Context

Mermaid supports `%%` line comments. Use them to embed agent-readable metadata that doesn't render visually. There are two layers: **plan-level comments** (header) and **per-node metadata blocks**.

### Plan-Level Comments (Header)

```
%% plan: my-plan-id
%% status: T001=done, T002=done, T003=inProgress, T004=backlog, T005=blocked
%% ready: T004 (all deps done)
%% blocked: T005 (waiting on T003)
%% next-action: Start T004; T003 still in progress
```

**Rules:**
- First line: `%% plan: <plan-id>` linking back to the governing plan
- Include `%% status:` line listing all nodes and their current status
- Include `%% ready:` line listing backlog nodes whose dependencies are all done
- Include `%% blocked:` line listing nodes that cannot start and why
- Include `%% next-action:` line with a recommended next step
- Update comments on every surgical status update, not just regeneration
- Optional for plans with fewer than 6 nodes; recommended for 6+ nodes

### Rich Per-Node Metadata

For each node, include a comment block in a dedicated section between the plan-level header comments and the `flowchart TD` declaration. This metadata enables diagram-first execution — agents dispatch sub-agents using only this information.

**Format:**

```
%% node: T003
%% title: Build order management UI
%% status: backlog
%% skill: code-agent
%% scope: src/components/orders/, src/pages/orders/
%% files: src/components/orders/OrderList.tsx, src/components/orders/OrderDetail.tsx, src/pages/orders/index.tsx
%% acceptance: Order list renders with pagination; detail view shows order items and status history
%% verify: npm test -- --testPathPattern=orders && npm run typecheck
%% blocked-by: T002
%% delegate: yes
```

**Required fields:**
- `node` — the stable node ID (must match the node in the graph)
- `title` — full task title
- `status` — current status (done, inProgress, blocked, backlog)
- `skill` — recommended work-mode skill for the implementer (quick-dev, code-agent, test-driven-development, brainstorming)
- `scope` — directories or modules in scope for this task
- `acceptance` — what "done" looks like, stated as observable behavior

**Optional fields (include when known):**
- `files` — specific source files to create or modify (comma-separated)
- `verify` — exact shell command(s) to verify the task is complete
- `blocked-by` — node IDs this task depends on (comma-separated)
- `delegate` — whether this task should be dispatched to a sub-agent (yes/no; default yes)

**Placement:** Per-node metadata blocks appear in a dedicated section between the plan-level header comments and the `flowchart TD` declaration:

```
%% plan: order-system
%% status: T001=done, T002=inProgress, T003=backlog, T004=backlog, T005=blocked
%% ready: T003 (T001 done)
%% blocked: T005 (waiting on T003 and T004)
%% next-action: Start T003 (tests can begin once API shape is stable)

%% node: T001
%% title: Design database schema for orders
%% status: done
%% skill: quick-dev
%% scope: db/migrations/
%% files: db/migrations/001_orders.sql
%% acceptance: Migration runs without errors; orders table has all required columns
%% verify: npm run db:migrate && npm run db:validate

%% node: T002
%% title: Build REST API endpoints
%% status: inProgress
%% skill: test-driven-development
%% scope: src/api/orders/
%% files: src/api/orders/routes.ts, src/api/orders/handlers.ts, test/api/orders.test.ts
%% acceptance: CRUD endpoints for orders return correct status codes and payloads
%% verify: npm test -- --testPathPattern=api/orders
%% blocked-by: T001

%% node: T003
%% title: Write API integration tests
%% status: backlog
%% skill: test-driven-development
%% scope: test/integration/orders/
%% files: test/integration/orders/crud.test.ts
%% acceptance: Integration tests cover all order lifecycle transitions
%% verify: npm test -- --testPathPattern=integration/orders
%% blocked-by: T001

%% node: T004
%% title: Build order management UI
%% status: backlog
%% skill: code-agent
%% scope: src/components/orders/, src/pages/orders/
%% files: src/components/orders/OrderList.tsx, src/pages/orders/OrderDetail.tsx
%% acceptance: Order list renders with pagination; detail view shows order items
%% verify: npm test -- --testPathPattern=components/orders && npm run typecheck
%% blocked-by: T002

%% node: T005
%% title: Deploy to staging environment
%% status: blocked
%% skill: quick-dev
%% scope: infra/, .github/workflows/
%% files: infra/staging.tf, .github/workflows/deploy-staging.yml
%% acceptance: Staging deployment succeeds; smoke tests pass against staging URL
%% verify: npm run deploy:staging && npm run smoke:staging
%% blocked-by: T003, T004
%% delegate: yes

flowchart TD
    classDef done fill:#22c55e,color:#fff
    classDef inProgress fill:#f59e0b,color:#fff
    classDef blocked fill:#ef4444,color:#fff
    classDef backlog fill:#94a3b8,color:#fff

    T001[Design database schema for orders]:::done --> T002[Build REST API endpoints]:::inProgress
    T001 --> T003[Write API integration tests]:::backlog
    T002 --> T004[Build order management UI]:::backlog
    T002 --> T003
    T003 --> T005[Deploy to staging environment]:::blocked
    T004 --> T005
```

**Incomplete metadata:** Plans without rich per-node metadata remain valid. Missing metadata should be upgraded during the next SYNC or scope-change regeneration. Agents falling back to the plan body indicates the metadata needs enrichment.

## Syntax Validation

After writing or updating a `.mmd` file, validate:

1. All node IDs are unique within the diagram
2. All edges reference existing node IDs
3. All four `classDef` declarations are present (done, inProgress, blocked, backlog)
4. No unclosed brackets, quotes, or parentheses
5. `:::className` suffixes match one of the four declared classes

Invalid diagrams break visual companion rendering and agent parsing. If a Mermaid renderer is available, verify the diagram renders before writing the file.

## Bundled Diagram Management Script

A deterministic CLI tool is bundled at `scripts/manage-diagram.mjs` for machine-readable diagram operations. Use it instead of hand-rolling regex parsing.

### Commands

```bash
# Inspect diagram structure (nodes, edges, metadata)
node scripts/manage-diagram.mjs inspect path/to/plan.diagram.mmd

# Compute ready nodes from topology and statuses
node scripts/manage-diagram.mjs ready path/to/plan.diagram.mmd

# Validate diagram integrity (exit 0 if valid)
node scripts/manage-diagram.mjs validate path/to/plan.diagram.mmd

# Validate against canonical metadata (detects all 6 drift types)
node scripts/manage-diagram.mjs validate path/to/plan.diagram.mmd --metadata metadata.json

# Update a single node's status (rewrites plan-level comments)
node scripts/manage-diagram.mjs status path/to/plan.diagram.mmd T001 done

# Sort metadata blocks by node ID
node scripts/manage-diagram.mjs sort-metadata path/to/plan.diagram.mmd

# Regenerate diagram from canonical metadata (scope-change regeneration)
node scripts/manage-diagram.mjs regenerate path/to/plan.diagram.mmd --metadata metadata.json
```

### Metadata JSON Format

The `regenerate` and `validate --metadata` commands accept a JSON file with this structure:

```json
{
  "planId": "my-plan",
  "tasks": [
    {
      "id": "T001",
      "title": "Task title",
      "status": "done|inProgress|blocked|backlog",
      "skill": "quick-dev|code-agent|test-driven-development|brainstorming",
      "scope": "src/module/",
      "acceptance": "Observable behavior when done",
      "verify": "npm test -- relevant-test",
      "dependencies": ["T000"],
      "files": "optional, comma-separated file paths",
      "delegate": "yes|no (optional)"
    }
  ]
}
```

**Top-level fields:** `planId` (required, non-empty string) and `tasks` (required, non-empty array). Malformed JSON produces a clean parse error without stack traces.

**Required task fields:** `id`, `title`, `status`, `skill`, `scope`, `acceptance`, `verify`. All must be non-empty strings.

**Valid status values:** `done`, `inProgress`, `blocked`, `backlog`. Any other value is rejected.

**Dependency validation:** All entries in `dependencies` must reference an `id` present in the same `tasks` array. References to missing IDs are rejected with a clear error.

### When to Use

- **Status-Only Update:** Use `status` command instead of manual regex replacement. It updates graph class, metadata block, and all plan-level comments atomically while asserting topology is unchanged.
- **Scope-Change Regeneration:** Use `regenerate --metadata` when tasks are added, removed, renamed, or dependency edges change. It preserves stable node IDs for unchanged tasks, assigns new IDs for additions, retires IDs for removals, and produces deterministic byte-stable output.
- **SYNC Workflow:** Use `validate --metadata` to detect all six drift types (class status mismatch, phantom node, missing node, topology mismatch, stale plan-level comments, incomplete rich node metadata), then `regenerate --metadata` to fix drift. Without `--metadata`, `validate` only checks internal consistency.
- **Agent Orientation:** Use `inspect` to get structured JSON for programmatic consumption.
- **Ready Detection:** Use `ready` to determine which nodes can start (replaces manual graph traversal).
- **Metadata Ordering:** Use `sort-metadata` after any manual edits to ensure deterministic block ordering.

### Limitations

- Supports only `flowchart TD` diagrams. `stateDiagram-v2` files produce a clear error.
- Uses conservative regex parsing for the documented node/edge convention — not a full Mermaid parser.
- Node IDs must match `T\d{3,}` pattern (e.g., T001, T002).

## Update vs Regenerate

Decision tree:

1. **Status-only update:** Task metadata shows different status, but all task names, counts, and dependencies unchanged → surgical update: edit the `.mmd` file, change `:::className` assignments only
2. **Scope change:** Task added, removed, or renamed; any dependency edge added/removed → rewrite the `.mmd` file from scratch using current plan structure, then apply current status classes
3. **Mixed update:** If ANY scope change happened alongside status changes → treat as regeneration (scope takes priority)

| Trigger | Action |
|---------|--------|
| Task status changes | Edit `.mmd` — update `:::className` assignments only |
| New tasks added | Rewrite `.mmd` from current plan structure |
| Tasks removed | Rewrite `.mmd` from current plan structure |
| Dependencies reordered | Rewrite `.mmd` from current plan structure |
| Scope change | Rewrite `.mmd` from current plan structure |
| Status + scope together | Rewrite `.mmd` (scope takes priority) |

### Status-Only Update Algorithm

When task metadata status changes but the graph topology is unchanged:

1. **Read** the current `.mmd` file.
2. **Verify invariants:** Count nodes in the `.mmd` file and compare to canonical task count. Count edges and compare to canonical dependency count. If either differs, this is NOT a status-only update — escalate to scope-change regeneration.
3. **Update node classes:** For each node whose status changed, replace `:::oldClass` with `:::newClass` on the node's declaration line.
4. **Update plan-level comments:** Recalculate and rewrite `%% status:`, `%% ready:`, `%% blocked:`, and `%% next-action:` lines based on new status values and graph topology.
5. **Update per-node metadata:** For each changed node, update its `%% status:` line in the per-node comment block.
6. **Write** the updated `.mmd` file (under write-gate if in BRAINSTORM/EXECUTE).

**Verification:** After the update, the node set (IDs and labels) and edge set (source → target pairs) must be byte-identical to the pre-update version. If they differ, the update introduced an unintended scope change — revert and escalate to regeneration.

### Scope-Change Regeneration Algorithm

When tasks are added, removed, renamed, or dependency edges change:

1. **Read canonical metadata** — structured tasks if available, otherwise plan body checkboxes.
2. **Map existing node IDs** — read the current `.mmd` file (if it exists) and build a mapping of task title/ID → node ID. Preserve these stable IDs for tasks that still exist.
3. **Assign new IDs** — for newly added tasks, assign the next sequential `T###` ID not yet used in this diagram.
4. **Retire removed IDs** — tasks no longer in canonical metadata have their node IDs removed. Never reuse retired IDs.
5. **Build new graph** — construct the full `flowchart TD` from canonical task dependencies, using preserved/new node IDs.
6. **Generate per-node metadata** — for each node, generate a rich `%%` comment block. Preserve existing metadata fields (skill, scope, files, acceptance, verify) where the task still exists; generate fresh metadata for new tasks.
7. **Generate plan-level comments** — calculate status, ready, blocked, and next-action from the new graph topology and current metadata status.
8. **Preview diff** — before writing, compare old and new `.mmd` content. Present a summary of changes: nodes added, nodes removed, edges changed, metadata fields updated.
9. **Write under write-gate** — include the regeneration summary in the write-gate confirmation (node count, ready/blocked counts, topology changes).
10. **Rerender visual companion** — if the visual companion is available, update the HTML wrapper with the new `.mmd` content.

## Drift Detection and Resolution

Six types of drift:

1. **classDef mismatch** — node has wrong status class vs metadata
2. **Phantom node** — diagram has a node with no corresponding task in metadata
3. **Missing node** — metadata has a task with no corresponding diagram node
4. **Topology mismatch** — diagram edges don't match task dependency metadata
5. **Stale plan-level comments** — `%% status:`, `%% ready:`, `%% blocked:`, or `%% next-action:` lines are inconsistent with the actual graph state derived from metadata
6. **Incomplete/missing rich node metadata** — a node lacks per-node `%%` comment block, or its fields (skill, scope, acceptance, verify) are missing or stale

All six types → rewrite the `.mmd` file from metadata using the Scope-Change Regeneration Algorithm. Never patch metadata to match the diagram. **Metadata always wins.**

**Regenerated `.mmd` files should be deterministic** — given the same canonical metadata, the regeneration algorithm must produce byte-identical output. This means: nodes are ordered by ID (T001, T002, ...), edges are ordered by source then target, and per-node metadata fields are always in the same order (node, title, status, skill, scope, files, acceptance, verify, blocked-by, delegate).

**During SYNC workflow:** Read the `.mmd` file and compare every node and edge against task metadata. Flag any of the six drift types. Rewrite the `.mmd` file using regeneration algorithm. Report drift types found in the SYNC summary.

**Backward compatibility:** Plans without `.mmd` files remain valid. Diagrams without rich per-node metadata should be upgraded (metadata fields populated) during SYNC or next scope-change regeneration — this is drift type 6.

## Scalability

- Plans with 15+ nodes: consider clustering into `subgraph` blocks by phase
- If diagram becomes unreadable, the plan may need splitting into sub-plans

Example subgraph structure (raw `.mmd` content):

```
%% plan: large-plan
flowchart TD
    classDef done fill:#22c55e,color:#fff
    classDef backlog fill:#94a3b8,color:#fff

    subgraph Phase1[Phase 1: Foundation]
        T001[Design schema]:::done --> T002[Build API]:::done
    end
    subgraph Phase2[Phase 2: Features]
        T003[Build UI]:::backlog --> T004[Add search]:::backlog
    end
    Phase1 --> Phase2
```

## Examples

### flowchart TD — Task Dependency Graph (with Rich Metadata)

Raw `.mmd` file content:

```
%% plan: order-system
%% status: T001=done, T002=inProgress, T003=backlog, T004=backlog, T005=blocked
%% ready: T003 (T001 done, T002 not blocking)
%% blocked: T005 (waiting on T003 and T004)
%% next-action: Start T003 (tests can begin once API shape is stable)

%% node: T001
%% title: Design database schema for orders
%% status: done
%% skill: quick-dev
%% scope: db/migrations/
%% acceptance: Migration runs; orders table has all required columns
%% verify: npm run db:migrate

%% node: T002
%% title: Build REST API endpoints
%% status: inProgress
%% skill: test-driven-development
%% scope: src/api/orders/
%% files: src/api/orders/routes.ts, src/api/orders/handlers.ts
%% acceptance: CRUD endpoints return correct status codes and payloads
%% verify: npm test -- --testPathPattern=api/orders
%% blocked-by: T001

%% node: T003
%% title: Write API integration tests
%% status: backlog
%% skill: test-driven-development
%% scope: test/integration/orders/
%% acceptance: Integration tests cover all order lifecycle transitions
%% verify: npm test -- --testPathPattern=integration/orders
%% blocked-by: T001

%% node: T004
%% title: Build order management UI
%% status: backlog
%% skill: code-agent
%% scope: src/components/orders/
%% acceptance: Order list renders with pagination; detail view shows items
%% verify: npm test -- --testPathPattern=components/orders
%% blocked-by: T002

%% node: T005
%% title: Deploy to staging environment
%% status: blocked
%% skill: quick-dev
%% scope: infra/
%% acceptance: Staging deployment succeeds; smoke tests pass
%% verify: npm run deploy:staging && npm run smoke:staging
%% blocked-by: T003, T004

flowchart TD
    classDef done fill:#22c55e,color:#fff
    classDef inProgress fill:#f59e0b,color:#fff
    classDef blocked fill:#ef4444,color:#fff
    classDef backlog fill:#94a3b8,color:#fff

    T001[Design database schema for orders]:::done --> T002[Build REST API endpoints]:::inProgress
    T001 --> T003[Write API integration tests]:::backlog
    T002 --> T004[Build order management UI]:::backlog
    T002 --> T003
    T003 --> T005[Deploy to staging environment]:::blocked
    T004 --> T005
```

### stateDiagram-v2 — Feature Lifecycle

Raw `.mmd` file content:

```
%% plan: feature-lifecycle
stateDiagram-v2
    [*] --> Draft
    Draft --> Spec
    Spec --> Build
    Build --> Review
    Review --> Shipped
    Review --> Build : revisions
    state Build {
        Schema --> API
        API --> UI
    }
```
