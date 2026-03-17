# zettelkasten.ts — Agent Guide

## What this is

A Deno server that stores **immutable TypeScript atoms** in a content-addressed,
git-backed flat corpus. Each atom is a single TypeScript module with exactly one
value export. Atoms are identified by a 25-character base36 keccak-256 hash.

The vision is a persistent code knowledge base where AI agents accumulate
reusable implementations over time — preferring to retrieve and reuse existing
atoms over writing new ones.

## Running

```sh
deno task zts run          # start server in foreground (port 8000)
deno task test             # run unit tests
deno task precommit        # fmt + typecheck + test + lint (run before committing)
```

Daemon commands (systemd user unit):

```sh
deno task zts start        # install + enable + start
deno task zts stop         # disable + stop
deno task zts restart
deno task zts log [-f]
```

## Server endpoints

```
POST /a                              store atom (X-Commit-Message header required)
                                     optional X-Require-Tests: hash1,hash2,...
                                     runs tests before committing; auto-registers relationships
                                     returns /a/xx/yy/<rest>.ts on success
GET  /a/<aa>/<bb>/<rest>.ts          retrieve atom by content address
DELETE /a/<hash>                     delete orphan atom (409 if has relationships)
GET  /bundle/<hash>                  download ZIP of atom + all transitive deps
GET  /search?q=<text>[&k=10]        semantic nearest-neighbor search (requires Ollama)
POST /relationships                  add a relationship between two atoms
DELETE /relationships                remove a relationship
GET  /relationships?from=&to=&kind= query relationships (at least one param required)
```

## Atom rules (enforced at submission)

1. **Exactly one value export** — function, class, const, or enum. Named only —
   `export default` is forbidden.
2. **Type-only exports are allowed** — `export type Foo` and `export interface`
   do not count toward the value export limit.
3. **Only relative atom imports** — the only valid import path format is
   `../../xx/yy/<21chars>.ts`. No npm packages, no JSR, no URLs, no bare
   specifiers.
4. **No exported `let`** — all exports must be `const` or function/class/enum.
5. **Size limit** — ≤ 768 bytes gzipped after minification.

## Capability convention (Cap)

Atoms that need external capabilities (I/O, time, randomness, fetch) must accept
them as an explicit `cap` parameter — the first argument of a function or
constructor. The atom should export a `Cap` type describing the interface:

```typescript
export type Cap = {
  console: Pick<Console, "log" | "error">;
  Deno: { args: readonly string[] };
};
export function main(cap: Cap): void { ... }
```

The real-world caller passes `globalThis` (or `{ console, Deno, fetch, ... }`).
Tests substitute only what they need to test. Atoms with no external
dependencies need not export `Cap`.

If an atom imports other atoms that export `Cap`, its own `Cap` is the
intersection of those plus any capabilities it needs directly.

## Storage layout

Atoms live at `~/.local/share/zettelkasten/` (a git repo):

```
a/
  xx/          ← first 2 chars of hash
    yy/        ← next 2 chars
      <21chars>.ts
zts.db         ← SQLite: embedding vectors + relationship graph
server.log     ← append-only log
```

Hash format: 25-char base36 keccak-256 (first 17 bytes of digest). The full hash
is `xx` + `yy` + `<21chars>`. Use `hashToUrlPath` / `hashToFilePath` in
server.ts for conversions.

## CLI workflow for adding atoms

```sh
# Write atom to a temp file, then post:
deno task zts post -m "brief description" /tmp/myatom.ts
# → /a/xx/yy/<rest>.ts   (201 = new, 200 = already existed)

# Post with test gate (tests must pass before atom is stored):
deno task zts post -m "description" -t "<test-hash1>,<test-hash2>" /tmp/myatom.ts
# → 201 if tests pass (relationships auto-registered), 422 if tests fail

# The hash is: xxyy<rest>
# Reference from another atom:
import { myFn } from "../../xx/yy/<rest>.ts";

# Retrieve:
deno task zts get <hash>

# Execute (atom must export main(cap)):
deno task zts exec <hash> [args...]

# Bundle to directory:
deno task zts bundle <hash> -o <parent-dir>
# extracts to <parent-dir>/<hash8>/run.ts + <parent-dir>/<hash8>/a/...

# Delete an orphan atom (no relationships):
deno task zts delete <hash>
# → 204 if deleted, 409 if has relationships, 404 if not found
```

To make an atom searchable, post a description after submitting it:

```sh
deno task zts describe <hash> -m "<description>"
```

Commit message in `x-commit-message` / `-m` must be **ASCII only** — Unicode
characters (e.g. `φ`) cause a ByteString error in the HTTP header.

The server validates atoms before storing (export count, import paths, size
limit after minification). Just post and let the server reject — don't try to
pre-check size yourself. Write clean, readable code; the server minifies before
the size check so manual minification gains nothing and hurts readability. Never
remove comments, shorten names, or compress formatting to meet the size limit —
only split at natural atom boundaries.

When building a multi-atom dependency tree, test leaves first before building on
them. A passing test on a leaf atom gives confidence to rely on it in
higher-level atoms. Discovering a bug in a leaf after the whole tree is built
means the entire tree may be suspect.

## Writing atom descriptions (for search)

Descriptions are embedded with a text model and matched against natural-language
queries. A good description makes the atom discoverable from queries like "find
GCD of two numbers" or "check if a number is prime".

**Prompt template** — use this when generating a description for a newly posted
atom:

```
Given this TypeScript atom and its resolved dependencies (if any), write a
description of its full behavior. Cover: what it computes or does, the meaning
of its inputs and outputs, any important edge cases or constraints, and any
non-obvious behavior that comes from how it uses its dependencies. Do not
mention TypeScript, exports, or import paths. Use plain English prose.

Atom:
<paste atom source here>

Dependencies (paste any relevant ones):
<paste dependency source here, or omit if none>

Description:
```

**Examples of good descriptions:**

| Atom                         | Good description                                                                                                                                                                                      |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gcd`                        | Computes the greatest common divisor of two integers using the Euclidean algorithm. Always returns a non-negative value; returns the absolute GCD when inputs are negative.                           |
| `isPrime`                    | Returns true if a positive integer is prime using trial division up to its square root. Returns false for integers less than 2. Runs in O(√n) time.                                                   |
| `primeFactors`               | Returns the list of distinct prime factors of a positive integer in ascending order. Uses trial division with primality testing; returns an empty array for 1 and primes return themselves.           |
| `main` (fraction simplifier) | Reads a fraction from command-line args in "a/b" format, simplifies it by dividing both numerator and denominator by their GCD, and prints the result. Rejects zero denominators and malformed input. |

**What to avoid:**

- Generic: "A utility function that performs a calculation"
- Naming implementation details without explaining behavior: "Uses a while loop"
- Paraphrasing the type signature: "Accepts two numbers, returns a number"

## Key source files

| File                 | Purpose                                                          |
| -------------------- | ---------------------------------------------------------------- |
| `src/server.ts`      | HTTP server: routes, atom storage, git commits, search           |
| `src/validate.ts`    | Atom validation: export count, import paths, size limit          |
| `src/bundle.ts`      | Dependency graph walking, ZIP build/parse                        |
| `src/minify.ts`      | Comment stripping + whitespace collapse (for size check)         |
| `src/db.ts`          | SQLite wrapper: embeddings + `RelationshipStore`                 |
| `src/embed.ts`       | Embedding API client (Ollama/OpenAI), cosine similarity, topK    |
| `src/test-runner.ts` | Subprocess entry point for running test atoms against a target   |
| `main.ts`            | CLI entry point: run/start/stop/log/get/post/exec/bundle/test    |
| `run.ts`             | Universal exec entry point: imports root atom's `main`, calls it |

## Writing test atoms

A test atom exports a class named `Test` with a `static name` string and a
`run(target)` method. The type of `target` should be the concrete interface the
test requires — all linked targets must satisfy it at runtime.

```typescript
export class Test {
  static name = "gcd: coprime inputs return their GCD";
  run(target: (a: number, b: number) => number): void {
    if (target(12, 8) !== 4) throw new Error("expected gcd(12,8) = 4");
    if (target(7, 13) !== 1) throw new Error("expected gcd(7,13) = 1");
  }
}
```

Rules:

- The value export must be named exactly `Test` (the runner imports it by name)
- No constructor arguments — the test creates its own mocks internally
- No real I/O; the test subprocess runs with `--allow-import=<server>` only

### Registering a test relationship

```sh
# POST /relationships runs the test before storing the relationship.
# 201 = new, 200 = already registered, 422 = test failed.
curl -s -X POST http://localhost:8000/relationships \
  -H "content-type: application/json" \
  -d '{"kind":"tests","from":"<test-hash>","to":"<target-hash>"}'
```

### Running tests for an atom

```sh
zts test <target-hash>
```

Fetches all registered test hashes from the server, then spawns a local
`deno test` process importing each test atom from the server.

## TDD process for building atom trees

Use this process when building a tree of atoms with test coverage:

```
NEEDS="/tmp/name-$(date +%s)-needs.txt"
echo "<top-level goal>" > "$NEEDS"

loop:
  CURRENT=$(tail -1 "$NEEDS")

  # --- first visit: design and draft ---
  If this is a new need (no draft yet):
    1. Design the atom's interface (what it exports, what deps it needs)
    2. Search corpus for existing atoms that satisfy dependencies
    3. Write test atoms FIRST — post them normally (tests don't import target)
    4. Write the implementation atom (save draft to /tmp/)
    5. If some deps are hypothetical:
       - Append missing dep names to $NEEDS
       - Continue loop (picks up deepest need next via tail -1)

  # --- deps satisfied: post and finish ---
  Post with test gate: zts post -m "desc" -t "<test1>,<test2>" /tmp/draft.ts
  - On 201: pop $CURRENT from needs file, add description
  - On 422: fix atom, retry

  Cleanup: if a test is bad, zts delete <test-hash>
  (409 means it's in use — just leave it)
```

Key properties:

- **Stack-driven**: `tail -1` = depth-first, naturally reaches leaves first
- **Tests before code**: test atoms don't import the target, so they can exist
  before it does
- **Atomic quality gate**: conditional post = atom only enters corpus if tests
  pass; relationships auto-registered on success
- **Self-healing**: bad tests get cleaned up; failed posts don't pollute git

## What is not yet implemented

From VISION.md (incomplete items):

- **Discovery endpoints** — no `/list`, no tag-based or relationship-based
  search
- **Graph inspection** — no reverse-dependency queries, no `/graph` endpoint
- **Test result history** — pass/fail relationship exists but no per-run timing
  or history
- **Metadata extraction** — export names/types not indexed beyond the embedding
- **Normalization** — atoms stored verbatim, no canonical formatting enforced
- **Execution planning / graph safety checks** — `zts exec` runs without
  checking for known problems or better alternatives
- **Default export rejection** — `export default` is not yet rejected by
  validate
- **Singleton/complexity heuristics** — top-level mutation, static mutable
  fields not yet detected

See `VISION.md` for the full specification and implementation status checklist.
