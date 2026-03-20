# Proposal: CLI additions

These address the gaps documented in `../07-cli-gaps.md`. Ordered by impact.

---

## High priority

### `zts describe <hash>` (read-back)

Currently `zts describe <hash> -m "text"` writes a description. With no `-m`
flag it should print the current description. This closes the write-only gap
and lets agents verify that a description was stored.

### `zts rels` — relationship queries

```sh
zts rels --to <hash> [--kind <kind>]     # what imports/tests this atom?
zts rels --from <hash> [--kind <kind>]   # what does this atom import/test?
```

Used in almost every session. Currently requires raw curl with a non-obvious
query string.

### `zts dependents <hash>`

Shorthand for `zts rels --to <hash> --kind imports`. Essential when marking an
atom BROKEN — you need to find what to check and potentially also mark.

### `zts relate <from> <to> [kind]`

Registers a relationship. For `kind=tests`, runs the test first (as the
`POST /relationships` endpoint does). Default kind: `imports`.

### Fold description into `zts post`

Add an `X-Description` header (or `-d "text"` flag) to `zts post`. This makes
description part of the atomic post rather than a separate step. A separate
`zts describe` call remains available for after-the-fact updates.

The immediate benefit: `zts post -m "commit msg" -d "description" -t <test> atom.ts`
is one command that covers the full workflow. Forgetting the description step
becomes impossible.

---

## Medium priority

### `zts list [--recent N]`

Lists atoms, most recent first. Even without filtering, being able to see "what
was posted in the last 20 operations" would significantly reduce the context
agents burn on maintaining manual inventory tables.

Optional flags:
- `--recent N` — last N atoms by post time
- `--kind tests` — only test atoms
- `--broken` — only atoms whose description starts with `BROKEN:`

### `zts info <hash>`

Single command showing everything about an atom: source (from `zts get`),
description, registered tests, atoms that test it, atoms it imports, and
gzip size. Currently requires 3+ separate calls to assemble this picture.

### `zts size <file>`

Client-side minify + gzip estimate before posting. Agents went through
multiple post-reject-edit cycles to hit the 768B limit. A pre-submission
estimate would short-circuit this — even an approximate one.

### `zts fail <test-hash> <target-hash>`

Registers a `kind=fails` relationship (see `failing-tests.md`). Verifies
the test actually fails against the target before storing.

---

## Low priority

### `zts graph <hash> [--depth N]`

Show the transitive dependency tree. Currently requires chaining relationship
queries manually. Useful when deciding whether to reuse an existing subtree.

### Friendlier 200 response from `zts post`

When a post returns 200 (already exists), the CLI should print:
```
already exists: /a/xx/yy/<rest>.ts
```
Not an error, but unambiguous. Currently this is confusing during iterative
development.

### Reject non-ASCII in commit messages client-side

`-m` arguments with Unicode characters (arrows, Greek letters, emoji) cause
ByteString errors in HTTP headers. This was rediscovered multiple times. A
client-side check with a clear error message would eliminate the confusion.
