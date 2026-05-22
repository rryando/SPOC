---
name: performance-diagnosis
description: Use when diagnosing performance issues, interpreting profiling data, designing benchmarks, or guiding optimization — for the code-doctor sub-agent
---

# Performance Diagnosis

## Overview

Premature optimization is the root of all evil. Uninformed optimization is its twin.

**Core principle:** MEASURE BEFORE OPTIMIZING. Every optimization must be justified by profiling data, not intuition.

**Violating the letter of this process is violating the spirit of performance work.**

## The Iron Law

```
MEASURE BEFORE OPTIMIZING. NO PREMATURE OPTIMIZATION.
```

If you haven't completed Phase 1, you cannot propose optimizations.
If you can't show a measurement proving the bottleneck, the optimization is premature.

## When to Use

Use for ANY performance concern:
- Slow API responses
- High memory consumption
- CPU-bound operations blocking event loop
- Database query latency
- Frontend rendering jank
- Build/CI pipeline slowness
- Memory leaks
- Throughput degradation under load

**Use this ESPECIALLY when:**
- Someone says "it feels slow" (feelings aren't metrics)
- A "quick optimization" seems obvious
- You're tempted to add caching without measuring
- Previous optimization didn't help or made things worse
- Performance degraded after a deploy

**Don't skip when:**
- The fix seems obvious (obvious fixes often miss the real bottleneck)
- It's "just" adding an index (prove the query is the bottleneck first)
- Someone senior suggested the optimization (authority ≠ data)

## The Four Phases

You MUST complete each phase before proceeding to the next.

### Phase 1: Baseline Measurement

**Goal:** Establish quantitative metrics and define "fast enough."

**Steps:**
1. Define the performance goal — what does "fast enough" mean? Get a concrete threshold (e.g., p95 < 200ms, RSS < 512MB, throughput > 1000 req/s).
2. Measure current state under realistic conditions:
   - **Time:** Wall-clock, CPU time, time-to-first-byte, time-to-interactive
   - **Memory:** RSS, heap used/total, heap growth over time, GC pressure
   - **CPU:** Utilization %, event loop lag, thread pool saturation
   - **I/O:** Disk reads/writes, network round-trips, connection pool usage
   - **Throughput:** Requests/second, operations/second at saturation
3. Record environment: hardware, OS, Node version, concurrent load, dataset size.
4. Run measurements multiple times. Note variance. Discard outliers. Use medians.
5. Document baseline clearly — this is your "before" snapshot.

**Success criteria:** You have numbers. You have a target. The gap is quantified.

**Tools:**
- Node.js: `process.hrtime.bigint()`, `process.memoryUsage()`, `perf_hooks`
- Load testing: k6, autocannon, wrk
- APM: Datadog, New Relic, or lightweight custom timing middleware
- Browser: Lighthouse, Web Vitals, Performance API

### Phase 2: Bottleneck Identification

**Goal:** Find WHERE time/resources are actually spent. Not where you think they are.

**Steps:**
1. Profile the hot path end-to-end. Do NOT guess.
2. Interpret profiling data:
   - **Flame graphs:** Look for wide bars (time consumers), not deep stacks. Flat tops = CPU-bound work. Many thin calls = death by a thousand cuts.
   - **Heap snapshots:** Compare snapshots over time. Growing retained size = leak. Large arrays/buffers = allocation pressure.
   - **Event loop lag:** >50ms = blocking operation on main thread. Identify synchronous offenders.
   - **DB query plans (EXPLAIN/EXPLAIN ANALYZE):** Sequential scans on large tables, missing indexes, high row estimates vs actuals, nested loop joins on unindexed columns.
   - **N+1 detection:** Count queries per request. If O(n) queries for n items, you have N+1.
   - **Network waterfall:** Sequential requests that could be parallel. Unnecessary round-trips. Large payloads.
3. Rank bottlenecks by impact. The biggest contributor gets attention first.
4. Verify the bottleneck accounts for the gap between baseline and target.

**Success criteria:** You can point to a specific function/query/operation and say "this accounts for X% of the latency."

**Tools:**
- Node.js CPU profiling: `node --inspect` + Chrome DevTools, `clinic flame`, `clinic doctor`
- Memory: `node --inspect` heap snapshots, `clinic heap`, `--max-old-space-size` experiments
- Event loop: `clinic bubbleprof`, `blocked-at`, `perf_hooks.monitorEventLoopDelay()`
- Database: `EXPLAIN ANALYZE` (Postgres), slow query log (MySQL), `.explain()` (MongoDB)
- Network: Chrome DevTools Network tab, `curl -w` timing, HAR analysis
- System: `strace`, `perf`, `/proc/[pid]/status`

### Phase 3: Hypothesis & Benchmark

**Goal:** Form a testable hypothesis about the optimization, then isolate and prove it.

**Steps:**
1. State hypothesis explicitly: "Replacing X with Y will reduce latency by ~Z% because [mechanism]."
2. Design a micro-benchmark that isolates the bottleneck:
   - Test ONE variable at a time
   - Use realistic data sizes (not trivial inputs)
   - Warm up JIT before measuring
   - Run enough iterations for statistical significance
   - Control for GC pauses (use `--expose-gc` + manual GC between runs if needed)
3. Run benchmark with current implementation (confirms profiling findings).
4. Run benchmark with proposed optimization.
5. Compare. Is the improvement significant? Does it close the gap to target?

**Success criteria:** Micro-benchmark proves the hypothesis with >20% improvement on the isolated operation, OR disproves it (return to Phase 2).

**Anti-patterns:**
- Benchmarking with trivial inputs (n=10 when production has n=100,000)
- Not warming up (first-run JIT compilation skews results)
- Measuring wall-clock on a shared machine without controlling load
- Changing multiple things between benchmark runs

**Tools:**
- Micro-benchmarks: `tinybench`, `benny`, manual `perf_hooks` timing loops
- Statistical analysis: multiple runs, compute mean/median/p95/stddev
- A/B comparison: run old vs new back-to-back, same conditions

### Phase 4: Targeted Optimization

**Goal:** Implement the optimization, prove it works end-to-end, verify no regressions.

**Steps:**
1. Implement the single optimization identified in Phase 3.
2. Re-run the FULL baseline measurement from Phase 1 (same conditions, same environment).
3. Compare end-to-end metrics to baseline:
   - Did latency/memory/CPU improve as predicted?
   - Did any OTHER metric regress? (memory for speed tradeoffs, etc.)
4. Run the full test suite — correctness must not degrade.
5. If improvement < 10% end-to-end: seriously question whether the complexity is worth it.
6. Document: what changed, why, before/after numbers, any tradeoffs accepted.

**Success criteria:** End-to-end metrics meet target OR demonstrable progress toward target with clear next steps.

**If optimization didn't help:**
- Return to Phase 2. Your bottleneck identification was wrong.
- Do NOT stack another optimization on top hoping it compounds.

## Red Flags — STOP and Follow Process

If you catch yourself thinking:
- "This is obviously slow, let me optimize it"
- "Just add a cache here"
- "Let me add an index, that always helps"
- "Rewrite in a faster language/framework"
- "Pre-compute everything at startup"
- "Batch all the things"
- "Use a worker thread" (without proving CPU-bound)
- "Memoize this function" (without proving it's called repeatedly with same args)
- "Switch to streams" (without proving memory is the constraint)
- Optimizing a function that runs once at startup
- Optimizing a path that handles 0.1% of traffic
- Adding complexity for theoretical future load

**ALL of these mean: STOP. Return to Phase 1. Get measurements first.**

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "It's obviously the database" | Profile first. Often it's serialization, N+1, or network overhead. |
| "Caching will fix it" | Cache invalidation is a hard problem. Prove the cache hit rate justifies complexity. |
| "We need to rewrite this" | 90% of rewrites don't address the actual bottleneck. Measure first. |
| "Async will make it faster" | Async helps I/O-bound work. CPU-bound work needs worker threads or algorithmic fixes. |
| "It's O(n²), must optimize" | If n is always < 100, O(n²) is fine. Measure actual impact. |
| "Just add an index" | Wrong index = wasted disk + slower writes. EXPLAIN first. |
| "Premature optimization" (to avoid ALL optimization) | When measurements prove a bottleneck, optimization is NOT premature. |
| "10% improvement isn't worth it" | Depends on context. 10% on p99 at scale = meaningful. 10% on a cold path = waste. |
| "We'll optimize later" | Tech debt grows. But: only optimize NOW if measurements justify it. |

## SPOC Integration

### Dual-Mode Operation

This skill works in two modes:

**Mode A — Direct SPOC MCP Access:**
When the code-doctor sub-agent has SPOC tools available:
1. After Phase 2, capture profiling findings as a knowledge entry (`kind: lesson` or `kind: gotcha`).
2. After Phase 4, if optimization requires non-trivial work, propose a task via `spoc_create_project_task`.
3. Link knowledge entries to relevant source files via `sourceFiles`.

**Mode B — Structured Artifact Return:**
When operating without direct SPOC access, return findings as structured output:
```
## Performance Diagnosis Report
- **Baseline:** [metrics]
- **Bottleneck:** [identified location + evidence]
- **Hypothesis:** [proposed optimization + expected improvement]
- **Recommendation:** [action items with priority]
- **Knowledge to capture:** [reusable findings for SPOC knowledge entry]
```

### Knowledge Entry Patterns

Capture as knowledge when:
- A non-obvious bottleneck is found (saves future investigation)
- A common pattern in the codebase causes performance issues
- Profiling reveals surprising behavior (JIT deopt, GC thrashing, etc.)
- An optimization technique works well for this stack

## Quick Reference

| Phase | Key Activities | Success Criteria |
|-------|---------------|------------------|
| **1. Baseline** | Measure time/memory/CPU/I/O, define target | Numbers exist, gap quantified |
| **2. Bottleneck** | Profile, interpret flame/heap/queries, rank | Specific location + % contribution identified |
| **3. Hypothesis** | State theory, design micro-benchmark, isolate | Proven or disproven with data |
| **4. Optimization** | Implement, re-measure end-to-end, verify | Target met, no regressions |

## Optimization Decision Matrix

| Improvement | Hot Path? | Adds Complexity? | Decision |
|-------------|-----------|-------------------|----------|
| >50% | Yes | Any | Do it |
| 20-50% | Yes | Low | Do it |
| 20-50% | Yes | High | Consider, document tradeoff |
| 10-20% | Yes | Low | Do it if easy |
| 10-20% | Yes | High | Probably skip |
| <10% | Any | Any | Skip unless p99 at massive scale |
| Any | No (cold path) | Any | Skip |

## Related Skills

- **superpowers:systematic-debugging** — When performance issue is actually a bug (infinite loop, memory leak from logic error)
- **superpowers:test-driven-development** — For writing regression benchmarks that catch future performance degradation
- **superpowers:verification-before-completion** — Verify optimization holds under production-like conditions before claiming done
