# next-gen zts — plans

The next generation of zettelkasten.ts moves from a git-backed flat filesystem
to SQLite-only storage, adds structured corpus health tools, and packages the
agent loop as a first-class feature of the tool.

---

## Files

| File | Contents |
|---|---|
| [ASPIRATIONAL_README.md](ASPIRATIONAL_README.md) | Full target-state CLI + API reference |
| [schema.md](schema.md) | Complete SQLite schema (all tables) |
| [testing.md](testing.md) | Three-layer testing model, checker authority |
| [deployment.md](deployment.md) | Auth, Docker, agent loop, workspace |
| [web-ui.md](web-ui.md) | Admin web UI: dashboard, corpus browser, graph, goals, agent monitor |
| [../learnings/reference/claude-sandbox/](../learnings/reference/claude-sandbox/) | Working two-container Claude Code sandbox (Squid gateway + Ubuntu). Basis for the agent/gateway container design. See its ISSUES.md for pitfalls to avoid. |

---

## Implementation order

Strict sequence. Each step builds on the previous. The conceptual example
after each step shows what should work when that step is done.

**Pre-implementation notes:**

- **Migration** of the existing git-backed corpus into SQLite is deferred.
  Not automated — done interactively when the new schema is ready.
  The existing corpus is small enough for manual/scripted migration.
  This is not yet a public-facing product.
- **Schema versioning**: include a `schema_version` table from day one.
  Check on startup, fail clearly if the DB is ahead of the server.
- **`-t` is strict by default.** The transitive "all deps must have tests"
  check remains and is now the default. Override with `--allow-untested-deps`
  when necessary. Agents should prefer fixing (adding missing test
  relationships) over overriding.
- **Pre-Docker testing**: before the checker container exists, the server
  runs test subprocesses locally. Results are still authoritative in
  single-player mode. The checker container adds multi-tenant hardening,
  not a new capability.

---

### 1. SQLite atom storage + log table

Create `atoms` and `log` tables. `POST /a` inserts a row; `GET /a/...`
selects by hash. All write endpoints insert a log row in the same
transaction. Remove the git repo as corpus backing store.

```
$ zts post -d "computes GCD of two integers using Euclidean algorithm" /tmp/gcd.ts
201 /a/3a/x9/b7f2de1k4m8np3qrs.ts
```

One transaction: atom stored, description recorded, log entry written.

---

### 2. Size limit 1024B + clear rejection

Bump gzip-after-minification limit from 768B to 1024B. When an atom
exceeds the limit, the rejection message must explain:

- Size is measured after minification + gzip
- Removing comments or whitespace will not help — the minifier already does this
- Do not drop features or sacrifice readability
- Split the design into multiple atoms at natural boundaries

```
$ zts post -d "..." /tmp/big-atom.ts
413 atom is 1183 bytes (min+gz); limit is 1024.
    The server minifies before measuring — removing comments or whitespace
    will not reduce this number. Split into smaller atoms instead.
```

---

### 3. Core CLI: list, info, size, describe

- `zts list [--recent N] [--goal G] [--broken]` — enumerate atoms
- `zts info <hash>` — source + description + gzip size + tests + dependents
- `zts size /tmp/atom.ts` — client-side minify + gzip estimate
- `zts describe <hash>` — read back description
- `zts describe <hash> -d "text"` — update description

```
$ zts list --recent 3
3ax9b...  computes GCD of two integers using Euclidean algorithm
f7c2d...  returns true if a positive integer is prime (trial division)
91be4...  returns distinct prime factors in ascending order

$ zts size /tmp/draft.ts
estimate: 847 bytes (min+gz) — within 1024B limit
```

---

### 4. Relationship CLI: rels, dependents, relate

- `zts rels --from <hash> [--kind K]` — outgoing relationships
- `zts rels --to <hash> [--kind K]` — incoming relationships
- `zts dependents <hash>` — shorthand for `--to <hash> --kind imports`
- `zts relate <from> <to> [kind]` — register relationship
- `zts unrelate <from> <to> [kind]` — remove relationship

```
$ zts dependents 3ax9b
91be4...  primeFactors (imports gcd)
c7d3f...  simplifyFraction (imports gcd)
```

---

### 5. Properties

Create `properties` table. Key-value metadata on individual atoms —
the single-atom counterpart to relationships. `starred` is the first
key, admin-only. General-purpose: future keys added without schema changes.

```
$ zts prop set 3ax9b starred

$ zts list --prop starred
3ax9b...  computes GCD of two integers using Euclidean algorithm
f7c2d...  returns true if a positive integer is prime (trial division)

$ zts prop list 3ax9b
starred
```

---

### 6. Three-layer testing model

Create `test_evaluation` and `test_runs` tables. Implement:

- `zts fail <test> <broken>` — mark correctness defect (checker verifies
  the test fails against the target; requires test passes against a fix)
- `zts benchmark <test> <target>` — mark improvement opportunity
- `zts eval show <test> <target>` — read evaluation metadata
- `zts eval set <test> <target> --commentary "why"` — annotate
- `zts test <hash>` — run applicable tests via checker
- `zts exec` warns on `violates_intent`, notes on `falls_short`

```
$ zts fail a1b2c d3e4f
checker: test a1b2c fails against d3e4f (as expected)
registered: violates_intent (contract)
auto-registered: kind=supersedes from=<fix> to=d3e4f

$ zts exec d3e4f
warning: d3e4f has known correctness defects:
  test a1b2c (contract): violates intent
  Run `zts tops d3e4f` to find corrected alternatives.
```

---

### 7. Supersedes + tops

Add `kind=supersedes` relationship. Implement `zts tops` for BFS navigation
to current best alternatives. Auto-register supersedes from `zts fail`
evidence. Annotate superseded atoms in search results and `zts exec` output.

```
$ zts relate <v2-hash> <v1-hash> supersedes

$ zts tops <v1-hash>
2 of 2 tops found.

Depth 1:
  f7c2d...  wasmFuncRunnerFast — handles common opcodes, minimal footprint
  4bd9e...  wasmFuncRunnerAsync — async-first interface for event loops
```

---

### 8. FTS5 source code search

Create `atoms_fts` virtual table on atom source. Complement existing
embedding search on descriptions with full-text search on code.

```
$ zts search "GCD"
(embedding search on descriptions)
3ax9b...  computes GCD of two integers using Euclidean algorithm

$ zts search --code "subtle.digest"
(FTS5 search on source)
b8e1a...  computes SHA-256 using WebCrypto
d4f7c...  HMAC-SHA256 per RFC 2104
```

---

### 9. Goals system

Create `goals` and `goal_comments` tables. Add `goal` column to `atoms`.
Implement agent commands (`zts goal pick/show/list/done/undone/comment/comments`)
and admin commands (`zts admin goal add/set/list/delete`). Add `-g` flag
to `zts post`.

```
$ zts admin goal add websocket-framing --weight 0.8 --body "RFC 6455..."
created: websocket-framing (weight 0.8)

$ zts goal pick
websocket-framing (weight 0.8)
  RFC 6455 WebSocket framing: mask, unmask, fragment, reassemble...

$ zts post -d "WebSocket frame parser" -g websocket-framing -t <test> /tmp/ws.ts
201 /a/c3/d4/...
```

---

### 10. zts status

Corpus orientation in one command. Total atoms, recent activity, defects,
per-goal contribution stats.

```
$ zts status
Corpus: 847 atoms (12 defects, 34 superseded)

Recent (7d):  +23 atoms  +8 relationships  +4 goals completed

Goals (active):
  websocket-framing    14 atoms (6 new this week)
  number-theory        22 atoms (1 new this week)
  wasm-executor        18 atoms (3 superseded, 1 defect)

Defects (violates_intent):
  3ax9b...  tls13HandshakeAlpn — multi-message TLS record assumption
  f91c2...  c32ParseV2 — wrong token type for "="
```

---

### 11. Auth

Bearer tokens, three tiers: unauthed (reads), dev (writes), admin (goal
management). Server enforces. CLI reads tokens from env and includes
automatically. See [deployment.md](deployment.md) for details.

```
$ ZTS_DEV_TOKEN="" zts post -d "..." /tmp/atom.ts
error: ZTS_DEV_TOKEN is not set. Export it to use write commands.

$ curl http://localhost:8000/a/3a/x9/b7f2de1k4m8np3qrs.ts
(works — reads are unauthenticated)
```

---

### 12. Agent loop runner + workspace

`zts script worker` emits a shell script that runs the autonomous agent
loop. `zts script context` and `zts script iteration` emit the prompt
fragments. `zts script setup` initializes a workspace. The prompts and
loop runner ship with the tool — no loose orchestration files.

```
$ zts script setup --channel bricklane
created: workspace/
  notes/current.md
  handovers/current.md
  logs/
  tmp/

$ zts script worker --channel bricklane | bash
[iteration 1] reading handover... picking goal... building atoms...
```

---

### 13. Docker deployment

Four containers: gateway (Squid proxy), zts-server (corpus + API +
Ollama), checker (test execution), agent (Claude Code + zts CLI). One
compose file. Ollama runs inside the zts-server container for embedding
generation. See [deployment.md](deployment.md) for architecture.

```
$ cp .env.example .env && $EDITOR .env
$ docker compose up -d --build
$ docker compose logs -f agent
```

---

### 14. Web UI

Admin web interface served by zts-server at `/ui/`. Dashboard (live
`zts status`), corpus browser with search and filters, atom detail with
syntax-highlighted source, interactive dependency graph, lineage
visualization, goal management, agent channel monitor, audit log.
See [web-ui.md](web-ui.md) for full design.

```
$ open http://localhost:8000/ui/
# → dashboard: 847 atoms, 12 defects, goal activity chart
# → click an atom → source, relationships, test history, graph link
# → /ui/graph/3ax9b → interactive dependency tree, color-coded health
# → /ui/goals → manage goals, view comment threads, edit weights
# → /ui/agents → per-channel iteration status, handover preview
```
