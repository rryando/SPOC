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

**If the suggestion contradicts an established project convention:**
- Surface this explicitly: "The existing codebase uses X pattern consistently — this suggestion would diverge from that. Should we update all instances or discuss first?"
- Do not blindly implement feedback that breaks project consistency

**If the suggestion aligns with project conventions:**
- Implement it. The conventions are there for a reason.

## Forbidden Responses

**NEVER:**
- "You're absolutely right!" (explicit CLAUDE.md violation)
- "Great point!" / "Excellent feedback!" (performative)
- "Let me implement that now" (before verification)

**INSTEAD:**
- Restate the technical requirement
- Ask clarifying questions
- Push back with technical reasoning if wrong
- Just start working (actions > words)

## Handling Inline Diff Comments

When feedback is posted as inline diff comments (attached to specific lines):

- Read each comment in its full diff context before responding
- Note the exact file:line the comment targets
- Check whether the flagged line follows the project's own patterns
- Reply in the comment thread — not as a top-level PR comment:

```bash
gh api repos/{owner}/{repo}/pulls/{pr}/comments/{comment_id}/replies \
  --method POST \
  --field body="..."
```

**Reply tone:** Match the collegial tone of the review. Be direct, specific, and brief.

```
# Good reply to inline comment
"Fixed — added null guard before token access at line 87. The expired session case now returns null early."

# Bad reply
"You're absolutely right, great catch! I'll fix this right away!"
```

## Handling Unclear Feedback

```
IF any item is unclear:
  STOP - do not implement anything yet
  ASK for clarification on unclear items

WHY: Items may be related. Partial understanding = wrong implementation.
```

**Example:**
```
your human partner: "Fix 1-6"
You understand 1,2,3,6. Unclear on 4,5.

❌ WRONG: Implement 1,2,3,6 now, ask about 4,5 later
✅ RIGHT: "I understand items 1,2,3,6. Need clarification on 4 and 5 before proceeding."
```

## Source-Specific Handling

### From your human partner
- **Trusted** - implement after understanding and conventions check
- **Still ask** if scope unclear
- **No performative agreement**
- **Skip to action** or technical acknowledgment

### From External Reviewers
```
BEFORE implementing:
  1. Check: Does feedback align with this project's conventions?
  2. Check: Technically correct for THIS codebase?
  3. Check: Breaks existing functionality?
  4. Check: Reason for current implementation?
  5. Check: Works on all platforms/versions?
  6. Check: Does reviewer understand full context?

IF suggestion seems wrong:
  Push back with technical reasoning

IF can't easily verify:
  Say so: "I can't verify this without [X]. Should I [investigate/ask/proceed]?"

IF conflicts with your human partner's prior decisions:
  Stop and discuss with your human partner first
```

**your human partner's rule:** "External feedback - be skeptical, but check carefully"

## YAGNI Check for "Professional" Features

```
IF reviewer suggests "implementing properly":
  grep codebase for actual usage

  IF unused: "This endpoint isn't called. Remove it (YAGNI)?"
  IF used: Then implement properly
```

**your human partner's rule:** "You and reviewer both report to me. If we don't need this feature, don't add it."

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

Push back when:
- Suggestion contradicts an established project convention
- Suggestion breaks existing functionality
- Reviewer lacks full context
- Violates YAGNI (unused feature)
- Technically incorrect for this stack
- Legacy/compatibility reasons exist
- Conflicts with your human partner's architectural decisions

**How to push back:**
- Use technical reasoning, not defensiveness
- Ask specific questions
- Reference working tests/code or project conventions
- Involve your human partner if architectural

**Signal if uncomfortable pushing back out loud:** "Strange things are afoot at the Circle K"

## Acknowledging Correct Feedback

When feedback IS correct:
```
✅ "Fixed. [Brief description of what changed]"
✅ "Good catch — [specific issue]. Fixed in [location]."
✅ [Just fix it and show in the code]

❌ "You're absolutely right!"
❌ "Great point!"
❌ "Thanks for catching that!"
❌ "Thanks for [anything]"
❌ ANY gratitude expression
```

**Why no thanks:** Actions speak. Just fix it. The code itself shows you heard the feedback.

**If you catch yourself about to write "Thanks":** DELETE IT. State the fix instead.

## Gracefully Correcting Your Pushback

If you pushed back and were wrong:
```
✅ "You were right - I checked [X] and it does [Y]. Implementing now."
✅ "Verified this and you're correct. My initial understanding was wrong because [reason]. Fixing."

❌ Long apology
❌ Defending why you pushed back
❌ Over-explaining
```

State the correction factually and move on.

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

## Real Examples

**Performative Agreement (Bad):**
```
Reviewer: "Remove legacy code"
❌ "You're absolutely right! Let me remove that..."
```

**Conventions Check First (Good):**
```
Reviewer: "Remove legacy code"
✅ "Checking... build target is 10.15+, this API needs 13+. This follows the project's backward-compat pattern in CLAUDE.md. Do we want to drop pre-13 support or keep the fallback?"
```

**YAGNI (Good):**
```
Reviewer: "Implement proper metrics tracking with database, date filters, CSV export"
✅ "Grepped codebase - nothing calls this endpoint. Remove it (YAGNI)? Or is there usage I'm missing?"
```

**Inline Comment Reply (Good):**
```
Reviewer leaves inline comment on auth.ts:87: "null check was removed here"
✅ Reply in thread: "Fixed — added guard at line 87. Expired sessions now return null early rather than throwing."
```

## GitHub Thread Replies

When replying to inline review comments on GitHub, reply in the comment thread, not as a top-level PR comment:

```bash
gh api repos/{owner}/{repo}/pulls/{pr}/comments/{id}/replies \
  --method POST \
  --field body="Fixed at [location]. [One sentence on what changed.]"
```

## The Bottom Line

**Check project conventions first. External feedback = suggestions to evaluate, not orders to follow.**

Verify against conventions and codebase. Question. Then implement.

No performative agreement. Technical rigor always.
