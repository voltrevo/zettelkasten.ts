# Proposal: failing tests (`kind=fails`) — SUPERSEDED

> **This proposal has been superseded by `proposals/testing-model.md`.**
> `kind=fails` as a relationship type does not exist in the new model.
> Outcome and meaning are encoded in the `test_evaluation` metadata table.
> The `zts fail` CLI command is preserved but sets metadata, not a
> relationship kind. Read `testing-model.md` instead of this document.

---

## The problem

Today's way to mark a broken atom is to prefix its description with `BROKEN:`.
This is informal, passive, and not machine-enforceable. `zts exec` will run a
BROKEN atom without any warning. There is no objective link between the evidence
(a test that reproduces the bug) and the broken atom.

## Proposed design

Add a `fails` relationship kind, alongside the existing `tests`:

```
kind=tests  from=<test>  to=<target>   # T passes when run against target
kind=fails  from=<test>  to=<target>   # T fails when run against target
```

Both link a test atom to a target. The distinction is the outcome.

### Precondition: the test must already pass against a fix

Before the server accepts `kind=fails from=T to=A`, it requires that T already
has at least one `kind=tests` relationship to another atom. This means: you
cannot use a test as negative evidence unless it is already proven correct by
passing against a fixed version of the atom.

This prevents a buggy test from incorrectly marking a good atom as broken.
It also enforces a workflow discipline: fix first, then mark broken.

**Workflow:**

1. Write a test that reproduces the bug. Post it normally (no `-t`).
2. Write the corrected atom. Post it with the test gate:
   `zts post -m "fix: ..." -t <test-hash> /tmp/fix.ts`
   This registers `kind=tests from=<test> to=<fix>`.
3. Now register the failure against the old atom:
   `zts fail <test-hash> <broken-atom-hash>`
   The server verifies step 2 was done, then accepts.

Step 3 before step 2 is rejected with 422.

### `zts exec` rejects broken atoms by default

If the atom being exec'd (or any transitive dependency) has one or more `fails`
relationships, `zts exec` refuses:

```
error: atom 3ax9... has failing tests:
  test b7f2... fails it  (fix: use 9c1d... instead)
```

The error names the failing test and, where available, suggests the atom that
passes. Override with `--allow-failures` for debugging.

### What this replaces

The `BROKEN:` description prefix should still be used for human-readable context
and search discoverability. The `fails` relationship is the machine-enforceable
complement. Both should be present when objective test evidence is available.

### Summary of server changes

| Endpoint | Change |
|---|---|
| `POST /relationships` with `kind=fails` | Runs test against target (verifies failure); requires test to have ≥1 `kind=tests` rel; stores on 201 |
| `GET /relationships?to=X&kind=fails` | Returns all tests that fail X |
| `zts exec <hash>` | Rejects by default if hash or any dep has `kind=fails` rels |
| `zts exec --allow-failures <hash>` | Override for debugging |
| `zts fail <test> <target>` | CLI shorthand for registering `kind=fails` |
