# Graphify Diff Algorithm

`graphify` has no native "diff against PR" command. This file defines how `deep-pr-review` builds coupling/duplication checks on top of the existing `affected`, `query`, and `diagnose multigraph` primitives.

## Prerequisites

```bash
which graphify || echo "skip"            # graceful absence
ls graphify-out/graph.json 2>/dev/null   # graph must exist
```

If graphify is missing or `graph.json` is older than the PR's base commit, refresh:
```bash
graphify update .
```

## Step 1: Extract changed symbols from the diff

```bash
gh pr diff <num> --patch > /tmp/pr.diff
```

Parse `/tmp/pr.diff` to extract changed symbols:
- For each `+++ b/<file>` hunk, capture the file path
- For each added / modified function or exported identifier, capture `<file>::<symbol>`
- Skip pure deletions (handled separately under "removed coupling" check)

Heuristic for symbol extraction (language-aware):
- TypeScript / JavaScript: `function X`, `class X`, `export const X`, `export function X`, `const X = `
- Python: `def X`, `class X`
- Go: `func X`, `type X`
- Rust: `fn X`, `struct X`, `impl X`
- Other: fall back to file-level granularity

## Step 2: Run `affected` per changed symbol

```bash
graphify affected "<file>::<symbol>" --depth 2 --json
```

Collect for each symbol:
- **Fan-out callers** — who depends on this symbol (changes ripple here)
- **Fan-out depth** — how many hops to leaves
- **Cross-module edges** — callers in different top-level dirs

## Step 3: Detect surprising fan-out

Flag as 🟠 **risk** in the report when:

| Pattern | Meaning |
|---------|---------|
| Changed symbol has >10 callers across >3 modules | Wide blast radius — non-obvious from diff alone |
| Changed signature on a symbol with >5 callers | Breaking-change risk |
| New symbol has same name as existing symbol in another module | Naming collision risk → DRY check |

## Step 4: Duplication check

For each new function added in the diff, run:
```bash
graphify query "functions similar to <new-symbol-signature>" --budget 8 --json
```

If results include symbols with similar signatures (≥70% name overlap or matching parameter shape), flag as 🟡 **suggestion** with citation `graphify: similar to <existing-symbol>` and propose extraction or reuse.

## Step 5: Diagnose multigraph (architectural drift)

```bash
graphify diagnose multigraph --json
```

If the PR introduces edges that contribute to a multigraph collapse (multiple edges between the same node pair), flag as 🟠 **risk** with handoff to `architecture-review`. Same-endpoint multi-edges are a structural duplication signal worth surfacing but not worth diagnosing inline.

## Step 6: Aggregate findings

Each graphify-derived finding must include:
- The `graphify` command that produced it (for reproducibility)
- The cited symbol(s) — use backticks
- The cited module path(s)
- A finding ID for re-review tracking: `<file>:<line>:<dimension>:<short-hash>`

## Performance bounds

- Cap symbols analyzed per PR at 50. If diff contains more, sample by:
  - All exported / public symbols first (always)
  - Then internal symbols by descending hunk size
- Skip step 4 (duplication) entirely if diff size exceeds 1500 LOC — too noisy
- Skip step 5 (multigraph) if `graphify diagnose multigraph` runtime exceeds 10s — log and continue without

## Graceful degradation

If any graphify call fails or returns empty:
- Note in report: `Graphify step <N> unavailable: <reason>` under "Cleared Dimensions"
- Continue with the remaining dimensions
- Never let a graphify failure abort the review

## Output integration

Graphify findings flow back into the standard finding pipeline. Each one is:
- Cited as `graphify: <one-line observation>`
- Severity-classified (most are 🟡 suggestion or 🟠 risk; rarely 🔴)
- Attached to a specific file+line if possible; otherwise lives in the top-level review body
- Tagged for re-review with `<!-- arcs:deep-review:<finding-id> -->`
