---
name: writing-skills
description: Use when creating new skills, editing existing skills, or verifying skills work before deployment
---

# Skill: writing-skills

## When

Creating, editing, or verifying skills — TDD applied to process documentation.

## Flow

```mermaid
flowchart TD
    A[Identify skill need] --> B[RED: Run pressure scenario WITHOUT skill]
    B --> C[Document agent failures + rationalizations]
    C --> D[GREEN: Write minimal SKILL.md addressing failures]
    D --> E[Re-run scenario WITH skill]
    E --> F{Agent complies?}
    F -->|no| D
    F -->|yes| G[REFACTOR: Find new rationalizations]
    G --> H{Bulletproof?}
    H -->|no| D
    H -->|yes| I[Deploy: lint-bundle → deploy-superpowers]
```

## TDD Mapping

| TDD Concept | Skill Creation |
|-------------|----------------|
| Test case | Pressure scenario with subagent |
| Production code | SKILL.md |
| RED | Agent violates rule without skill |
| GREEN | Agent complies with skill present |
| Refactor | Close loopholes, re-verify |

## When to Create

**Create:** Technique not obvious, reusable across projects, others would benefit.
**Don't:** One-off solutions, standard practices, project-specific conventions (use AGENTS.md).

## Skill Types

- **Technique:** Concrete method with steps
- **Pattern:** Way of thinking about problems
- **Reference:** API docs, syntax guides

## Iron Law

No skill without a failing test first. No edits without re-testing. Write before test? Delete. Start over.

## Constraints

- One skill at a time — deploy before starting next
- Run `spoc lint-bundle` then `spoc deploy-superpowers` after each skill
- See `skill-structure-reference.md` for directory layout and SKILL.md template
- See `cso-and-naming.md` for naming conventions
- See `testing-skills-with-subagents.md` for pressure testing methodology
- See `anthropic-best-practices.md` for official guidance
