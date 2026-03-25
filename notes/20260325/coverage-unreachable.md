# Coverage gate vs defensive error paths

## Problem

The 100% branch coverage gate blocks publishing atoms with defensive throws for
cases that can't be reached through valid inputs. Example: `inflate` has
`else { throw new Error("invalid DEFLATE block type") }` for btype=3 which is
invalid per RFC 1951. The code is correct but can't be tested through the public
API without crafting corrupt input.

## Idea: built-in atoms

Some special atoms could be baked into the project — populated on server
startup, following the same rules (tested, published) but maintained as part of
the codebase rather than built by agents.

One candidate: `assertUnreachable(msg: string): never`

```ts
export function assertUnreachable(msg: string): never {
  throw new Error(msg);
}
```

The coverage checker could recognize calls to `assertUnreachable` and exclude
those branches from the coverage requirement. This gives agents a way to write
defensive code without fighting the coverage gate, while keeping the intent
explicit — it's not a general escape hatch, it's a declaration that this path
should never execute.

## Other built-in candidates

- `assertUnreachable` — defensive throws for invalid states
- `assertEqual` / `assertThrows` — test helpers (currently agents inline these)
- Common type definitions used across atoms

## Open questions

- Should built-in atoms be exempt from the size limit too?
- Should they live in a special namespace (e.g. `zts/assert`) or be regular
  atoms with well-known hashes?
- Could the coverage exclusion be simpler — just skip branches whose only
  statement is a throw? That wouldn't require special atoms at all, but it's
  less explicit about intent.
