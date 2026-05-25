---
name: caveman-review
description: Use when writing code review comments on a PR or diff, especially when SPOC Caveman mode is active. Produces one-line findings in the form "Lline: problem. fix." with optional severity prefix. Cuts noise while preserving actionable signal.
---

Write code review comments terse and actionable. One line per finding. Location, problem, fix. No throat-clearing.

Adapted from https://github.com/JuliusBrussee/caveman (MIT).

## Rules

**Format:** `L<line>: <problem>. <fix>.` — or `<file>:L<line>: ...` when reviewing multi-file diffs.

**Severity prefix** (optional, use when findings are mixed):

- `🔴 bug:` — broken behavior, will cause an incident
- `🟡 risk:` — works today but fragile (race, missing null check, swallowed error, unbounded input)
- `🔵 nit:` — style, naming, micro-optimization. Author may ignore.
- `❓ q:` — genuine question, not a suggestion

**Drop:**
- "I noticed that...", "It seems like...", "You might want to consider..."
- "This is just a suggestion but..." — use `nit:` instead
- "Great work!", "Looks good overall but..." — say it once at the top, not per comment
- Restating what the line does — reviewer can read the diff
- Hedging ("perhaps", "maybe", "I think") — if genuinely unsure, use `q:`

**Keep:**
- Exact line numbers
- Exact symbol/function/variable names in backticks
- A concrete fix, not "consider refactoring this"
- The *why* when the fix isn't obvious from the problem statement alone

## Examples

Bloated review style:

> "I noticed that on line 42 you're not checking if the user object is null before accessing the email property. This could potentially cause a crash if the user is not found in the database. You might want to add a null check here."

Caveman review style:

> `L42: 🔴 bug: user can be null after .find(). Add guard before .email.`

---

Bloated:

> "It looks like this function is doing a lot of things and might benefit from being broken up into smaller functions for readability."

Caveman:

> `L88-140: 🔵 nit: 50-line fn does 4 things. Extract validate / normalize / persist.`

---

Bloated:

> "Have you considered what happens if the API returns a 429? I think we should probably handle that case."

Caveman:

> `L23: 🟡 risk: no retry on 429. Wrap in withBackoff(3).`

## Example — multi-file PR review

When a PR touches multiple files, use the `<file>:L<line>:` format and open with a one-line batch summary header counting findings by severity.

```
2 bugs, 1 risk, 1 nit

🔴 bug: src/auth/middleware.ts:L42: off-by-one in token expiry check — rejects valid tokens in final second. Use `<=` instead of `<`.
🔴 bug: src/api/routes.ts:L118: `userId` parsed as string but compared with `===` to numeric DB id. Cast or use `==`.
🟡 risk: src/auth/middleware.ts:L67: missing null check on `session.user` after cache miss. Guard before destructure.
🔵 nit: test/auth.test.ts:L23: `setTimeout(done, 50)` is a flaky timing hack. Use `vi.useFakeTimers()`.
```

The pattern scales to large reviews: keep each finding on one line, add a batch summary header, and group by file only when the review exceeds ~15 findings — otherwise a flat list is preferred.

## Auto-Clarity — DROP terse mode for

- **Security findings** — CVE-class bugs need full explanation and a reference. Write a paragraph, then resume terse for subsequent findings.
- **Architectural disagreements** — need rationale, not a one-liner. Explain trade-offs, then resume terse.
- **Onboarding contexts** — when the author is new to the codebase, include the "why". Resume terse once they are caught up.

## Boundaries

This skill produces review comments only. It does not write the code fix, approve or request changes, or run linters. Output comments ready to paste into the PR.

When the user says "stop caveman-review" or "normal mode", revert to verbose review style until re-invoked.
