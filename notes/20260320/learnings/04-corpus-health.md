# Corpus health

## What was observed

Broken atoms accumulate. Atoms with bugs cannot always be deleted (deletion
returns 409 if the atom has any relationships), so they remain in the corpus
and in search results, competing with correct atoms.

### The `BROKEN:` description prefix

The current convention is to prepend `BROKEN: <explanation>` to an atom's
description. This is useful — it surfaces in search results and makes the
problem visible. It was used consistently across both channels and works as
intended.

What it doesn't do:

- **Machine enforcement.** Nothing stops an agent from running a BROKEN atom.
  `zts exec` has no concept of broken status.
- **Causal link.** The description explains what's wrong in prose but doesn't
  link to the test that proves it or the atom that fixes it.
- **Propagation.** When a leaf atom is marked BROKEN, its dependents may
  inherit the breakage. Finding all dependents requires a raw curl query that
  is not in the primary CLI. Marking all of them is manual and error-prone.

### Observed patterns of breakage

- **Superseded-but-not-deletable atoms.** When V2 of an atom fixes V1, V1
  can't be deleted if it has `tests` relationships. Both V1 and V2 appear in
  search. An agent querying for the capability may find V1, import it, and get
  the buggy behavior.

- **Test atoms that mask bugs.** One case (c32ParseV2, starling channel) had a
  test that used `"punct"` token type for `"="` when the lexer actually emits
  `"op"`. The test passed and the relationship was stored, but the test was
  wrong. The implementation bug went undetected for multiple iterations because
  the test validated the wrong thing.

- **Broken dependents not marked.** When `tls13HandshakeAlpn` was identified
  as broken (multi-message TLS record bug), `tls13ConnectH2`, `https2Get`, and
  `https2GetMain` all inherited the breakage but were not automatically flagged.
  Finding them required knowing the dependency graph and inspecting each one.

### The missing layer: objective negative evidence

The `tests` relationship says "this test passes against this atom." There is no
equivalent for "this test fails against this atom" — which is the objective
evidence that an atom is broken.

Today's negative evidence is:
1. A human or agent running the atom and observing wrong output
2. Updating the description with `BROKEN:` prose

This is subjective and informal. A test atom that reproducibly demonstrates
the bug is objective evidence. The system has all the infrastructure to support
this — test execution, relationships — but doesn't use it for the negative case.

See `proposals/failing-tests.md` for a detailed design.

### Version lineage sprawl

When atoms are updated via new versions (V1 → V2 → V3...), the lineage
accumulates in the corpus. By the time the starling channel reached iteration
N+40, the wasm function runner family had 18 versions. Each version was
correct at the time it was posted. Most are now obsolete.

There is no way to say "V17 supersedes V16 which supersedes V15." The handover
documents carried this information in prose, but an agent that doesn't read the
handover has no way to know which version is canonical.

Agents expressed this as a wish: a way to mark the canonical current version
of a lineage, surfaced in search results and `zts get` output.
