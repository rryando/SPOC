---
name: systematic-debugging
description: Use when encountering any bug, test failure, or unexpected behavior, before proposing fixes
---

# Systematic Debugging

## Overview

Random fixes waste time and create new bugs. Quick patches mask underlying issues.

**Core principle:** ALWAYS find root cause before attempting fixes. Symptom fixes are failure.

**Violating the letter of this process is violating the spirit of debugging.**

## The Iron Law

```
NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST
```

If you haven't completed Phase 1, you cannot propose fixes.

## When to Use

Use for ANY technical issue:
- Test failures
- Bugs in production
- Unexpected behavior
- Performance problems
- Build failures
- Integration issues

**Use this ESPECIALLY when:**
- Under time pressure (emergencies make guessing tempting)
- "Just one quick fix" seems obvious
- You've already tried multiple fixes
- Previous fix didn't work
- You don't fully understand the issue

**Don't skip when:**
- Issue seems simple (simple bugs have root causes too)
- You're in a hurry (rushing guarantees rework)
- Manager wants it fixed NOW (systematic is faster than thrashing)

## The Four Phases

You MUST complete each phase before proceeding to the next. Full playbook — including the multi-component evidence-gathering template, data-flow tracing, and the 3+ failed-fixes → question-architecture escalation — lives in **`phases-reference.md`** in this directory. Load it when running an active debugging session.

1. **Root Cause Investigation** — Read errors, reproduce consistently, check recent changes, instrument component boundaries, trace data flow backward. Do not propose fixes until this phase is complete.
2. **Pattern Analysis** — Find working examples in the same codebase. Compare working vs. broken. List every difference. Understand dependencies.
3. **Hypothesis and Testing** — Form a single, specific hypothesis. Test with the smallest possible change. One variable at a time. If it fails, form a new hypothesis — do not stack fixes.
4. **Implementation** — Write a failing test case first. Implement a single targeted fix. Verify. If three fixes have failed, STOP and question the architecture before attempting a fourth.

## Log Triage Protocol

When facing runtime failures, crashes, or unexpected behavior with log output available:

### Scan Order (Newest-First)

1. **Start at the failure point** — Find the final error/exception, read backward
2. **Error grep** — `rg -n "ERROR|FATAL|panic|exception|stack" <logfile>`
3. **Timestamp correlation** — Identify when things went wrong vs. last known-good
4. **Request-ID tracing** — Follow a single request through distributed logs

### Priority Triage

```
errors > warnings > unexpected patterns > timing anomalies
```

### Tooling

- `rg '<pattern>' --glob '*.log'` — Fast pattern search across log files
- `jq 'select(.level == "error")' <json-log>` — Filter structured JSON logs
- `rg --after-context=5 'ERROR' <logfile> | head -50` — Errors with surrounding context
- Timestamp range: `rg '2024-01-15T1[4-5]:' <logfile>` — Filter to suspicious window

### Output

Produce a **timeline of events leading to failure**:
```
T-5m: Last successful request (req-abc123)
T-3m: Warning: connection pool exhaustion
T-1m: Timeout on downstream service call
T-0:  Fatal: unhandled rejection in request handler
```

This timeline feeds directly into Phase 1 (Root Cause Investigation).

## Binary Search / Git Bisect

### When to Use

- "It worked before" / regression scenarios
- Behavior changed but no obvious commit is responsible
- Large commit history between known-good and known-bad states

### Protocol

1. **Identify good commit** — Last known working state (tag, SHA, or date)
2. **Identify bad commit** — Current broken state (usually HEAD)
3. **Define test** — Command that exits 0 for good, non-zero for bad
4. **Run bisect**

```bash
git bisect start
git bisect bad <bad-sha>    # or HEAD
git bisect good <good-sha>
git bisect run <test-command>
```

### Fallback: Manual Bisect

When no automated test exists:
```bash
git bisect start
git bisect bad
git bisect good <sha>
# At each step: manually verify, then:
git bisect good  # or git bisect bad
```

### After Finding the Commit

- Read the diff carefully — root cause is in that change
- Don't assume the entire commit is wrong; isolate the specific line(s)
- Feed findings into Phase 2 (Pattern Analysis)

## Repro Script Generation

### When to Write

- Bug is environment-dependent or intermittent
- Multi-step setup required to trigger
- Multiple people need to verify the issue
- Fix validation needs automation

### Structure

Minimal script that reliably triggers the bug:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Preconditions
# - Node >= 18
# - PORT 3000 available

# Setup
npm ci --ignore-scripts
echo '{"broken": true}' > /tmp/test-config.json

# Trigger
REPRO_CONFIG=/tmp/test-config.json node src/server.js &
SERVER_PID=$!
sleep 2

# Verify bug manifests
RESPONSE=$(curl -s http://localhost:3000/endpoint)
echo "$RESPONSE" | grep -q "unexpected_value" && echo "BUG REPRODUCED" || echo "NOT REPRODUCED"

# Cleanup
kill $SERVER_PID 2>/dev/null
rm /tmp/test-config.json
```

### Requirements

- **Deterministic** — Same result every run (or documents flakiness rate)
- **Isolated** — No side effects on host system, cleans up after itself
- **Documents preconditions** — Comments state what's needed
- **Exit code** — 0 = bug reproduced, 1 = not reproduced

### Purpose

1. Proves bug exists (for skeptics and CI)
2. Validates fix (flip expected output)
3. Seeds regression test (promote to test suite)

## Dependency Conflict Diagnosis

### When to Suspect

- "Works in isolation, fails in integration"
- Version mismatch errors at runtime
- Duplicate class/module instances
- Type errors that shouldn't exist given your deps

### Diagnostic Steps

1. **Check for duplicates in lock file:**
   ```bash
   npm ls <suspect-package>
   ```

2. **Understand resolution path:**
   ```bash
   npm explain <suspect-package>
   ```

3. **Look for multiple copies:**
   ```bash
   find node_modules -name "package.json" -path "*/<pkg>/package.json" \
     -exec grep '"version"' {} +
   ```

4. **Test with forced resolution:**
   ```bash
   # package.json overrides (npm)
   "overrides": { "<pkg>": "<version>" }
   ```

5. **Isolate transitive conflicts:**
   ```bash
   npm ls --all | rg '<pkg>'
   ```

### Common Patterns

| Symptom | Likely Cause |
|---------|-------------|
| `instanceof` fails across modules | Duplicate package copies |
| Type mismatch on same-named interface | Different versions loaded |
| "Cannot find module" intermittent | Hoisting conflict |
| Works with `--legacy-peer-deps` | Peer dep unsatisfied |

## Red Flags — STOP and Follow Process

If you catch yourself thinking:
- "Quick fix for now, investigate later"
- "Just try changing X and see if it works"
- "Add multiple changes, run tests"
- "Skip the test, I'll manually verify"
- "It's probably X, let me fix that"
- "I don't fully understand but this might work"
- "Pattern says X but I'll adapt it differently"
- "Here are the main problems: [lists fixes without investigation]"
- Proposing solutions before tracing data flow
- **"One more fix attempt" (when already tried 2+)**
- **Each fix reveals new problem in different place**

**ALL of these mean: STOP. Return to Phase 1.**

**If 3+ fixes failed:** Question the architecture (see Phase 4 step 5 in `phases-reference.md`).

## your human partner's Signals You're Doing It Wrong

**Watch for these redirections:**
- "Is that not happening?" — You assumed without verifying
- "Will it show us...?" — You should have added evidence gathering
- "Stop guessing" — You're proposing fixes without understanding
- "Ultrathink this" — Question fundamentals, not just symptoms
- "We're stuck?" (frustrated) — Your approach isn't working

**When you see these:** STOP. Return to Phase 1.

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "Issue is simple, don't need process" | Simple issues have root causes too. Process is fast for simple bugs. |
| "Emergency, no time for process" | Systematic debugging is FASTER than guess-and-check thrashing. |
| "Just try this first, then investigate" | First fix sets the pattern. Do it right from the start. |
| "I'll write test after confirming fix works" | Untested fixes don't stick. Test first proves it. |
| "Multiple fixes at once saves time" | Can't isolate what worked. Causes new bugs. |
| "Reference too long, I'll adapt the pattern" | Partial understanding guarantees bugs. Read it completely. |
| "I see the problem, let me fix it" | Seeing symptoms ≠ understanding root cause. |
| "One more fix attempt" (after 2+ failures) | 3+ failures = architectural problem. Question pattern, don't fix again. |

## Quick Reference

| Phase | Key Activities | Success Criteria |
|-------|---------------|------------------|
| **1. Root Cause** | Read errors, reproduce, check changes, gather evidence | Understand WHAT and WHY |
| **2. Pattern** | Find working examples, compare | Identify differences |
| **3. Hypothesis** | Form theory, test minimally | Confirmed or new hypothesis |
| **4. Implementation** | Create test, fix, verify | Bug resolved, tests pass |

## When Process Reveals "No Root Cause"

If systematic investigation reveals issue is truly environmental, timing-dependent, or external:

1. You've completed the process
2. Document what you investigated
3. Implement appropriate handling (retry, timeout, error message)
4. Add monitoring/logging for future investigation

**But:** 95% of "no root cause" cases are incomplete investigation.

## Supporting Techniques

These techniques are part of systematic debugging and available in this directory:

- **`phases-reference.md`** — Full four-phase playbook with examples and escalation rules
- **`root-cause-tracing.md`** — Trace bugs backward through call stack to find original trigger
- **`defense-in-depth.md`** — Add validation at multiple layers after finding root cause
- **`condition-based-waiting.md`** — Replace arbitrary timeouts with condition polling

**Integrated protocols** (sections above):
- **Log Triage Protocol** — Structured log reading for runtime failures
- **Binary Search / Git Bisect** — Regression isolation via commit bisection
- **Repro Script Generation** — Deterministic bug reproduction for validation
- **Dependency Conflict Diagnosis** — Version mismatch and duplicate-package isolation

**Related skills:**
- **spoc:test-driven-development** — For creating failing test case (Phase 4, Step 1)
- **spoc:verification-before-completion** — Verify fix worked before claiming success

## Real-World Impact

From debugging sessions:
- Systematic approach: 15–30 minutes to fix
- Random fixes approach: 2–3 hours of thrashing
- First-time fix rate: 95% vs 40%
- New bugs introduced: Near zero vs common

## Dual-Mode SPOC Integration

Debugging findings are organizational knowledge. Capture them.

### Mode A: Agent Has SPOC MCP Access

After identifying root cause:
1. **Write knowledge entry** — `create_project_knowledge_entry` with kind `gotcha` (environmental/config traps) or `lesson` (architectural insights)
2. **Create fix task** — `create_project_task` linked to governing plan if applicable
3. **Update plan status** — If debugging revealed a blocked plan, transition it

### Mode B: Returning to Orchestrator

Structure your report for the orchestrator to persist:
```
## Root Cause
<one-sentence summary>

## Evidence
<timeline, bisect result, or repro script>

## Proposed Knowledge Entry
- kind: gotcha | lesson
- title: <descriptive>
- summary: <one-line>
- keywords: [relevant, searchable, terms]

## Proposed Task
- title: <fix description>
- priority: high | medium
- planId: <if applicable>
```

### Always

- Capture root cause as reusable knowledge for future sessions
- Include enough context that a different agent can understand without re-investigating
- Link to specific files/functions via `sourceFiles` when possible
