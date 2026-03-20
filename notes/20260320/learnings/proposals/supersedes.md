# Proposal: `kind=supersedes` relationship

## Relationship to `kind=fails`

`kind=fails` is the primary signal that an atom is outdated or broken. It is
objective: a test reproducibly fails, the evidence is machine-verifiable, and
the relationship links three atoms — the broken one, the test that proves it,
and (via `kind=tests`) the fixed one. This locality makes `kind=fails` the
stronger signal: prefer it whenever a test can demonstrate the difference.

`kind=supersedes` is the general case. It covers situations where test evidence
exists but also situations where it does not:

- V2 adds features V1 lacks, but V1 is not broken — just less capable
- A reimplementation is cleaner or faster, not more correct
- Two atoms diverge: both improve on a common ancestor in incompatible ways
- A manual declaration without any test evidence

Use `kind=fails` when you have a test. Use `kind=supersedes` when you don't, or
when the relationship is about capability rather than correctness.

---

## Semantics

```
kind=supersedes  from=<newer>  to=<older>
```

"The `newer` atom supersedes the `older` atom." The `from` atom is the
improvement; the `to` atom is what it replaces.

Superseding is not a total order. An atom can be superseded by multiple atoms
that are better in non-overlapping or incompatible ways:

```
       [V1]
      /    \
[fast]    [full]
```

`fast` supersedes V1 (handles common opcodes, minimal footprint). `full`
supersedes V1 (complete spec compliance, larger). `fast` does not supersede
`full` and vice versa — they are valid alternatives for different use cases.

A "top" is an atom with no outgoing `supersedes` edges — nothing further
supersedes it. Multiple tops are the norm for any lineage that has diverged.

---

## Auto-registration from test evidence

When `zts fail <T> <A>` establishes `expected_outcome=violates_intent` for test
T against atom A, and T already has `expected_outcome=pass` against atom B, the
server has objective evidence that B fixes what A broke. It auto-registers:

```
kind=supersedes  from=B  to=A
```

This happens silently as part of the `zts fail` operation. The agent does not
need to do anything extra. See `proposals/testing-model.md` for the full testing
model this relies on.

Auto-registration only fires when both sides of the test evidence are present.
Manual `supersedes` registrations (without test evidence) are always permitted.

---

## CLI

**Register manually:**

```sh
zts relate <newer-hash> <older-hash> supersedes
```

No test is run. This is a declaration. The CLI confirms the relationship was
stored.

**Navigate to tops:**

```sh
zts tops <hash> [--limit N] [--all]
```

Walks the `supersedes` graph from `<hash>` upward (following "superseded by"
edges) using BFS. Returns tops — atoms not themselves superseded by anything —
in order of increasing distance from the starting atom. Default limit: 5.

**Level-completion rule:** the limit is applied at level boundaries, not
mid-level. If the Nth top falls in the middle of a BFS level, the entire level
is included. This ensures the output is never an arbitrary mid-branch cutoff.

Example:

```
3ax9b... (wasmFuncRunner V1)
├── f7c2d... (wasmFuncRunnerFast)         ← top, depth 1
├── 91be4... (wasmFuncRunnerFull)
│   └── c33a1... (wasmFuncRunnerFullV2)   ← top, depth 2
└── 4bd9e... (wasmFuncRunnerAsync)        ← top, depth 1
```

```sh
$ zts tops 3ax9b

3 of 3 tops found.

Depth 1:
  f7c2d... wasmFuncRunnerFast — handles common opcodes, minimal footprint
  4bd9e... wasmFuncRunnerAsync — async-first interface for event loops

Depth 2:
  c33a1... wasmFuncRunnerFullV2 — complete spec compliance, fixed trap handling
```

When the limit clips mid-level, the output says so:

```
5 of 9 tops shown (--limit 5; depth-3 level completed with 7).
Use --limit N or --all to see more.
```

When the starting atom is already a top:

```
3ax9b... is already a top — not superseded by anything.
```

**Find what an atom supersedes:**

```sh
zts rels --from <hash> --kind supersedes
```

(Covered by the general `zts rels` command from `proposals/cli-additions.md`.)

---

## Effect on search and exec

**Search:** results that have been superseded are annotated:

```
3ax9b... wasmFuncRunner V1
  [superseded by: f7c2d (fast), 91be4 (full) — run `zts tops 3ax9b` for details]
```

The superseded atom still appears in results (it may be the right choice for
someone who needs its specific tradeoffs), but the annotation surfaces that
better options exist.

**`zts exec`:** if the atom has been superseded, print a warning before running:

```
warning: 3ax9b... has been superseded. Run `zts tops 3ax9b` to see alternatives.
```

Not a rejection — just a heads-up. Override with `--allow-superseded` to
suppress the warning.

---

## What supersedes does not do

- It does not prevent the superseded atom from being imported by other atoms.
  Breaking that would cascade through the dependency graph and is the wrong
  tool. `kind=fails` handles correctness enforcement.
- It does not imply the superseded atom is broken. A superseded atom may be
  perfectly correct and even preferable in some contexts.
- It does not require the newer atom to be a drop-in replacement. The two atoms
  may have different interfaces entirely.

---

## Guidance for agents

Mark `supersedes` proactively when posting a V2:

```sh
# After posting wasmFuncRunnerFast that improves on wasmFuncRunner:
zts relate <fast-hash> <v1-hash> supersedes
```

If you used the test gate (`-t`) and a failing test already existed for V1, the
server auto-registered `supersedes` — check with
`zts rels --from <fast-hash>
--kind supersedes` before adding a duplicate.

When searching and you find a superseded atom, run `zts tops <hash>` to find the
current best alternatives before deciding whether to reuse or rebuild.

---

## Worker prompt additions

The per-iteration prompt (`zts script iteration`) must include the following
guidance so agents use supersedes correctly:

---

**After posting an atom that improves on an existing one**, register the
supersedes relationship:

```sh
zts relate <new-hash> <old-hash> supersedes
```

Do this based on your own judgment — you do not need a failing test to justify
it. Good reasons to mark supersedes:

- Your new atom handles more cases than the old one
- Your new atom is faster, smaller, or cleaner for the same task
- Your new atom fixes a bug (test evidence will auto-register this, but check
  and add manually if it didn't)
- The old atom solved a problem in a way that a different design renders
  obsolete

Multiple atoms can supersede the same old atom — mark all of them. The old atom
is not deleted and may still be the right choice for some callers.

**Before registering manually**, check if auto-registration already handled it:

```sh
zts rels --from <new-hash> --kind supersedes
```

If the server already registered it (because matching `kind=fails` /
`kind=tests` evidence existed), skip the manual step.

**When you encounter a superseded atom during search or navigation**, use
`zts tops` to find current alternatives before deciding to reuse or rebuild:

```sh
zts tops <hash>          # up to 5 tops, closest first
zts tops <hash> --all    # full lineage if you need the complete picture
```
