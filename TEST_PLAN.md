# Manual Test Plan

These tests cover the critical invariants of the system. They are not exhaustive
— edge cases are out of scope.

---

## 1. Content addressing is deterministic and collision-free

Post the same content twice. Expect the same hash both times. Post different
content. Expect a different hash.

## 2. Round-trip fidelity

Post an atom via HTTP and retrieve it by the returned path. Expect byte-for-byte
identical content.

Repeat using the CLI (`zts post` → `zts get`), including both path and bare-hash
forms.

## 3. Hash encodes correctly into path

The returned path should be `/a/<c1c2>/<c3c4>/<c5…c25>.ts` — exactly 25
lowercase base36 characters split 2/2/21 across the three segments.

## 4. Git history reflects submissions

After posting two distinct atoms, the git log should show `init` plus one commit
per unique atom, each prefixed with the first 8 hash chars:
`xxyyzz00: <message>`.

Posting duplicate content should not produce a new commit.

## 5. CLI mirrors HTTP behaviour

`zts post -m <message> [file|stdin]` and `zts get <path|hash>` should produce
the same results as the equivalent `curl` calls. Verify both file and stdin
input modes for `post`.

## 6. Validation rejects invalid atoms

The server should return 422 for each of the following, with a descriptive error
message:

- No exports
- More than one export
- An exported `let` (mutable)
- An import that is not a relative atom path (`../../xx/yy/<21chars>.ts`)
- Content that exceeds 768 bytes gzipped after minification

Valid atoms must be accepted: a single `export const`, a single
`export function`, a single `export class`, and an atom with a valid relative
atom import.

Validation must run before hashing and storage — a rejected atom should not
appear in the git log.

## 7. Daemon lifecycle

`zts start` should write a systemd user unit, enable it, and start it. Verify
with `systemctl --user status zettelkasten` — expect `active (running)`.

`zts stop` should stop the process and disable it. Verify with
`systemctl
--user status zettelkasten` — expect `inactive (dead)` and
`disabled`.

`zts run` should run the server in the foreground; Ctrl-C should exit cleanly.

After `zts start`, a reboot (or `systemctl --user daemon-reload` + manual enable
cycle) should restart the service automatically.
