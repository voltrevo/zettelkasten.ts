# Three-layer testing model

## Layers

| Layer         | Table                        | What it stores                     |
| ------------- | ---------------------------- | ---------------------------------- |
| Applicability | `relationships` (kind=tests) | which tests apply to which atoms   |
| Meaning       | `test_evaluation`            | what pass/fail means for each pair |
| History       | `test_runs`                  | every execution, append-only       |

These are independent concerns. A test being _applicable_ to an atom says
nothing about whether it's expected to pass. The _meaning_ of a failure
(correctness defect vs improvement opportunity) is separate from whether the
test was _run_ and what happened.

---

## Layer 1: applicability

```
kind=tests  from=<test>  to=<target>
```

This is the only test-related relationship kind. It means: this test is relevant
to this atom. No outcome implied.

Registered via:

- `zts post -t <test-hash>` — the `-t` gate runs the test, stores the
  relationship + `expected_outcome=pass` metadata atomically
- `zts relate <test> <target> tests` — registers applicability; for kind=tests,
  the test is run via checker before the relationship is stored

---

## Layer 2: meaning

The `test_evaluation` table encodes what each test-target pair _means_:

**`mode=contract, expected_outcome=pass`** — the default. The test checks
correctness and is expected to pass. This is what `-t` gate registration
creates.

**`mode=contract, expected_outcome=violates_intent`** — the test reproduces a
bug. Objective evidence of a correctness defect. The atom is broken in a way
this test demonstrates.

**`mode=benchmark, expected_outcome=falls_short`** — the test measures a quality
dimension (capability, performance, coverage) the atom doesn't meet. The atom is
valid but outclassed.

### Registering meaning

**Correctness defect:**

```sh
zts fail <test-hash> <broken-hash>
```

Preconditions (server enforces):

1. The test already has `expected_outcome=pass` against at least one other atom
   (proves the test itself is valid)
2. Checker runs the test against the target and it actually fails

On success: sets `violates_intent` + `contract` in `test_evaluation`.
Auto-registers `kind=supersedes` from the passing atom to the broken one.

**Improvement opportunity:**

```sh
zts benchmark <test-hash> <target-hash>
```

No precondition — a benchmark doesn't need to be validated against a "fix."
Checker runs the test and verifies it actually fails against the target
(otherwise the `falls_short` claim is wrong).

---

## Layer 3: history

The `test_runs` table records every execution. Append-only, never updated or
deleted.

Every `zts test`, `zts fail`, `zts benchmark`, and `-t` gate operation appends a
row. The `run_by` column distinguishes checker-authoritative runs from
agent-local exploration.

Metrics (`duration_ms`, `memory_rss`) enable performance tracking and flakiness
detection but do not affect pass/fail.

---

## Checker authority

**Checker runs are authoritative.** Only checker results affect corpus state:
relationship registration, evaluation metadata, `zts exec` warnings.

**Agent-local runs are exploratory.** Stored with `run_by='agent'`. Useful for
rapid iteration. Do not change corpus state.

**Divergence is a signal.** If agent and checker disagree on the same (test,
target) pair, investigate — it means environment difference, nondeterminism, or
resource limit effects.

The checker is a minimal Deno container with no internet access, no corpus
volume, and hard resource limits (30s wall-clock, 256MB memory per subprocess).
It fetches atoms via HTTP from the server. Every execution is treated as
potentially adversarial.

**Pre-Docker (local mode):** before the checker container exists, the server
runs test subprocesses locally. These results are authoritative in single-player
mode — there is no separate agent to diverge from. The checker container adds
multi-tenant hardening and resource isolation, not a new capability.

---

## Effect on zts exec

`zts exec` checks `test_evaluation` for the atom and all transitive dependencies
before running.

**`violates_intent`** — warning, names the test and suggests alternatives:

```
warning: 3ax9b has known correctness defects:
  test a1b2c (contract): violates intent — multi-message TLS record assumption
  Run `zts tops 3ax9b` to find corrected alternatives.
```

**`falls_short`** — softer notice:

```
note: 3ax9b may have better alternatives (run `zts tops 3ax9b`).
```

Override with `--allow-failures` to suppress all warnings.

---

## Default test execution

`zts test <hash>` runs only tests where `expected_outcome=pass` (or no metadata
row — pass is assumed). To inspect other outcomes:

```sh
zts test <hash> --expected violates_intent   # see correctness evidence
zts test <hash> --expected falls_short       # see improvement opportunities
```

---

## Test atom format

A test atom exports a class named `Test` with a `static name` string and a
`run(target)` method:

```typescript
export class Test {
  static name = "gcd: coprime inputs return 1";
  run(target: (a: number, b: number) => number): void {
    if (target(7, 13) !== 1) throw new Error("expected gcd(7,13) = 1");
  }
}
```

Rules:

- Value export must be named exactly `Test`
- No constructor arguments — tests create their own mocks internally
- No real I/O — the test subprocess runs with `--allow-import` only
