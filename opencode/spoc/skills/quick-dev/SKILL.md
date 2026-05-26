---
name: quick-dev
description: Use when the task is fully bounded with no open decisions — rename, refactor, extract, multi-var/multi-file change, API shape already known, config nudge, copy update, trivial targeted bugfix
---

# quick-dev

Use this skill when the task is **fully bounded** with no open decisions and success criteria are derivable without asking.

## Trigger — self-select when ALL apply

- Rename, refactor, extract, signature change, multi-var/multi-file search-replace, config nudge, copy update, targeted bugfix with a known root cause, API shape already defined, trivial test fix
- No product/UX/architecture decisions remain
- Success criteria are clear without asking

## Behaviour

1. Orient + read context:
   - **SPOC context first** (fast, token-efficient):
     ```bash
     spoc context [--path=<dir>] --audience=implementer --lean --json
     ```
   - If the task relates to a known pattern, search:
     ```bash
     spoc search <slug> "<keywords>" --lean --json
     ```
   - **Then read local files** — relevant types, call sites, file headers — targeted by what SPOC told you
2. Execute the change directly — no planning doc, no brainstorming, no TDD ritual
3. Run focused verification: type-check, lint, affected tests — not the full suite unless the change is pervasive
4. Commit only when the user asks

## Escalation

If hidden complexity surfaces mid-task (the change cascades unexpectedly, or a genuine decision appears):

- **Pause immediately**
- State the issue explicitly
- Offer to switch to `code-agent` (if one decision opened up) or `brainstorming` (if design is genuinely unclear)
- Wait for user confirmation before continuing

Do not silently expand scope.

## NOT for

- Tasks with open design decisions
- New behaviour or UX changes
- Multi-subsystem changes with unknown interfaces

Use `code-agent` or `brainstorming` for those.
