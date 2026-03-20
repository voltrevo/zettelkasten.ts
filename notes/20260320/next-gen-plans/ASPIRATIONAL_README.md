# zettelkasten.ts

A persistent, content-addressed code knowledge base for AI agents. Atoms —
immutable TypeScript modules, each with exactly one export — accumulate in
a SQLite-backed corpus. Agents build on what exists rather than rebuilding
from scratch. The corpus compounds.

---

## Architecture

```
Internet
  |
  v
[gateway]       Squid proxy — allowlist: api.anthropic.com only
  |
  |  (zts-net: internal Docker network — no direct internet access)
  |
  +-- [zts-server]   Authoritative archive. HTTP API, SQLite.
  |       |          Never executes atom code.
  |   [checker]      Evaluation chamber. Runs tests only. No internet.
  |                  Strong resource limits. Results are authoritative.
  |
  +-- [agent]        Research lab. Claude Code + zts CLI, N channels.
                     Unsafe locally, safe externally.
```

Four containers, one compose file. The corpus is the server's private
SQLite database — agents interact exclusively through the HTTP API and CLI.
Ollama runs inside the zts-server container for embedding generation.
The server also hosts a web UI at `/ui/` for operators.

---

## Quick start

```sh
# 1. Configure
cp .env.example .env
$EDITOR .env   # set tokens, API key, channel names

# 2. Start
docker compose up -d --build

# 3. Watch agent activity
docker compose logs -f agent

# 4. Manage goals (operator)
zts admin goal add websocket-framing --weight 0.8 --body "..."
zts admin goal list
```

### .env

```sh
# Required
ZTS_DEV_TOKEN=<random 32+ bytes, hex or base64>
ZTS_ADMIN_TOKEN=<random 32+ bytes, hex or base64>
ANTHROPIC_API_KEY=<your key>

# Agent channels (comma-separated; one loop per channel)
ZTS_CHANNELS=bricklane,starling

# Optional
ZTS_SERVER_URL=http://zts-server:8000
ZTS_TEST_TIMEOUT=30   # checker per-test wall-clock limit, seconds
```

---

## Atom model

An atom is a single TypeScript module with exactly one value export. Atoms
are identified by a 25-character base36 keccak-256 hash and stored in SQLite.
The URL path `a/xx/yy/<21chars>.ts` is a display convention, not a filesystem
location.

**Rules (enforced at submission):**

1. Exactly one value export — function, class, const, or enum. Named only;
   `export default` is forbidden. Type-only exports (`export type`,
   `export interface`) do not count.
2. Only relative atom imports — `../../xx/yy/<21chars>.ts`. No npm, no JSR,
   no URLs, no bare specifiers.
3. No exported `let` — exports must be `const`, function, class, or enum.
4. Size limit — 1024 bytes gzipped after minification. Write clean,
   readable code; the server minifies before checking. If the atom exceeds
   the limit, the server will tell you the measured size and remind you to
   split at natural boundaries — not to sacrifice readability.
5. Description required — every atom must be described at submission time.
   Use `--no-description` to opt out explicitly.

**Description comment convention:** the first line(s) of every atom must be
a comment containing the description, identical to what is passed via `-d`.
Comments are stripped by the minifier and do not count toward the size limit.
This makes the source self-documenting when viewed outside of search context.

```typescript
// Computes the greatest common divisor of two integers using the
// Euclidean algorithm. Always returns a non-negative value.
export function gcd(a: number, b: number): number { ... }
```

**Cap convention:** atoms that need external capabilities (I/O, time,
randomness, fetch) accept them as an explicit `cap` first argument and
export a `Cap` type. Tests substitute only what they need.

```typescript
export type Cap = {
  console: Pick<Console, "log" | "error">;
  Deno: { args: readonly string[] };
};
export function main(cap: Cap): void { ... }
```

---

## CLI reference

The `zts` CLI requires `ZTS_SERVER_URL` (default: `http://localhost:8000`)
and, for write operations, `ZTS_DEV_TOKEN`. Admin operations require
`ZTS_ADMIN_TOKEN`.

### Corpus

```sh
# Store an atom (201 = new, 200 = already exists, 400 = invalid, 413 = too large)
zts post -d "computes GCD of two integers using Euclidean algorithm" /tmp/gcd.ts

# Store with test gate — tests run in checker before commit
# -t is strict: all transitive deps must also have test relationships
zts post -d "HMAC-SHA256 per RFC 2104" -t "<test-hash>" /tmp/hmac.ts

# Override transitive test check when fixing incrementally
# Prefer adding missing test relationships to using this flag
zts post -d "description" -t "<test>" --allow-untested-deps /tmp/atom.ts

# Store with goal tag
zts post -d "WebSocket frame parser" -g websocket-framing /tmp/ws.ts

# All flags combined
zts post -d "description" -t "<test>" -g <goal> /tmp/atom.ts

# Opt out of required description (exceptional)
zts post --no-description /tmp/atom.ts

# Retrieve atom source
zts get <hash>

# Update description
zts describe <hash> -d "updated description"

# Read back description
zts describe <hash>

# Estimate gzip size before posting (client-side minify + compress)
zts size /tmp/atom.ts

# Semantic search (embedding on descriptions)
zts search "HKDF key derivation SHA-256" [--k 10]

# Source code search (FTS5 on source)
zts search --code "subtle.digest"

# List atoms
zts list [--recent N] [--goal G] [--broken]

# Full atom info: source, description, size, tests, dependents
zts info <hash>

# Corpus health and orientation
zts status [--since 2026-03-01]

# Delete orphan (409 if has relationships)
zts delete <hash>
```

### Properties

```sh
# Set a property (flag)
zts prop set <hash> starred

# Set a property (key + value)
zts prop set <hash> somekey "value"

# Remove a property
zts prop unset <hash> starred

# List all properties on an atom
zts prop list <hash>

# Filter atoms by property
zts list --prop starred
```

### Relationships

```sh
# Query
zts rels --from <hash> [--kind K]   # what does this atom import/test/supersede?
zts rels --to <hash> [--kind K]     # what imports/tests/supersedes this atom?
zts dependents <hash>               # shorthand: --to <hash> --kind imports

# Register (kind=tests runs test via checker before storing)
zts relate <from> <to> [kind]

# Remove
zts unrelate <from> <to> [kind]
```

### Testing

```sh
# Run all applicable tests (expected_outcome=pass) via checker
zts test <hash>

# Run tests with non-default expected outcomes
zts test <hash> --expected violates_intent
zts test <hash> --expected falls_short

# Mark correctness defect — checker verifies test fails against target
# Requires: test already passes against some other atom
zts fail <test-hash> <broken-hash>

# Mark improvement opportunity — checker verifies atom fails the benchmark
zts benchmark <test-hash> <target-hash>

# Read or annotate evaluation metadata
zts eval show <test-hash> <target-hash>
zts eval set <test-hash> <target-hash> --commentary "why this is expected"
```

### Execution

```sh
# Execute an atom's main(cap) in isolated Deno subprocess
zts exec <hash> [args...]
zts exec --allow-net <hash> [args...]
zts exec --allow-read=/tmp <hash> [args...]
zts exec --allow-failures <hash>     # suppress violates_intent / falls_short warnings
zts exec --allow-superseded <hash>   # suppress superseded warning

# Bundle atom + all transitive deps to a directory
zts bundle <hash> -o <parent-dir>
```

### Lineage

```sh
# Navigate supersedes graph to current best (BFS, closest first)
zts tops <hash> [--limit N] [--all]
```

### Goals (agent)

```sh
zts goal pick [--n N]                      # weighted random sample of non-done goals
zts goal show <name>                       # full body + all comments
zts goal list                              # non-done goals
zts goal done <name>                       # mark complete
zts goal undone <name>                     # revert (critic agents)
zts goal comment <name> "observation"      # append timestamped note
zts goal comments <name> [--recent N]      # read accumulated observations
```

### Goals (admin)

```sh
zts admin goal add <name> [--weight 0.8] [--body "markdown"]
zts admin goal set <name> --weight 0.9
zts admin goal set <name> --body "updated description"
zts admin goal list [--done] [--all]
zts admin goal delete <name>
```

### Agent loop

```sh
# Run the autonomous loop
zts script worker | bash
zts script worker --channel bricklane | bash
zts script worker --once | bash

# Initialize a workspace
zts script setup [--channel <name>] [--workspace <dir>]

# Inspect shipped prompts
zts script context
zts script iteration
```

---

## TDD workflow

Work bottom-up. Build the deepest unbuilt dependency first.

```sh
NEEDS="/tmp/$(date +%s)-needs.txt"
echo "top-level goal" > "$NEEDS"

# For each item (deepest first via tail -1 "$NEEDS"):

# 1. Write the test atom
cat > /tmp/test.ts << 'EOF'
export class Test {
  static name = "hmac: RFC 2202 test vector 1";
  run(target: (key: Uint8Array, msg: Uint8Array) => Uint8Array): void {
    const key = new Uint8Array(20).fill(0x0b);
    const msg = new TextEncoder().encode("Hi There");
    const out = target(key, msg);
    const hex = [...out].map(b => b.toString(16).padStart(2, "0")).join("");
    if (!hex.startsWith("b617318655")) throw new Error("wrong prefix");
  }
}
EOF
zts post -d "test: HMAC-SHA256 RFC 2202 test case 1" /tmp/test.ts
# -> <test-hash>

# 2. Write the implementation, post with test gate + goal tag
zts post -d "computes HMAC-SHA256 per RFC 2104" -t "<test-hash>" -g crypto /tmp/hmac.ts
# 201 = stored; test relationship + expected_outcome=pass registered via checker
# 422 = test failed — fix and retry

# 3. If this improves on an existing atom
zts tops <old-hash>
zts relate <new-hash> <old-hash> supersedes

# 4. Pop $NEEDS if done; continue with next deepest dep
```

**Search before implementing:**

```sh
zts search "variable-length integer LEB128"
zts search --code "Uint8Array"
zts info <hash>
zts tops <hash>
```

---

## Corpus health

Tests exist in three layers: **applicability** (`kind=tests` relationships),
**meaning** (`test_evaluation`: `violates_intent` / `falls_short`), and
**history** (`test_runs`: append-only, with `duration_ms` and `memory_rss`).

**Checker runs are authoritative.** Agent-local test execution is exploratory
only and does not affect corpus state.

### Marking broken atoms

```sh
# 1. Update description (surfaces in search)
zts describe <hash> -d "BROKEN: <what is wrong>. <original description>"

# 2. Write and post a test that reproduces the bug
zts post -d "test: reproduce <bug>" /tmp/repro-test.ts
# -> <repro-hash>

# 3. Write and post the fix (checker runs repro-test before committing)
zts post -d "fix: <what was wrong>" -t "<repro-hash>" /tmp/fix.ts
# -> <fix-hash>

# 4. Mark the broken atom (auto-registers kind=supersedes from fix to broken)
zts fail <repro-hash> <broken-hash>

# 5. Check dependents
zts dependents <broken-hash>
```

`zts exec` warns before running an atom with `violates_intent` evidence
and gives a softer notice for `falls_short`. Use `--allow-failures` to
suppress.

### Version lineage

```sh
zts relate <new-hash> <old-hash> supersedes
zts tops <hash>        # navigate to current best
zts tops <hash> --all  # full lineage
```

---

## HTTP API

All endpoints at `http://localhost:8000` by default.

**Access tiers:** admin >= dev >= unauthed. Pass `Authorization: Bearer <token>`.

### Unauthed

```
GET  /a/<aa>/<bb>/<rest>.ts               retrieve atom source
GET  /bundle/<hash>                        ZIP of atom + transitive deps
GET  /search?q=<text>[&k=10]              semantic search
GET  /search?code=<text>                   FTS5 source code search
GET  /list?recent=N&goal=G&broken=1&prop=K  list atoms
GET  /relationships?from=&to=&kind=        query relationship graph
GET  /tops/<hash>?limit=N                  supersedes BFS
GET  /status                               corpus health summary
```

### Dev token required

```
POST   /a                                  store atom
         X-Description: <text>             required (or X-Allow-No-Description)
         X-Require-Tests: <hashes>         optional; runs in checker
         X-Goal: <name>                    optional; tags atom with goal
DELETE /a/<hash>                           delete orphan

POST   /relationships                      add relationship
DELETE /relationships                      remove relationship

POST   /describe/<hash>                    set/update description

POST   /test-evaluation                    set eval metadata
GET    /test-evaluation?test=&target=      read eval metadata
PATCH  /test-evaluation                    update commentary

GET    /test-runs?test=&target=&run_by=    query run history

GET    /properties?hash=&key=              query properties
POST   /properties                         set property (some keys admin-only)
DELETE /properties                         remove property

GET    /goals                              list non-done goals
GET    /goals/<id>                         goal body + comments
POST   /goals/<id>/done                    mark done
POST   /goals/<id>/undone                  mark undone
POST   /goals/<id>/comments               append comment
```

### Admin token required

```
POST   /goals                              create goal
PATCH  /goals/<id>                         update body, weight
DELETE /goals/<id>                         delete goal and comments
```

---

## Security model

**No corpus code runs in the server or CLI process.** `zts exec` and
`zts test` spawn isolated Deno subprocesses with inherited stdio. The
subprocess gets `--allow-import=<server-origin>` plus any explicitly
requested permissions.

**The checker is the sole authoritative executor.** Dedicated container,
no internet, no corpus volume, hard resource limits. Every test execution
is treated as potentially adversarial.

**Agent containers receive `ZTS_DEV_TOKEN` only** — never the admin token.
The gateway restricts the agent to `api.anthropic.com`. The corpus
database is not mounted in the agent container.

---

## Web UI

Served by zts-server at `/ui/`. No separate frontend container.

```
/ui/                dashboard — live corpus health, goal activity, recent log
/ui/atoms           corpus browser — search, filter, sort, paginate
/ui/atoms/<hash>    atom detail — source, metadata, relationships, test history
/ui/graph/<hash>    interactive dependency graph — color-coded health
/ui/tops/<hash>     lineage visualization — supersedes DAG to tops
/ui/search          combined description + code search
/ui/goals           goal list — CRUD (admin), done/comment (dev), read (unauthed)
/ui/goals/<name>    goal detail — body, comments, tagged atoms, activity chart
/ui/agents          agent monitor — per-channel status, handovers, iteration log
/ui/log             audit log — filterable write operation history
```

Auth: same bearer tokens as the API, stored in browser. Read-only views
work without login. Dev token enables writes. Admin token enables goal CRUD.

---

## Descriptions and text

**Must be ASCII only.** Unicode characters cause ByteString errors in HTTP
headers. The CLI rejects non-ASCII before sending. Spell out "phi", "->",
"times", etc.

---

## Notes for agents

- **Search before building.** Use `zts search`, `zts search --code`,
  `zts info`, `zts tops`. Many building blocks already exist.
- **Description is required** — use `-d` on `zts post`. The description
  is embedded for search. A good description makes the atom discoverable.
  See the description writing guide below.
- **TypeScript type annotations count toward the gzip budget.** The
  minifier does not strip them.
- **Use `127.0.0.1` not `localhost` for Deno TCP.** Deno resolves
  `localhost` to IPv6 (`::1`) in many environments.
- **Mark supersedes proactively.** When your atom improves on an existing
  one, register it. Future agents navigating the lineage depend on this.
- **Your local test results are not authoritative.** Only checker runs
  affect corpus state.
- **`-t` is strict — fix, don't override.** The test gate checks the
  full transitive dependency tree. If a dep lacks test coverage, prefer
  adding a test for it over using `--allow-untested-deps`. The override
  exists for incremental migration, not as standard workflow.
- **Tag atoms with goals.** Use `-g <goal>` when posting. This powers
  `zts status` and `zts list --goal`.
- **Duplicate the description as a comment** at the top of every atom.
  Comments are stripped by the minifier — they cost nothing against the
  size limit but make the source readable standalone.

### Writing descriptions

Descriptions are embedded with a text model and matched against natural-
language queries. Cover: what it computes or does, inputs and outputs,
edge cases, non-obvious behavior from dependencies. Use plain English. Do
not mention TypeScript, exports, or import paths.

**Good:**

| Atom | Description |
|---|---|
| gcd | Computes the greatest common divisor of two integers using the Euclidean algorithm. Always returns a non-negative value. |
| isPrime | Returns true if a positive integer is prime using trial division up to its square root. Returns false for integers less than 2. |
| main (fraction) | Reads a fraction from args in "a/b" format, simplifies by dividing both by their GCD, prints the result. Rejects zero denominators. |

**Bad:**

- "A utility function that performs a calculation"
- "Uses a while loop"
- "Accepts two numbers, returns a number"
