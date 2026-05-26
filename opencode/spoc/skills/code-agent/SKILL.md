---
name: code-agent
description: Use when the task is mostly clear (50-90%) with one or two open decisions that can likely be resolved by inspecting the repo — not fully bounded, not a blank-slate design problem
---

# code-agent

Use this skill when the task is **mostly clear (50–90%)** — intent understood, but one or two decisions remain open that can likely be resolved by inspecting the repo.

## Trigger — self-select when ALL apply

- Intent is understood but 1-2 decisions remain open
- Those decisions can likely be resolved by inspecting existing patterns, types, or test fixtures in the repo
- Full brainstorming/spec/planning overhead is not justified

## SPOC Context First

Before inspecting the repo, orient yourself with SPOC:

1. **Project context:** `spoc context [--path=<dir>] --audience=implementer --lean --json`
   - Understand project overview, tech stack, current focus, and operating brief
   - Learn what decisions are already open/resolved

2. **Search for relevant patterns:** `spoc search <slug> "<keywords>" --audience=implementer --lean --json`
   - Find existing solutions to similar problems
   - Avoid duplicating patterns already documented
   - Learn conventions from documented lessons and gotchas

3. **Check task state (if working from a plan):** `spoc task list <slug> --lean --json`
   - See what's in-progress, blocked, or done
   - Understand dependencies before diving in

Then proceed with repo inspection — but with SPOC context, your exploration will be faster and better targeted.

## Behaviour

1. **Inspect repo first** — check existing patterns, types, test fixtures before asking anything
2. **Proceed on inferred defaults** for anything the repo makes clear
3. **Ask at most one targeted question** if a genuine decision cannot be inferred (product direction, naming with no precedent, breaking vs non-breaking trade-off)
4. **Use TDD selectively** — apply it for new non-trivial behaviour; skip it for structural changes already covered by existing tests
5. **Lightweight plan (bullet list)** only when the task spans 3+ files and sequencing matters

## Escalation

If complexity expands significantly during work:

- **Pause immediately**
- State the reason clearly
- Summarise what has been done so far
- Ask the user to confirm before switching to `brainstorming`

Do not chain skill invocations silently.

## NOT for

- Fully bounded tasks with no open decisions → use `quick-dev`
- Unclear/creative/product-shaping work where design direction is unknown → use `brainstorming`
