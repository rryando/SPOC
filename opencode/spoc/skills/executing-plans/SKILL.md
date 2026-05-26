---
name: executing-plans
description: Use when you have a written implementation plan to execute in a separate session with review checkpoints
---

# Executing Plans

## Overview

Load plan, review critically, execute all tasks, report when complete.

**Announce at start:** "I'm using the executing-plans skill to implement this plan."

**Note:** Tell your human partner that SPOC works much better with access to subagents. The quality of its work will be significantly higher if run on a platform with subagent support (such as Claude Code or Codex). If subagents are available, use spoc:subagent-driven-development instead of this skill.

## Diagram-First Task Selection (Mandatory)

When the plan has an associated `.diagram.mmd` file, read it BEFORE the plan body:

### 1. Identify Ready Nodes

```bash
spoc diagram ready <slug> <planId>
# or (file-level fallback):
manage-diagram.mjs ready <path-to-diagram.mmd>
```

This returns nodes whose dependencies are all `:::done` — these are executable now.

### 2. Extract Per-Node Metadata

Each diagram node has rich metadata in `%%` comment blocks:

```
%% node: T001
%% title: Implement auth middleware
%% status: backlog
%% skill: code-agent
%% scope: src/middleware/auth.ts
%% files: src/middleware/auth.ts, src/types/auth.ts
%% acceptance: Auth middleware validates JWT tokens and attaches user to request
%% verify: npm test -- --grep "auth middleware"
```

Use this metadata to construct sub-agent prompts — it provides skill selection, file scope, acceptance criteria, and verification commands without reading the full plan body.

### 3. Task Transition Protocol

When a task completes, the **orchestrator** (not sub-agent) transitions it:

```bash
spoc task transition <slug> <taskId> done --diagramNodeId=T001 --planId=<planId> --token=$TOKEN
```

**Both `diagramNodeId` AND `planId` are required** — without either, the diagram node's `:::className` is silently skipped.

**Post-transition re-scan:** After each transition, re-run `spoc diagram ready <slug> <planId>` to discover newly-unblocked nodes. If additional ready nodes appear, select the next highest-priority one for the next dispatch round.

### 4. Fallback: Incomplete Node Metadata

If a ready node's `%%` comment block is missing `scope`, `acceptance`, or `verify` fields:
1. Read the plan body for that specific task's details
2. Construct the sub-agent prompt from the plan body task section
3. Note the gap — during SYNC, the diagram should be enriched with complete per-node metadata

### 5. Sub-Agent Constraints

- **Sub-agents MUST NOT edit `.mmd` files** — the orchestrator owns all diagram updates
- If a sub-agent discovers scope changes (task added/removed/dependency changed), it reports them in its final summary — the orchestrator then handles diagram regeneration
- Sub-agents only READ the diagram for context; they never WRITE to it

## The Process

### Step 1: Load and Review Plan
1. Read plan file
2. Review critically - identify any questions or concerns about the plan
3. If concerns: Raise them with your human partner before starting
4. If no concerns: Create TodoWrite and proceed

### Step 2: Execute Tasks

For each task:
1. Mark as in_progress
2. Follow each step exactly (plan has bite-sized steps)
3. Run verifications as specified
4. Mark as completed

## Sub-Agent SPOC Context Instructions

When dispatching implementation sub-agents for each task, include these SPOC CLI instructions in their prompt:

**Required orientation commands for sub-agents:**
```bash
# Project context (fast, token-efficient)
spoc context <slug> --audience=implementer --lean --json

# Search for relevant patterns/knowledge
spoc search <slug> "<task-keywords>" --audience=implementer --lean --json

# Check current task state
spoc task list <slug> --lean --json
```

**Example sub-agent instruction block:**
```
Before starting this task, orient yourself:
1. Run: spoc context <slug> --audience=implementer --lean --json
2. Search: spoc search <slug> "<relevant-topic>" --lean --json
3. Check tasks: spoc task list <slug> --lean --json

Use this context to understand what you're building, what's already been done, and what conventions to follow.
```

These commands ensure sub-agents start with structured project context instead of scanning the codebase from scratch.

### Step 3: Complete Development

After all tasks complete and verified:
- Announce: "I'm using the finishing-a-development-branch skill to complete this work."
- **REQUIRED SUB-SKILL:** Use spoc:finishing-a-development-branch
- Follow that skill to verify tests, present options, execute choice

### Step 4: Post-Execution Auto-Sync

After completing development, the orchestrator automatically triggers a DAG SYNC if any of these conditions are met:
- 3+ tasks were transitioned during this session
- New knowledge entries were created from implementation discoveries
- `lastSyncedAt` is > 7 days ago or absent
- The plan reached `done` status (all tasks complete)

This happens automatically — no user confirmation needed. The orchestrator announces `→ Auto-syncing DAG: [reason]` and chains directly into the SYNC workflow.

## When to Stop and Ask for Help

**STOP executing immediately when:**
- Hit a blocker (missing dependency, test fails, instruction unclear)
- Plan has critical gaps preventing starting
- You don't understand an instruction
- Verification fails repeatedly

**Ask for clarification rather than guessing.**

## When to Revisit Earlier Steps

**Return to Review (Step 1) when:**
- Partner updates the plan based on your feedback
- Fundamental approach needs rethinking

**Don't force through blockers** - stop and ask.

## Remember
- Review plan critically first
- Follow plan steps exactly
- Don't skip verifications
- Reference skills when plan says to
- Stop when blocked, don't guess
- Never start implementation on main/master branch without explicit user consent

## Integration

**Required workflow skills:**
- **spoc:writing-plans** - Creates the plan this skill executes
- **spoc:finishing-a-development-branch** - Complete development after all tasks
