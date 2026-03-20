# CLI gaps

Operations that agents needed but had to do via raw curl. Each required agents
to remember endpoint paths and JSON shapes, and to include these as boilerplate
in handover docs.

---

## Relationship management

The most frequently needed missing commands. Used in almost every iteration.

**Query relationships:**

```sh
# Needed: zts rels [--from <hash>] [--to <hash>] [--kind <kind>]
# Actual:
curl -s "http://localhost:8000/relationships?to=<hash>&kind=imports"
```

**Find dependents of an atom (before marking it broken):**

```sh
# Needed: zts dependents <hash>
# Actual:
curl -s "http://localhost:8000/relationships?to=<hash>&kind=imports" | jq '.[].from'
```

**Register a test relationship manually (after post-without-t):**

```sh
# Needed: zts relate <test-hash> <target-hash> tests
# Actual:
curl -s -X POST http://localhost:8000/relationships \
  -H "content-type: application/json" \
  -d '{"kind":"tests","from":"<test>","to":"<target>"}'
```

---

## Atom inspection

**Get an atom's description, registered tests, and size in one call:**

```sh
# Needed: zts info <hash>
# Actual: separate calls to zts get (source), zts describe (no read command),
#         and manual curl for relationships
```

No CLI command exists to read back an atom's description or check what tests are
registered for it without raw curl. This caused agents to describe atoms and
then have no way to verify the description was stored.

**Check gzip size before posting:**

```sh
# Needed: zts size /tmp/atom.ts  (client-side minify + gzip estimate)
# Actual: post and receive 413, then iterate
```

Agents went through multiple post-reject-edit cycles to hit the size limit. A
client-side estimate (even an approximation) would short-circuit this.

---

## Corpus browsing

**List recent atoms:**

```sh
# Needed: zts list [--recent N] [--kind tests]
# Actual: zts search with approximate query (unreliable)
```

**List all atoms matching a description prefix:**

```sh
# Needed: zts list --prefix "BROKEN:"
# Actual: impossible without scanning all atoms
```

---

## Other

**`zts post` output on 200 (already exists):**

Currently a 200 response is silent or unclear. Agents were uncertain whether
their post was accepted (already existed) or failed. A clear message like
`already exists: /a/xx/yy/<rest>.ts` with no error exit would remove ambiguity.

**`zts describe` read-back:**

`zts describe <hash> -m "..."` writes a description. There is no corresponding
`zts describe <hash>` (no `-m`) to read it back. Agents had to use raw curl or
trust that the previous write succeeded.

---

## Note on `zts-plus`

A `zts-plus` wrapper at `~/.local/bin/zts-plus` was built in this container to
fill some of these gaps:

```sh
zts-plus relate <from> <to> [kind]
zts-plus unrelate <from> <to> [kind]
zts-plus rels [--from=h] [--to=h] [--kind=k]
zts-plus recent N
zts-plus get <prefix>   # resolves hash by prefix
```

These should be candidates for promotion into the main `zts` CLI.
