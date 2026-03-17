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
POST /a                         store atom (X-Commit-Message header required)
                                returns /a/xx/yy/<rest>.ts on success
GET  /a/<aa>/<bb>/<rest>.ts     retrieve atom by content address
GET  /bundle/<hash>             download ZIP of atom + all transitive deps
GET  /search?q=<text>[&k=10]   semantic nearest-neighbor search (requires Ollama)
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
zts.db         ← SQLite: embedding vectors (Float32Array, nomic-embed-text)
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
```

To make an atom searchable, post a description after submitting it:

```sh
deno task zts describe <hash> -m "<description>"
```

Commit message in `x-commit-message` / `-m` must be **ASCII only** — Unicode
characters (e.g. `φ`) cause a ByteString error in the HTTP header.

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

| File              | Purpose                                                          |
| ----------------- | ---------------------------------------------------------------- |
| `src/server.ts`   | HTTP server: routes, atom storage, git commits, search           |
| `src/validate.ts` | Atom validation: export count, import paths, size limit          |
| `src/bundle.ts`   | Dependency graph walking, ZIP build/parse                        |
| `src/minify.ts`   | Comment stripping + whitespace collapse (for size check)         |
| `src/db.ts`       | SQLite wrapper: `hash → Float32Array` embedding storage          |
| `src/embed.ts`    | Embedding API client (Ollama/OpenAI), cosine similarity, topK    |
| `main.ts`         | CLI entry point: run/start/stop/log/get/post/exec/bundle         |
| `run.ts`          | Universal exec entry point: imports root atom's `main`, calls it |

## What is not yet implemented

From VISION.md (incomplete items):

- **Full relational database** — no atoms/tests/relationships/problems tables
  yet; only the `embeddings` table exists in `zts.db`
- **Discovery endpoints** — no `/list`, no tag-based or relationship-based
  search
- **Graph inspection** — no reverse-dependency queries, no `/graph` endpoint
- **Tests as first-class artifacts** — no `/tests` endpoint, no test recording
- **Metadata extraction** — export names/types not indexed beyond the embedding
- **Normalization** — atoms stored verbatim, no canonical formatting enforced
- **Execution planning / graph safety checks** — `zts exec` runs without
  checking for known problems or better alternatives
- **Default export rejection** — `export default` is not yet rejected by
  validate
- **Singleton/complexity heuristics** — top-level mutation, static mutable
  fields not yet detected

See `VISION.md` for the full specification and implementation status checklist.
