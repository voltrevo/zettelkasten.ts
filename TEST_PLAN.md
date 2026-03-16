# Manual Test Plan

These tests cover the critical invariants of the system. They are not exhaustive — the goal is to verify the properties that matter most: content-addressing correctness, idempotency, and round-trip fidelity. Edge cases and error handling are secondary.

---

## 1. Content addressing is deterministic and collision-free

Post the same content twice. Expect the same hash both times.
Post different content. Expect a different hash.

## 2. Round-trip fidelity

Post an atom via HTTP and retrieve it by the returned path. Expect byte-for-byte identical content.

Repeat using the CLI (`zk post` → `zk get`), including both path and bare-hash forms.

## 3. Hash encodes correctly into path

The returned path should be `/a/<c1c2>/<c3c4>/<c5…c25>.ts` — exactly 25 lowercase base36 characters split 2/2/21 across the three segments.

## 4. Git history reflects submissions

After posting two distinct atoms, the git log should show `init` plus one commit per unique atom, each prefixed with the first 8 hash chars: `xxyyzz00: <message>`.

Posting duplicate content should not produce a new commit.

## 5. CLI mirrors HTTP behaviour

`zk post -m <message> [file|stdin]` and `zk get <path|hash>` should produce the same results as the equivalent `curl` calls. Verify both file and stdin input modes for `post`.