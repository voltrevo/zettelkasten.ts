# Enforce banned platform APIs at validation time

## Problem

Agents ignore prompt guidance and use `crypto.subtle`, `CompressionStream`, etc.
directly in atoms. The whole point of the corpus is building these algorithms
from scratch.

## Proposed solution

Scan atom source at submission time for banned global references. Reject atoms
that use them. Could be:

1. **AST scan in `validateAtom`** — walk the TypeScript AST looking for member
   access on banned globals (`crypto.subtle.*`, `new CompressionStream`,
   `new DecompressionStream`, `new WebSocket`, etc.)

2. **Custom deno lint plugin** — run in the checker alongside existing lint.
   More extensible, rules can be configured per-corpus.

3. **Simple text scan** — grep for banned strings. Fast but false positives
   (e.g. the string "crypto.subtle" in a comment or description).

Option 1 is most precise. Option 2 is most extensible.

## Banned globals

- `crypto.subtle` / `crypto.getRandomValues` (use cap for randomness)
- `CompressionStream` / `DecompressionStream`
- `WebSocket`
- `fetch` (unless received via cap)
- `Deno.connect` / `Deno.listen` (unless received via cap)
- `Deno.readFile` / `Deno.writeFile` (unless received via cap)

## Cap distinction

The ban is on direct use of these globals. Receiving them via a `cap` parameter
is the intended pattern for I/O. But `crypto.subtle` should never be in a cap
either — the whole algorithm should be an atom.

## Configurable allowlist

Different experiments may want different rules. Consider a server-level config
for which globals are banned, so corpora can opt in/out.
