# zettelkasten.ts — Agent Guide

## What this is

A Deno server that stores **immutable TypeScript atoms** in a content-addressed,
SQLite-backed corpus. Each atom is a single TypeScript module with exactly one
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
deno task zts server-log [-f]
```

Requires `ZTS_DEV_TOKEN` and `ZTS_ADMIN_TOKEN` in environment. The server
refuses to start without them. Tokens are saved to `~/.local/share/zettelkasten/env`
for the systemd unit.

## Atom rules (enforced at submission)

1. **Exactly one value export** — function, class, const, or enum. Named only —
   `export default` is forbidden.
2. **Type-only exports are allowed** — `export type Foo` and `export interface`
   do not count toward the value export limit.
3. **Only relative atom imports** — the only valid import path format is
   `../../xx/yy/<21chars>.ts`. No npm packages, no JSR, no URLs, no bare
   specifiers.
4. **No exported `let`** — all exports must be `const` or function/class/enum.
5. **Size limit** — ≤ 1024 bytes gzipped after minification.

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

All data lives in `~/.local/share/zettelkasten/`:

```
zts.db         ← SQLite: atoms, embeddings, relationships, properties,
                 test_evaluation, test_runs, goals, goal_comments,
                 prompts, log, schema_version, atoms_fts
server.log     ← append-only process log
env            ← auth tokens for systemd
```

Hash format: 25-char base36 keccak-256 (first 17 bytes of digest). The full hash
is `xx` + `yy` + `<21chars>`. Hash prefixes work everywhere — the server resolves
unambiguous prefixes to full hashes automatically.

## Auth

Bearer tokens, three tiers:
- **unauthed** — reads (get, list, search, info, rels, etc.)
- **dev** — writes (post, delete, describe, relate, test, eval, goal done/comment, etc.)
- **admin** — goal CRUD, starred property, prompt overrides

The CLI auto-includes the right token from `ZTS_DEV_TOKEN` / `ZTS_ADMIN_TOKEN`
environment variables.

## CLI reference

### Corpus

```sh
zts post -d "desc" -t <tests> [-g <goal>] <file>   # store atom (tests + desc required)
zts post -d "desc" --no-tests <file>                # skip test requirement
zts post --no-description --no-tests <file>         # skip both (not recommended)
zts get <hash>                                       # retrieve source
zts describe <hash> [-d "text"]                      # read or update description
zts list [--recent N] [--goal G] [--broken] [--prop K]  # list atoms
zts info <hash>                                      # full atom info
zts size <file>                                      # estimate gzip size
zts search <query> [-k N]                            # semantic search on descriptions
zts search --code <query> [-k N]                     # FTS5 search on source code
zts delete <hash>                                    # delete orphan (409 if has rels)
zts exec <hash> [args...]                            # run atom's main(globalThis)
zts bundle <hash> [-o <dir>]                         # ZIP of atom + transitive deps
```

### Relationships

```sh
zts rels [--from H] [--to H] [--kind K]   # query (at least one filter required)
zts dependents <hash>                      # atoms that import this one
zts relate <from> <kind> <to>              # add (reads naturally: "A tests B")
zts unrelate <from> <kind> <to>            # remove
zts tops <hash> [--limit N] [--all]        # navigate supersedes graph upward
```

Kinds: `imports`, `tests`, `supersedes`.

### Testing

```sh
zts test <hash>                            # run applicable tests (expected_outcome=pass)
zts violates_intent <test> <atom>          # mark correctness defect
zts falls_short <test> <atom>              # mark quality gap
zts eval show <test> <target>              # read eval metadata
zts eval set <test> <target> --expected <outcome> [--commentary <text>]
zts runs <hash> [--recent N]               # test run history
```

### Properties

```sh
zts prop set <hash> <key> [value]          # set (admin-only keys auto-detected)
zts prop unset <hash> <key>                # remove
zts prop list <hash>                       # list
```

### Goals

```sh
zts goal pick [--n N]                      # weighted random sample of active goals
zts goal show <name>                       # full body + all comments
zts goal list [--done] [--all]             # list goals
zts goal done <name>                       # mark complete
zts goal undone <name>                     # revert
zts goal comment <name> "text"             # append observation
zts goal comments <name> [--recent N]      # read observations
```

### Admin

```sh
zts admin goal add <name> [--weight N] [--body <text>]
zts admin goal set <name> [--weight N] [--body <text>]
zts admin goal delete <name>
zts show-prompt <context|iteration|retrospective>
```

### Status & logs

```sh
zts status [--since YYYY-MM-DD]            # corpus health summary
zts log [--recent N] [--op X] [--subject X]  # audit log
zts server-log [-f] [-n <lines>]           # process log (tail)
```

### Agent loop

```sh
zts worker run [flags]                     # start the agent loop
zts worker setup [flags]                   # create workspace
zts worker stop [flags]                    # stop a running worker

# Flags: --channel, --max-turns, --max-iters, --once, --model,
#   --dangerously-skip-permissions, --context-prompt, --iteration-prompt,
#   --retrospective-prompt, --workspaces-dir
```

All commands support `-h`/`--help` for detailed usage.

## CLI workflow for adding atoms

```sh
# Write atom to a temp file, then post:
zts post -d "brief description" -t "<test1>,<test2>" /tmp/myatom.ts
# → 201 if tests pass (relationships auto-registered), 422 if tests fail

# The hash is: xxyy<rest>
# Reference from another atom:
import { myFn } from "../../xx/yy/<rest>.ts";
```

Descriptions are required (`-d`). Tests are required (`-t`). Use `--no-tests`
or `--no-description` to opt out explicitly.

Description must be **ASCII only** — Unicode characters cause a ByteString error
in the HTTP header.

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

## Description comment convention

The first line(s) of every atom must be a comment containing the description,
identical to what is passed via `-d`. Comments are stripped by the minifier and
cost nothing against the size limit.

## Writing atom descriptions (for search)

Descriptions are embedded with nomic-embed-text (via Ollama) and matched against
natural-language queries. A good description makes the atom discoverable.
Longer, more detailed descriptions produce significantly better search matches.

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

## Marking broken atoms

If you discover an atom is incorrect, prefix its description with `BROKEN:`
and explain the specific failure. Also check dependents (`zts dependents <hash>`)
and mark any that inherit the breakage.

```sh
zts describe <hash> -d "BROKEN: <what is wrong>. <original description>"
```

## Key source files

| File                 | Purpose                                                          |
| -------------------- | ---------------------------------------------------------------- |
| `src/server.ts`      | HTTP server: routes, atom storage, search, auth enforcement      |
| `src/db.ts`          | Unified SQLite wrapper: all tables, schema migrations            |
| `src/validate.ts`    | Atom validation: export count, import paths, size limit          |
| `src/bundle.ts`      | Dependency graph walking, ZIP build/parse                        |
| `src/minify.ts`      | Comment stripping + whitespace collapse (for size check)         |
| `src/embed.ts`       | Embedding API client (Ollama), cosine similarity, topK           |
| `src/auth.ts`        | Auth tier resolution and checking                                |
| `src/prompts.ts`     | Compiled default agent prompts (context, iteration, retrospective) |
| `src/worker.ts`      | Agent loop: workspace management, claude subprocess, handovers   |
| `src/test-runner.ts` | Subprocess entry point for running test atoms against a target   |
| `main.ts`            | CLI entry point: all subcommands                                 |
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
    2. Write the full description first — what it computes, inputs/outputs, edge cases
    3. Search on that description: zts search "<your full description>"
       If a usable match exists, reuse it. If not, you already have the -d text.
    4. Write test atoms FIRST — post them normally (tests don't import target)
    5. Write the implementation atom (save draft to /tmp/)
    6. If some deps are hypothetical:
       - Append missing dep names to $NEEDS
       - Continue loop (picks up deepest need next via tail -1)

  # --- deps satisfied: post and finish ---
  Post with test gate: zts post -d "desc" -t "<test1>,<test2>" /tmp/draft.ts
  - On 201: pop $CURRENT from needs file
  - On 422: fix atom, retry

  Cleanup: if a test is bad, zts delete <test-hash>
  (409 means it's in use — just leave it)
```

Key properties:

- **Stack-driven**: `tail -1` = depth-first, naturally reaches leaves first
- **Description-first**: write description before code, search on it to find reusable atoms
- **Tests before code**: test atoms don't import the target, so they can exist
  before it does
- **Atomic quality gate**: conditional post = atom only enters corpus if tests
  pass; relationships auto-registered on success
- **Self-healing**: bad tests get cleaned up; failed posts don't pollute the corpus
