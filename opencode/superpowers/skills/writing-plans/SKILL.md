---
name: writing-plans
description: Use when you have a spec or requirements for a multi-step task, before touching code
---

# Writing Plans

## Overview

Write comprehensive implementation plans assuming the engineer has zero context for our codebase and questionable taste. Document everything they need to know: which files to touch for each task, code, testing, docs they might need to check, how to test it. Give them the whole plan as bite-sized tasks. DRY. YAGNI. TDD. Frequent commits.

Assume they are a skilled developer, but know almost nothing about our toolset or problem domain. Assume they don't know good test design very well.

**Announce at start:** "I'm using the writing-plans skill to create the implementation plan."

**Context:** This should be run in a dedicated branch.

**Save plans to:** spoc as a project plan using DAG tools (see Storage section below)
- The plan is stored via `create_project_plan` with status `planned` and keywords `["implementation-plan"]`
- No files are written to the project repo

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

## Execution Modes

### Agent-Direct Mode

Agent has SPOC MCP tools available — writes plans directly to the DAG:

- Uses `spoc_create_project_plan` with status `planned`, keywords `["implementation-plan"]`
- Creates associated `.diagram.mmd` file via diagram persistence rules (see Diagram Section)
- Creates structured tasks via `spoc_create_project_task` linked to plan via `planId`
- Uses write-gate pattern for all DAG writes (propose → confirm → apply)
- For user confirmation: returns summary to orchestrator, waits for relay before persisting

### Orchestrator Mode (artifact return)

Agent lacks SPOC MCP tools — returns structured plan as text in final message for orchestrator to persist:

```
---plan-artifact---
title: <plan title>
summary: <one-line summary>
keywords: ["implementation-plan", ...]
sourceFiles: [{path: "...", anchor: "..."}]
---body---
<full plan markdown body>
---diagram---
<full .mmd file content>
---tasks---
- title: <task 1>
  priority: high|medium|low
  sourceFiles: [{path: "..."}]
- title: <task 2>
  priority: medium
  sourceFiles: [{path: "..."}]
---end---
```

Orchestrator parses this artifact and persists via SPOC tools (`create_project_plan`, `create_project_task`, diagram file write).

## Mode Detection

- If `spoc_create_project_plan` tool is available in the current session → **agent-direct mode**
- If not available → **orchestrator mode** (return artifact in structured format above)

Detect once at skill start. Announce which mode is active in the opening message.

## Scope Check

If the spec covers multiple independent subsystems, it should have been broken into sub-project specs during brainstorming. If it wasn't, suggest breaking this into separate plans — one per subsystem. Each plan should produce working, testable software on its own.

## File Structure

Before defining tasks, map out which files will be created or modified and what each one is responsible for. This is where decomposition decisions get locked in.

- Design units with clear boundaries and well-defined interfaces. Each file should have one clear responsibility.
- You reason best about code you can hold in context at once, and your edits are more reliable when files are focused. Prefer smaller, focused files over large ones that do too much.
- Files that change together should live together. Split by responsibility, not by technical layer.
- In existing codebases, follow established patterns. If the codebase uses large files, don't unilaterally restructure - but if a file you're modifying has grown unwieldy, including a split in the plan is reasonable.

This structure informs the task decomposition. Each task should produce self-contained changes that make sense independently.

## Bite-Sized Task Granularity

**Each step is one action (2-5 minutes):**
- "Write the failing test" - step
- "Run it to make sure it fails" - step
- "Implement the minimal code to make the test pass" - step
- "Run the tests and make sure they pass" - step
- "Commit" - step

## Plan Document Header

**Every plan MUST start with this header:**

```markdown
# [Feature Name] Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** [One sentence describing what this builds]

**Architecture:** [2-3 sentences about approach]

**Tech Stack:** [Key technologies/libraries]

---
```

> After this header block, add a diagram reference line before the task phases. See **Diagram Section** below.

## Diagram Section

Diagrams are **agentic execution maps**, not thin visual aids. They live in separate `.mmd` files — never embedded as Mermaid code blocks in the plan body. A well-annotated diagram enables diagram-first execution: an agent reads the `.mmd` file alone and dispatches sub-agents without loading plan prose.

- Diagram file: `plans/<plan-id>.diagram.mmd`
- Plan body references it by blockquote only (see placement below) — no embedded Mermaid
- Load `to-diagram` skill for `.mmd` file conventions, dialect selection, `:::className` encoding, and rich per-node metadata format

**Persistence write-gate:** The diagram is drafted in memory (or `/tmp`) during plan writing. The `.mmd` file is persisted to the DAG path (`plans/<plan-id>.diagram.mmd`) **only after** the plan write-gate / storage confirmation succeeds. Do not write to DAG before the plan itself is confirmed.

**Stable node IDs:**
- Use `T001`, `T002`, `T003`, etc. — sequential, zero-padded to 3 digits
- When canonical structured task IDs exist (from `create_project_task`), use those as node IDs instead
- Once assigned, IDs never change across renames, reorders, or regeneration

**Rich per-node metadata (required for every node):**
Each node must have a `%%` comment block (placed before `flowchart TD`, per `to-diagram` conventions) containing at minimum:
- `node` — stable node ID
- `title` — full task title
- `status` — current status (backlog at creation time)
- `skill` — recommended work-mode skill (quick-dev, code-agent, test-driven-development, brainstorming)
- `scope` — directories or modules in scope
- `files` / `sourceFiles` — specific files to create or modify (when known)
- `acceptance` — observable "done" criteria
- `verify` — exact shell command(s) to verify completion
- `blocked-by` — node IDs this task depends on
- `delegate` — whether to dispatch to sub-agent (yes/no; default yes)

This metadata must be populated at plan creation time even though all nodes start as `:::backlog`. The goal: EXECUTE can dispatch from diagram-first context without loading plan prose.

**Continuity rule — design-phase `.mmd` file exists (from brainstorming):**
- Read the existing `.mmd` file and EXTEND it — add implementation-specific task nodes (e.g., split "Build API" into "Design schema", "Implement endpoints", "Write tests") and refine dependency edges.
- Preserve stable node IDs from the design phase. Enrich any nodes missing per-node metadata fields.
- Do not regenerate from scratch.

**No prior diagram exists (plan created directly, not via brainstorming):**
- Generate a fresh `.mmd` file per `to-diagram` conventions from the plan's task structure, with full per-node metadata for every node.

**Placement in plan body:**

```
## Overview
[plan overview prose]

> Diagram: plans/<plan-id>.diagram.mmd

## Phases / Tasks
[detailed task breakdown]
```

**At plan creation time**, all nodes start as `:::backlog` — but per-node metadata must already include skill, scope, acceptance, and verify so EXECUTE can dispatch from diagram-first context.

**During EXECUTE**, when task status updates in metadata, also update the corresponding node's `:::className` in the `.mmd` file — only the class assignment changes, topology stays.

````markdown
### Task N: [Component Name]

**Files:**
- Create: `exact/path/to/file.py`
- Modify: `exact/path/to/existing.py:123-145`
- Test: `tests/exact/path/to/test.py`

- [ ] **Step 1: Write the failing test**

```python
def test_specific_behavior():
    result = function(input)
    assert result == expected
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/path/test.py::test_name -v`
Expected: FAIL with "function not defined"

- [ ] **Step 3: Write minimal implementation**

```python
def function(input):
    return expected
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/path/test.py::test_name -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/path/test.py src/path/file.py
git commit -m "feat: add specific feature"
```
````

## Remember
- Exact file paths always
- Complete code in plan (not "add validation")
- Exact commands with expected output
- Reference relevant skills with @ syntax
- DRY, YAGNI, TDD, frequent commits

## Plan Review Loop

After completing each chunk of the plan:

1. Dispatch plan-document-reviewer subagent (see plan-document-reviewer-prompt.md) with precisely crafted review context — never your session history. This keeps the reviewer focused on the plan, not your thought process.
   - Provide: chunk content, path to spec document
2. If ❌ Issues Found:
   - Fix the issues in the chunk
   - Re-dispatch reviewer for that chunk
   - Repeat until ✅ Approved
3. If ✅ Approved: proceed to next chunk (or execution handoff if last chunk)

**Chunk boundaries:** Use `## Chunk N: <name>` headings to delimit chunks. Each chunk should be ≤1000 lines and logically self-contained.

**Review loop guidance:**
- Same agent that wrote the plan fixes it (preserves context)
- If loop exceeds 5 iterations, surface to human for guidance
- Reviewers are advisory - explain disagreements if you believe feedback is incorrect

## Storage — spoc Project Plan

After completing each chunk and final review:

1. Ensure a spoc project exists for the current work (prefer `spoc project list --json` CLI, or `list_projects` MCP fallback; use `init_project` to create if needed)
2. Create the implementation plan: `create_project_plan` with:
   - `slug`: the project slug
   - `title`: `YYYY-MM-DD <feature-name> Implementation Plan`
   - `summary`: one-line goal of the plan
   - `status`: `planned`
   - `keywords`: `["implementation-plan"]`
   - `body`: the full plan content (markdown)
3. Note the returned `planId` — this is what the execution skill will reference
4. If updating an existing plan, use `update_project_plan_body` instead

## Execution Handoff

After saving the plan:

**"Plan complete and saved to spoc project plan `<planId>` in project `<slug>`. Ready to execute?"**

**Execution path depends on harness capabilities:**

**If harness has subagents (Claude Code, etc.):**
- **REQUIRED:** Use superpowers:subagent-driven-development
- Do NOT offer a choice - subagent-driven is the standard approach
- Fresh subagent per task + two-stage review

**If harness does NOT have subagents:**
- Execute plan in current session using superpowers:executing-plans
- Batch execution with checkpoints for review
