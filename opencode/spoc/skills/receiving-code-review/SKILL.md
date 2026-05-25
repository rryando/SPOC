---
name: receiving-code-review
description: Use when receiving code review feedback, before implementing suggestions, especially if feedback seems unclear or technically questionable - requires technical rigor and verification, not performative agreement or blind implementation
---

# Code Review Reception

## Overview

Code review requires technical evaluation, not emotional performance.

**Core principle:** Check project conventions first. Verify before implementing. Ask before assuming. Technical correctness over social comfort.

## The Response Pattern

```
WHEN receiving code review feedback:

1. CHECK: Does the feedback align with this project's established conventions?
2. READ: Complete feedback without reacting
3. UNDERSTAND: Restate requirement in own words (or ask)
4. VERIFY: Check against codebase reality
5. EVALUATE: Technically sound for THIS codebase?
6. RESPOND: Technical acknowledgment or reasoned pushback
7. IMPLEMENT: One item at a time, test each
```

## Step 1: Project Conventions Check

Before agreeing with or pushing back on any feedback, ask:

- Does this project have a linter, style guide, or CLAUDE.md that governs this area?
- Is the reviewer's suggestion consistent with patterns already in the codebase?
- Is the current code following the project's established convention (even if the reviewer dislikes it)?

**If the suggestion contradicts an established project convention:** surface this explicitly — "The existing codebase uses X pattern consistently; this suggestion would diverge from that. Should we update all instances or discuss first?" Do not blindly implement feedback that breaks project consistency.

**If the suggestion aligns with project conventions:** implement it. The conventions are there for a reason.

## Response Language (Forbidden vs Approved)

Applies to both acknowledging feedback and replying to inline comments. Actions speak — just fix the code and state the fix factually.

| Forbidden | Why | Approved instead |
|-----------|-----|------------------|
| "You're absolutely right!" | Explicit CLAUDE.md violation; performative | State the fix: "Fixed — added null guard at line 87." |
| "Great point!" / "Excellent feedback!" | Performative agreement | Restate the technical requirement, or just act |
| "Let me implement that now" (before verification) | Skips the verify/evaluate steps | "Checking against [file/test/convention] first." |
| "Thanks for catching that!" / any gratitude | Unnecessary social padding | Just fix it and show the change |
| Long apology after being wrong on pushback | Over-explaining | "You were right — verified [X]. Fixing now." |

**If you catch yourself about to write "Thanks" or "You're right":** delete it. State the fix instead.

## Handling Unclear Feedback

```
IF any item is unclear:
  STOP - do not implement anything yet
  ASK for clarification on unclear items

WHY: Items may be related. Partial understanding = wrong implementation.
```

**Example:**
```
Partner: "Fix 1-6"
You understand 1,2,3,6. Unclear on 4,5.

❌ WRONG: Implement 1,2,3,6 now, ask about 4,5 later
✅ RIGHT: "I understand items 1,2,3,6. Need clarification on 4 and 5 before proceeding."
```

## Source-Specific Handling

**From your human partner:** trusted — implement after understanding and conventions check. Still ask if scope unclear. No performative agreement. Skip to action or technical acknowledgment.

**From external reviewers:** be skeptical but check carefully. Before implementing, verify each point against: (1) project conventions, (2) correctness for THIS codebase, (3) regression risk, (4) reason for current implementation, (5) platform/version support, (6) reviewer's full context.

- If suggestion seems wrong → push back with technical reasoning
- If you can't verify → say so: "I can't verify this without [X]. Should I [investigate/ask/proceed]?"
- If it conflicts with your human partner's prior decisions → stop and discuss with partner first

## YAGNI Check for "Professional" Features

```
IF reviewer suggests "implementing properly":
  grep codebase for actual usage

  IF unused: "This endpoint isn't called. Remove it (YAGNI)?"
  IF used: Then implement properly
```

**Partner's rule:** "You and reviewer both report to me. If we don't need this feature, don't add it."

## Implementation Order

```
FOR multi-item feedback:
  1. Clarify anything unclear FIRST
  2. Check project conventions for each item
  3. Then implement in this order:
     - Blocking issues (breaks, security)
     - Simple fixes (typos, imports)
     - Complex fixes (refactoring, logic)
  4. Test each fix individually
  5. Verify no regressions
```

## When To Push Back

Push back when the suggestion: contradicts an established project convention, breaks existing functionality, comes from a reviewer lacking full context, violates YAGNI, is technically incorrect for the stack, ignores legacy/compatibility reasons, or conflicts with your human partner's architectural decisions.

**How to push back:** technical reasoning, not defensiveness. Ask specific questions. Reference working tests/code or project conventions. Involve your human partner if architectural.

**Signal if uncomfortable pushing back out loud:** "Strange things are afoot at the Circle K"

**If you pushed back and were wrong:** state the correction factually and move on — "You were right — I checked [X] and it does [Y]. Implementing now." No long apologies, no defending why you pushed back.

## Handling Inline Diff Comments

When feedback is posted as inline diff comments attached to specific lines:

- Read each comment in its full diff context before responding
- Note the exact `file:line` the comment targets
- Check whether the flagged line follows the project's own patterns
- Reply in the comment thread, **not** as a top-level PR comment
- Match the collegial tone of the review. Be direct, specific, brief.

```bash
gh api repos/{owner}/{repo}/pulls/{pr}/comments/{comment_id}/replies \
  --method POST \
  --field body="Fixed at [location]. [One sentence on what changed.]"
```

Good reply: `"Fixed — added null guard before token access at line 87. Expired sessions now return null early."`
Bad reply: `"You're absolutely right, great catch! I'll fix this right away!"`

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Implementing before checking conventions | Check project patterns first |
| Performative agreement | State requirement or just act |
| Blind implementation | Verify against codebase first |
| Batch without testing | One at a time, test each |
| Assuming reviewer is right | Check if it breaks things or violates conventions |
| Avoiding pushback | Technical correctness > comfort |
| Partial implementation | Clarify all items first |
| Can't verify, proceed anyway | State limitation, ask for direction |
| Replying top-level to inline comments | Reply in the comment thread |

## The Bottom Line

**Check project conventions first. External feedback = suggestions to evaluate, not orders to follow.**

Verify against conventions and codebase. Question. Then implement. No performative agreement. Technical rigor always.
