# Test workflow

## What was observed

The test gate on POST (`-t <test-hash>`) is conceptually elegant. In practice,
agents abandoned it as the primary workflow and fell back to a manual curl
workaround. This was not occasional — it was the dominant pattern for any atom
with a non-trivial dependency tree.

### The "post without -t, then curl" anti-pattern

The workaround, which appeared in at least 15 handover docs across both channels
and was passed forward as standard operating procedure:

```sh
# Intended workflow (often fails):
zts post -m "desc" -t "<test-hash>" /tmp/atom.ts
# → 422 Untested deps: [hash1, hash2, ...]

# Actual workflow agents used:
zts post -m "desc" /tmp/atom.ts
# → 201 <hash>
curl -s -X POST http://localhost:8000/relationships \
  -H "content-type: application/json" \
  -d '{"kind":"tests","from":"<test-hash>","to":"<new-hash>"}'
# → 201
```

This was necessary because `-t` checks the entire transitive dependency tree. If
any ancestor atom lacks a registered test relationship — even if it is correct
and working — the POST is rejected with a list of offending hashes.

The effect: agents stopped using the test gate for any atom higher than a leaf.
The quality guarantee the system was designed to provide was regularly bypassed.

### Why the transitive check fires

The rule is: every atom in the transitive closure of the new atom's imports must
have at least one `tests` relationship registered. This is a strong guarantee —
if every atom in the tree has passed its own tests, the whole tree is validated
— but it requires that test relationships be registered for every atom in the
corpus, which in practice is not true for atoms built before the rule was in
effect, or for atoms posted without `-t`.

The result: any atom that imports a common utility (e.g., a string encoder) that
was posted without `-t` is permanently blocked from using the gate.

### The "describe before use" friction

A related but separate friction: atoms must have a description before they can
be used as dependencies in a `-t` post (422 "Undescribed deps"). Describing is a
separate CLI call made after posting. It is easy to post an atom, not describe
it, and then discover the problem only when a subsequent post fails.

From the bricklane learnings file: "Describe atoms immediately after posting. If
you build on the atom later, it will block `-t` posts unless it's described.
Easier to do it at creation time than hunt it down later."

This note was included in multiple handover docs as a reminder — a sign that it
was repeatedly forgotten.

### The TDD discipline itself works well

Despite the tooling friction, the core practice — write test atom first, post
it, write implementation, post with gate — was consistently followed and
consistently caught bugs. Tests caught: wrong Markov expected values, wrong Rule
90 assertion, a c32 parse bug that existed for multiple iterations, a Huffman
length-limiting bug, multiple wasm binary encoding errors.

The process works. The friction is in the tooling around it, not the concept.

### Tests cannot exercise real I/O

The test subprocess runs with `--allow-import=<server>` only. This means atoms
that perform network I/O (SSH client, TLS handshake, HTTP/2 client, DNS) cannot
be integration-tested against real servers through the test gate. The entire
TLS + HTTP/2 stack was built and "tested" with mocks but never verified against
a live connection — and the bug (single-message-per-record assumption in
`tls13HandshakeAlpn`) was only discovered when running against Deno's own TLS
server externally.

This is a structural gap: the test infrastructure validates correctness against
specs and mocks, but not against real protocol implementations.

### Published crypto test vectors can diverge from runtime output

From LEARNINGS.md, confirmed against Deno 2.7.5 / aarch64:

> Some published crypto test vectors do not match this runtime. SHA-256("abc"),
> AES-128 FIPS 197 Appendix A.1, and others differ from both WebCrypto output
> AND pure-JS implementations — yet WebCrypto and pure-JS agree with each other.

The implication: use the runtime's WebCrypto output as the ground truth for
expected values in test atoms, not values copied from RFCs or test suites. Run
the correct implementation against the runtime, record its output, use that as
the expected value. Structural and round-trip tests are more portable than
platform-specific known-answer tests.

This was noted once in LEARNINGS.md but not propagated to agent guides, and
agents continued using RFC-sourced test vectors. It should be in the primary
documentation.

## What good looks like

The ideal is that the conceptually correct workflow — write test, post test,
post implementation with `-t` — just works without requiring curl workarounds.
The transitive check is a quality guarantee worth preserving, but it needs to be
possible to build toward it incrementally.

See `proposals/cli-additions.md` for specific ideas.
