---
name: loop
description: Use when you need to run a self-referential development loop that automatically continues until task completion. Drives iterative work with automatic re-prompting on idle.
---

# Loop Skill

A self-referential development loop that automatically re-prompts you until the task is complete. When your session goes idle without emitting a completion promise, the system injects a continuation prompt and you keep working.

## How It Works

1. You (or the user via `/loop`) start a loop by calling the `start_project_loop` MCP tool
2. You work on the task
3. When you go idle, the SPOC plugin checks if you emitted `<promise>DONE</promise>`
4. If yes → loop ends, success toast shown
5. If no → iteration increments, continuation prompt injected, you continue working
6. This repeats until completion, max iterations reached, or the user cancels

## Starting a Loop

Call the SPOC MCP tool:

```
start_project_loop({
  slug: "project-slug",
  sessionId: "<current session ID>",
  prompt: "Implement feature X with full test coverage",
  maxIterations: 50,           // optional, default 100
  completionPromise: "DONE",   // optional, default "DONE"
  strategy: "continue"         // optional, default "continue"
})
```

## Completion Protocol

When you have **fully completed** the task — not partially, not mostly — emit the completion tag:

```
<promise>DONE</promise>
```

**Rules:**
- Do NOT emit the promise until the task is truly, completely done
- The promise must appear in your response text (not in a tool call)
- The system scans for `<promise>DONE</promise>` (case-insensitive)
- If you use a custom completion promise, emit that instead

## During Iterations

Each iteration, you'll receive a continuation prompt reminding you of the original task. When you receive it:

1. **Review progress** — what did you accomplish in previous iterations?
2. **Identify remaining work** — what's still left?
3. **Make meaningful progress** — don't just repeat what you did before
4. **Track progress** — use SPOC tasks or your todo list to track what's done

## Exit Conditions

1. **Completion** — you emit `<promise>DONE</promise>` → loop ends with success
2. **Max iterations** — iteration count reaches the limit → loop stops with warning
3. **Cancel** — user runs `/cancel-loop` or calls `cancel_project_loop` tool → loop cleared

## Cancelling a Loop

Call the MCP tool:

```
cancel_project_loop({
  slug: "project-slug",
  sessionId: "<current session ID>"
})
```

Or check current state:

```
get_project_loop_state({
  slug: "project-slug"
})
```

## Best Practices

- **Set realistic max iterations** — 10-20 for focused tasks, 50-100 for large features
- **Use SPOC tasks** — create/update SPOC project tasks to track progress across iterations
- **Be thorough before completing** — run tests, verify behavior, check edge cases before emitting the promise
- **Don't emit early** — if there's any doubt, keep working rather than claiming completion
- **Make each iteration count** — avoid spinning on the same problem; try different approaches if stuck

## Integration with SPOC

The loop state lives in the SPOC DAG (`~/.spoc/projects/{slug}/loop-state.json`). This means:
- Loop state persists across session reconnects
- Only one active loop per project at a time
- The orchestrator and other agents can check loop status via MCP tools
