---
name: caveman-commit
description: Use when writing git commit messages, especially when SPOC Caveman mode is active. Produces Conventional Commits with terse, intent-preserving prose. Subject ≤50 chars; body only when the "why" isn't obvious from the diff.
---

Write commit messages terse and exact. Conventional Commits format. No fluff. Why over what.

Adapted from https://github.com/JuliusBrussee/caveman (MIT).

## Rules

**Subject line:**
- \`<type>(<scope>): <imperative summary>\` — scope optional
- Types: \`feat\`, \`fix\`, \`refactor\`, \`perf\`, \`docs\`, \`test\`, \`chore\`, \`build\`, \`ci\`, \`style\`, \`revert\`
- Imperative mood: "add", "fix", "remove" — not "added", "adds", "adding"
- ≤50 chars when possible, hard cap 72
- No trailing period
- Match project convention for capitalization after the colon

**Body (only if needed):**
- Skip entirely when the subject is self-explanatory
- Add body only for: non-obvious *why*, breaking changes, migration notes, linked issues
- Wrap at 72 chars
- Bullets `-` not `*`
- Reference issues/PRs at end: `Closes #42`, `Refs #17`

**What NEVER goes in:**
- "This commit does X", "I", "we", "now", "currently" — the diff already says what
- "As requested by..." — use a `Co-authored-by` trailer instead
- AI attribution lines ("Generated with...", "Co-authored-by: Claude" unless explicitly requested)
- Emoji unless the project's existing history uses them
- Restating the filename when scope already says it

## Examples

New endpoint for user profile with non-obvious why:

```
feat(api): add GET /users/:id/profile

Mobile client needs profile data without the full user payload
to reduce LTE bandwidth on cold-launch screens.

Closes #128
```

Breaking API change:

```
feat(api)!: rename /v1/orders to /v1/checkout

BREAKING CHANGE: clients on /v1/orders must migrate to /v1/checkout
before 2026-06-01. Old route returns 410 after that date.
```

Trivial change (subject alone is enough):

```
chore(deps): bump vitest to 1.6.0
```

## Auto-Clarity — ALWAYS include a body for

- Breaking changes
- Security fixes (reference CVE or advisory)
- Data migrations
- Any commit that reverts a prior commit (name the SHA being reverted)

Future debuggers need the context — do not compress these into subject-only.

## Boundaries

This skill only generates the commit message. It does not run `git commit`, stage files, or amend. Output the message as a code block ready to paste.

When the user says "stop caveman-commit" or "normal mode", revert to verbose commit style until re-invoked.
