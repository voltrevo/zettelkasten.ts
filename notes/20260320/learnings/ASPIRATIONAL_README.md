# zettelkasten.ts

A persistent, content-addressed code knowledge base for AI agents. Atoms —
immutable TypeScript modules, each with exactly one export — accumulate in a
git-backed corpus. Agents build on what exists rather than rebuilding from
scratch. The corpus compounds.

---

## Architecture

```
Internet
  │
  ▼
[gateway]       Squid proxy — allowlist: api.anthropic.com only
  │
  │  (zts-net: internal Docker network — no direct internet access)
  │
  ├── [zts-server]   Authoritative archive. HTTP API, corpus + SQLite.
  │         │        Never executes atom code.
  │     [checker]    Evaluation chamber. Runs tests only. No internet.
  │                  Strong resource limits. Results are authoritative.
  │
  └── [agent]        Research lab. Claude Code + zts CLI, N channels.
                     Unsafe locally, safe externally.
```

Four containers, one compose file. The corpus is the server's private storage —
agents interact with it exclusively through the HTTP API and CLI. No container
has filesystem access to another's data.

---

## Quick Start

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

# Agent channels (comma-separated; one loop per channel in the agent container)
ZTS_CHANNELS=bricklane,starling

# Optional
ZTS_SERVER_URL=http://zts-server:8000   # default
GATEWAY_IP=172.29.0.2                   # default
GATEWAY_PORT=3128                       # default
ZTS_TEST_TIMEOUT=30                     # checker per-test wall-clock limit, seconds
```

---

## Atom model

An atom is a single TypeScript module with exactly one value export. Atoms are
identified by a 25-character base36 keccak-256 hash and stored at
`a/xx/yy/<21chars>.ts`.

**Rules (enforced at submission):**

1. Exactly one value export — function, class, const, or enum. Named only;
   `export default` is forbidden. Type-only exports (`export type`,
   `export interface`) do not count.
2. Only relative atom imports — `../../xx/yy/<21chars>.ts`. No npm, no JSR, no
   URLs, no bare specifiers.
3. No exported `let` — exports must be `const`, function, class, or enum.
4. Size limit — ≤ 768 bytes gzipped after minification. Write clean, readable
   code; the server minifies before checking.

**Cap convention:** atoms that need external capabilities (I/O, time,
randomness, fetch) accept them as an explicit `cap` first argument and export a
`Cap` type. Tests substitute only what they need.

```typescript
export type Cap = {
  console: Pick<Console, "log" | "error">;
  Deno: { args: readonly string[] };
};
export function main(cap: Cap): void { ... }
```

---

## CLI reference

The `zts` CLI requires `ZTS_SERVER_URL` (default: `http://localhost:8000`) and,
for write operations, `ZTS_DEV_TOKEN`. Admin operations require
`ZTS_ADMIN_TOKEN`.

### Corpus

```sh
# Store an atom (201 = new, 200 = already exists, 400 = invalid, 413 = too large)
zts post -m "commit message" /tmp/atom.ts

# Store with test gate — tests run in checker before commit
# 201 = stored + relationships registered, 422 = test failed
zts post -m "hmac: HMAC-SHA256" -t "<test-hash1>,<test-hash2>" /tmp/atom.ts

# Include description at post time (avoids forgetting the separate describe step)
zts post -m "commit message" -d "what it computes and why" /tmp/atom.ts

# Retrieve atom source
zts get <hash>

# Describe (write or update) / read back
zts describe <hash> -m "description text"
zts describe <hash>

# Estimate gzip size before posting (client-side minify + compress)
zts size /tmp/atom.ts

# Semantic search
zts search "HKDF key derivation SHA-256" [--k 10]

# List recent atoms
zts list [--recent N] [--kind tests] [--broken]

# Full atom info: source, description, size, registered tests, dependents
zts info <hash>

# Delete orphan (409 if has relationships)
zts delete <hash>
```

### Relationships

```sh
# Query
zts rels --from <hash> [--kind <kind>]   # what does this atom import/test/supersede?
zts rels --to <hash> [--kind <kind>]     # what imports/tests/supersedes this atom?
zts dependents <hash>                    # shorthand: --to <hash> --kind imports

# Register
# kind=tests: runs test in checker, stores relationship + expected_outcome=pass in metadata
# kind=supersedes, kind=imports: stored directly, no execution
zts relate <from-hash> <to-hash> [kind]

# Remove
zts unrelate <from-hash> <to-hash> [kind]
```

### Testing

```sh
# Run all applicable tests (expected_outcome=pass) via checker
zts test <hash>

# Run tests with non-default expected outcomes
zts test <hash> --expected violates_intent   # see correctness evidence
zts test <hash> --expected falls_short       # see improvement opportunities

# Mark correctness defect — sets expected_outcome=violates_intent, mode=contract
# Requires: test already passes against some atom; checker verifies it fails target
zts fail <test-hash> <broken-atom-hash>

# Mark improvement opportunity — sets expected_outcome=falls_short, mode=benchmark
# Checker verifies the atom actually fails the benchmark
zts benchmark <test-hash> <target-hash>

# Read or annotate evaluation metadata for a test-target pair
zts eval show <test-hash> <target-hash>
zts eval set <test-hash> <target-hash> --commentary "why this is expected"
```

### Execution

```sh
# Execute an atom's main(cap) — runs in isolated Deno subprocess with inherited stdio
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
# Navigate supersedes graph to current best alternatives (BFS, closest first)
# Default limit: 5, completing the BFS level where the limit is reached
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
# Emit and run the worker loop script (channels from ZTS_CHANNELS or --channel)
zts script worker | bash
zts script worker --channel bricklane | bash

# Initialise a fresh agent workspace directory
zts script setup [--channel <name>] [--workspace <dir>]

# Inspect the prompts shipped with this version of zts
zts script context      # system context given to every agent session
zts script iteration    # per-iteration instructions

# Customise prompts
zts script context > my-context.md && $EDITOR my-context.md
# use: cat my-context.md && zts script iteration
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
    const expected = [0xb6,0x17,0x31,0x86,0x55,0x05,0x72,0x64,
                      0xe2,0x8b,0xc0,0xb6,0xfb,0x37,0x8c,0x8e];
    for (let i = 0; i < expected.length; i++)
      if (out[i] !== expected[i])
        throw new Error(`byte ${i}: expected ${expected[i]}, got ${out[i]}`);
  }
}
EOF
zts post -m "test: hmac RFC 2202 test case 1" /tmp/test.ts
# → <test-hash>

# 2. Write the implementation, post with test gate + description
zts post -m "hmac: HMAC-SHA256 per RFC 2104" \
         -d "Computes HMAC-SHA256. Accepts key and message as Uint8Array, returns 32-byte digest." \
         -t "<test-hash>" /tmp/impl.ts
# 201 = stored, kind=tests relationship + expected_outcome=pass registered via checker
# 422 = test failed — fix and retry

# 3. If this atom improves on an existing one, mark it
zts tops <old-hash>                          # check what already supersedes it
zts relate <new-hash> <old-hash> supersedes  # if not already auto-registered

# 4. Pop $NEEDS if done; otherwise continue with next deepest dep
```

**Search before implementing** — many building blocks already exist:

```sh
zts search "variable-length integer LEB128"
zts info <hash>        # source + description + tests + dependents
zts tops <hash>        # navigate to current best version in lineage
```

---

## Corpus health

Tests exist in three layers: **applicability** (`kind=tests` relationships),
**meaning** (`test_evaluation` metadata: `violates_intent` / `falls_short`), and
**history** (`test_runs` table: append-only, includes `duration_ms` and
`memory_rss`).

**Checker runs are authoritative.** Agent-local test execution is exploratory
only and does not affect corpus state. Divergence between local and checker
results is a meaningful signal.

### Marking broken atoms

```sh
# 1. Update description (surfaces in search)
zts describe <hash> -m "BROKEN: <what is wrong>. <original description>"

# 2. Write and post a test that reproduces the bug
zts post -m "test: reproduce <bug>" /tmp/repro-test.ts
# → <repro-hash>

# 3. Write and post the fix (checker runs repro-test before committing)
zts post -m "fix: <what was wrong>" -t "<repro-hash>" /tmp/fix.ts
# → <fix-hash>; expected_outcome=pass registered for (repro-hash, fix-hash)

# 4. Mark the broken atom
zts fail <repro-hash> <broken-hash>
# Checker verifies repro-hash fails against broken-hash
# Auto-registers kind=supersedes from=fix-hash to=broken-hash

# 5. Check dependents
zts dependents <broken-hash>
# Inspect each; mark broken if they inherit the breakage
```

`zts exec` warns before running an atom with `violates_intent` evidence and
gives a softer notice for `falls_short`. Use `--allow-failures` to suppress.

### Marking improvement opportunities

```sh
# Post a benchmark test that the old atom fails
zts post -m "bench: <dimension>" /tmp/bench.ts  # → <bench-hash>

# Mark old atom as falling short
zts benchmark <bench-hash> <old-hash>

# Register passing against the new atom
zts relate <bench-hash> <new-hash> tests
```

### Version lineage

```sh
# Mark supersedes (manual; also auto-registered from zts fail evidence)
zts relate <new-hash> <old-hash> supersedes

# Navigate to current best versions (BFS, level-complete)
zts tops <hash>
zts tops <hash> --all
```

---

## HTTP API

All endpoints are at `http://localhost:8000` by default.

**Access tiers:** admin ⊇ dev ⊇ unauthed. Pass `Authorization: Bearer <token>`.

### Unauthed

```
GET  /a/<aa>/<bb>/<rest>.ts               retrieve atom source
GET  /bundle/<hash>                        ZIP of atom + transitive deps
GET  /search?q=<text>[&k=10]              semantic search
GET  /list?recent=N&kind=tests&broken=1   list atoms
GET  /relationships?from=&to=&kind=       query relationship graph
GET  /tops/<hash>?limit=N                 supersedes BFS to tops
```

### Dev token required

```
POST   /a                                  store atom
         X-Commit-Message: <ascii>
         X-Require-Tests: <hashes>         optional; runs in checker
         X-Description: <text>             optional; stored atomically
DELETE /a/<hash>                           delete orphan

POST   /relationships                      add relationship
DELETE /relationships                      remove relationship

POST   /describe/<hash>                    set/update description

POST   /test-evaluation                    set eval metadata (fail/benchmark)
GET    /test-evaluation?test=&target=      read eval metadata for a pair
PATCH  /test-evaluation                    update commentary

GET    /test-runs?test=&target=&run_by=    query run history

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

**No corpus code runs in the server or CLI process.** `zts exec` and `zts test`
spawn isolated Deno subprocesses with inherited stdio. The subprocess gets
`--allow-import=<server-origin>` plus any explicitly requested permissions. The
CLI process itself requires only HTTP access to the server.

**The checker is the sole authoritative executor.** It runs in a dedicated
container with no internet access, no corpus volume, and hard resource limits:
30s wall-clock timeout per test run (configurable via `ZTS_TEST_TIMEOUT`), 256
MB memory per subprocess. Every test execution is treated as potentially
adversarial — test atoms are untrusted code.

**Agent containers receive `ZTS_DEV_TOKEN` only** — never the admin token. The
gateway allowlist restricts the agent to `api.anthropic.com`. The corpus
filesystem is not mounted in the agent container. Each channel runs as an
independent `zts script worker` process within the single agent container.

---

## Commit messages and descriptions

**Must be ASCII only.** Unicode characters cause ByteString errors in HTTP
headers. The CLI rejects non-ASCII before sending. Spell out "phi", "->",
"times", etc.

---

## Notes for agents

- **Search before building.** Use `zts search`, `zts info`, `zts tops`. Many
  building blocks already exist. Rebuilding wastes corpus budget.
- **Describe immediately** — use `-d` at post time or call `zts describe` right
  after. Undescribed atoms block the `-t` gate for atoms that depend on them.
- **TypeScript type annotations count toward the gzip budget.** The minifier
  does not strip them. Keep this in mind near the 768B limit.
- **Use `127.0.0.1` not `localhost` for Deno TCP.** Deno resolves `localhost` to
  IPv6 (`::1`) in many environments.
- **Mark supersedes proactively.** When your atom improves on an existing one —
  more capable, faster, cleaner, different tradeoffs — register it. Future
  agents navigating the lineage depend on this.
- **Your local test results are not authoritative.** Only checker runs affect
  corpus state. Use local runs for rapid iteration; the checker is the gate.
- **Test atoms with no relationships can be deleted:** `zts delete <test-hash>`.
  A 409 means it is in use — update its description instead.
