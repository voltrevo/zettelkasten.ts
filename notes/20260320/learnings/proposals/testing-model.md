# Proposal: three-layer testing model

## Supersedes

This proposal supersedes `failing-tests.md`. The `kind=fails` relationship
described there is replaced by the evaluation metadata table below. The
`BROKEN:` description prefix convention remains useful for human-readable
search discoverability and is not replaced.

---

## The problem with encoding outcome in relationship kind

The original `kind=fails` proposal embeds outcome into the relationship type.
This conflates three distinct concerns:

- **Applicability** — is this test relevant to this atom?
- **Meaning** — what does it mean if this test fails against this atom?
- **History** — what happened when this test was actually run?

Separating these gives a cleaner model with richer semantics and avoids
overloading relationship names.

---

## Three layers

### Layer 1: relationships (applicability only)

The `kind=tests` relationship means exactly one thing: this test atom is
applicable to this target atom. No outcome, no interpretation.

```
kind=tests  from=<test>  to=<target>   # T is applicable to target
```

This is the only test-related relationship kind. `kind=fails` does not exist
in this model.

---

### Layer 2: test evaluation metadata (meaning)

A dedicated SQLite table encodes what each test-target pair *means*:

```sql
CREATE TABLE test_evaluation (
  test_atom     TEXT NOT NULL,
  target_atom   TEXT NOT NULL,
  mode          TEXT NOT NULL CHECK (mode IN ('contract', 'benchmark')),
  expected_outcome TEXT NOT NULL
    CHECK (expected_outcome IN ('pass', 'violates_intent', 'falls_short')),
  commentary    TEXT,
  PRIMARY KEY (test_atom, target_atom)
);
```

**`mode`:**
- `contract` — the test checks correctness / original intent. A failure
  means the atom does not satisfy its claimed behavior.
- `benchmark` — the test checks relative quality: performance, capability,
  or fitness. A failure means the atom is valid but no longer competitive.

**`expected_outcome`:**
- `pass` — the test is expected to pass. This is the default for all
  registered test relationships; if no metadata row exists, `pass` is assumed.
- `violates_intent` — the test is expected to fail because the atom is
  broken. Objective evidence of a correctness defect. (`mode=contract` only)
- `falls_short` — the test is expected to fail because the atom is outdated
  or outclassed in the dimension the test measures. Not broken, just
  superseded in that dimension. (`mode=benchmark` only)

**One row per (test, target) pair.** This is the current intended
interpretation, not a history. Avoid storing multiple rows here; use the
runs table (layer 3) for history.

---

### Layer 3: test runs (execution history)

A dedicated append-only SQLite table records every execution:

```sql
CREATE TABLE test_runs (
  id          INTEGER PRIMARY KEY,
  test_atom   TEXT NOT NULL,
  target_atom TEXT NOT NULL,
  run_by      TEXT NOT NULL CHECK (run_by IN ('checker', 'agent')),
  result      TEXT NOT NULL CHECK (result IN ('pass', 'fail')),
  duration_ms INTEGER,
  memory_rss  INTEGER,
  details     TEXT,           -- structured or freeform failure output
  ran_at      TEXT NOT NULL   -- ISO 8601 UTC
);
```

**Append-only.** Never update or delete rows. This is a permanent record of
what happened.

**`run_by`:** distinguishes checker-authoritative runs from agent-local
exploration runs (see authority model below).

**Metrics** (`duration_ms`, `memory_rss`) are observational only. They are
not used for pass/fail determination but enable performance tracking,
flakiness detection, and regression analysis over time.

---

## Authority model

**Checker runs are authoritative.** When the checker executes a test, the
result is stored in `test_runs` with `run_by='checker'` and is the ground
truth for corpus health, `zts exec` warnings, and relationship registration.

**Agent-local runs are exploratory.** When an agent runs `zts test` from
within the agent container, results are stored with `run_by='agent'`. These
are useful for rapid iteration but do not affect corpus state. An agent
cannot change the authoritative status of an atom by running tests locally.

**Divergence is a meaningful signal.** If agent-local and checker runs
disagree on the same (test, target) pair, this suggests an environment
difference worth investigating — nondeterminism, platform-specific behavior,
or resource limit effects.

```
Local = exploration
Checker = truth
```

---

## Execution semantics

### Default: `zts test <hash>`

1. Query `kind=tests` relationships to find applicable tests for `<hash>`
2. Join with `test_evaluation` metadata
3. Execute only tests where `expected_outcome = 'pass'` (or no metadata row)
4. Run via checker; store results in `test_runs`

### Querying non-default tests

Agents can explicitly query other outcomes to understand atom state:

```sh
# Tests that are expected to fail (correctness evidence against the atom)
zts test <hash> --expected violates_intent

# Tests that show where the atom falls short (improvement opportunities)
zts test <hash> --expected falls_short
```

These run via checker and store results, but do not affect `zts exec`
warnings on their own (see below).

---

## CLI

### Register a test relationship (applicability)

```sh
zts post -m "..." -t "<test-hash>" /tmp/impl.ts
# → registers kind=tests from=<test> to=<new-atom> with expected_outcome=pass
```

This is unchanged. The `-t` gate runs the test via checker and registers
the relationship + metadata (expected_outcome=pass) atomically.

### Mark an atom as having a correctness defect (`violates_intent`)

```sh
zts fail <test-hash> <target-hash>
```

Sets `expected_outcome=violates_intent, mode=contract` in `test_evaluation`
for this (test, target) pair. The server:
1. Verifies the test already has `expected_outcome=pass` against at least
   one other atom (proves the test is valid, not buggy)
2. Runs the test against the target via checker; verifies it actually fails
3. Stores the metadata row on success

Precondition failure → 422. This is the same precondition as the old
`kind=fails` proposal, now enforced at the metadata level.

### Mark a benchmark expectation (`falls_short`)

```sh
zts benchmark <test-hash> <target-hash>
```

Sets `expected_outcome=falls_short, mode=benchmark` in `test_evaluation`.
No precondition check — a benchmark test expressing selection pressure does
not need to be validated against a "fix." The test is run via checker and
must actually fail against the target (otherwise the `falls_short` claim is
wrong).

### Read evaluation metadata

```sh
zts eval show <test-hash> <target-hash>
# → mode, expected_outcome, commentary

zts eval set <test-hash> <target-hash> --commentary "why this is expected to fail"
# → update commentary on an existing metadata row (does not change outcome)
```

---

## Effect on `zts exec`

If the atom (or any transitive dependency) has `expected_outcome=violates_intent`
metadata against any test, `zts exec` warns before running:

```
warning: 3ax9b... has known correctness defects:
  test b7f2... (contract): violates intent — <commentary if set>
  Run `zts tops 3ax9b` to find corrected alternatives.
```

`falls_short` metadata produces a softer notice:

```
note: 3ax9b... may have better alternatives (run `zts tops 3ax9b`).
```

Override with `--allow-failures` to suppress all warnings.

---

## Auto-registration of `kind=supersedes`

The bridge to the supersedes proposal: when `zts fail <T> <A>` succeeds
(establishing `violates_intent` metadata for T against A) and T already has
`expected_outcome=pass` metadata against atom B, the server auto-registers:

```
kind=supersedes  from=B  to=A
```

This is the same auto-registration logic as before, now triggered by
metadata state rather than `kind=fails` relationships.

---

## Summary

| Layer | Table | What it stores |
|---|---|---|
| Applicability | `relationships` (kind=tests) | which tests apply to which atoms |
| Meaning | `test_evaluation` | what failure means for each pair |
| History | `test_runs` | every execution, with metrics |

Checker runs are authoritative. Agent runs are exploratory. Divergence
between the two is a signal worth noting.
