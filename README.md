# zettelkasten.ts

A content-addressed corpus of immutable TypeScript atoms, backed by Git and
served over HTTP. Designed for AI agents and humans to accumulate, discover, and
reuse small pieces of code across projects.

## Concept

The unit of code is an **atom**: a single TypeScript module that exports exactly
one named symbol. Atoms are identified by a 25-character base36 hash of their
content. Once stored, an atom never changes — its hash is its permanent
identity.

Atoms may depend on other atoms via relative imports. They may not import
external packages, URLs, or bare specifiers. Side effects and I/O are expressed
through explicit capability interfaces (`cap` parameters), not ambient globals.

This makes atoms small, composable, testable in isolation, and safe to reuse
without surprises.

## Setup

**Requirements:** [Deno](https://deno.land) and [Ollama](https://ollama.com)
(optional — only needed for semantic search).

```sh
# Clone and install the zts CLI
git clone <repo>
cd zettelkasten.ts
deno task install

# Start the server as a systemd user service
zts start
```

If you add Ollama for search:

```sh
ollama pull nomic-embed-text
```

The server listens on `http://localhost:8000`. Re-run `deno task install` any
time `deno.json` changes to keep the CLI in sync.

## Server endpoints

```
POST /a                           store atom (X-Commit-Message header required)
GET  /a/<aa>/<bb>/<rest>.ts       retrieve atom by content address
GET  /bundle/<hash>               download ZIP of atom + all transitive deps
POST /a/<hash>/description        store a searchable description (requires Ollama)
GET  /a/<hash>/description        retrieve description
GET  /search?q=<text>[&k=10]      semantic nearest-neighbor search (requires Ollama)
```

## CLI reference

```
zts start                         install and start daemon (enable on boot)
zts stop                          stop daemon and disable on boot
zts restart                       reinstall unit and restart daemon
zts run                           run server in foreground (no systemd)
zts log [-f] [-n <lines>]         show server log

zts post -m <message> [file]      store atom (stdin if no file)
zts get <hash>                    print atom source
zts describe <hash> -m <text>     store searchable description
zts search <query> [-k <n>]       semantic search, default k=10
zts exec <hash> [args...]         run atom's main(globalThis)
zts bundle <hash> [-o <dir>]      download ZIP bundle (or extract to dir)
```

## Writing atoms

An atom is a single `.ts` file that:

- Exports **exactly one named value** (function, class, const, or enum)
- Imports only other atoms via relative paths: `../../xx/yy/<21chars>.ts`
- Has no `export default`
- Uses `const` not `let` for exports
- Fits within 768 bytes gzipped (after minification)

```typescript
// A valid atom
export function gcd(a: number, b: number): number {
  while (b !== 0) {
    const t = b;
    b = a % b;
    a = t;
  }
  return Math.abs(a);
}
```

Type-only exports (`export type`, `export interface`) are allowed alongside the
single value export:

```typescript
export type Cap = {
  console: Pick<Console, "log" | "error">;
  Deno: { args: readonly string[] };
};

export function main(cap: Cap): void { ... }
```

## Capability convention

Atoms that need external I/O accept a `cap` parameter as their first argument.
The type of `cap` declares exactly what external surface the atom uses:

```typescript
export type Cap = {
  fetch: typeof fetch;
  Date: Pick<typeof Date, "now">;
};

export function pollEndpoint(cap: Cap, url: string): Promise<number> {
  return cap.fetch(url).then(() => cap.Date.now());
}
```

Callers pass `globalThis` (or a subset). Tests substitute only what they need.
If an atom imports other atoms that export `Cap`, its own `Cap` is the
intersection of theirs plus any additional capabilities it needs directly.

## Development workflow

### 1. Search before you write

Before implementing something, check whether it already exists:

```sh
zts search "greatest common divisor"
zts search "check if a number is prime"
```

If a match looks right, retrieve and read it:

```sh
zts get <hash>
```

### 2. Write the atom

Write your atom to a temp file. Keep it small and focused — one export, no
external imports. If it needs I/O, define a `Cap` type.

```typescript
// /tmp/is-prime.ts
export function isPrime(n: number): boolean {
  if (n < 2) return false;
  if (n === 2) return true;
  if (n % 2 === 0) return false;
  for (let i = 3; i * i <= n; i += 2) {
    if (n % i === 0) return false;
  }
  return true;
}
```

To import another atom, use its hash path. Get the path from `zts post` output
or from `zts search`:

```typescript
import { gcd } from "../../29/q3/3z8rqiv6wi7e6wmkfogud.ts";
```

### 3. Store the atom

```sh
zts post -m "primality test via trial division" /tmp/is-prime.ts
# → /a/1e/00/ajro7glwpdy5jkv48v09e.ts
```

The hash is the path without `/a/`, slashes, and `.ts`:
`1e00ajro7glwpdy5jkv48v09e`.

A 200 response means the atom already existed (idempotent). A 201 means it was
newly stored.

### 4. Describe it for search

Post a plain-English description so the atom is discoverable by future queries:

```sh
zts describe 1e00ajro7glwpdy5jkv48v09e -m "Returns true if a positive integer \
is prime using trial division up to the square root. Returns false for integers \
less than 2. Handles 2 as a special case. Runs in O(sqrt(n)) time."
```

A good description covers what it computes, the meaning of inputs and outputs,
edge cases, and any non-obvious behavior from its dependencies. Richer
descriptions produce better search results.

### 5. Test and run

Run an atom directly if it exports `main(cap)`:

```sh
zts exec 1e00ajro7glwpdy5jkv48v09e   # (no main — just an example)
zts exec 2jkr3h8zsm3c0xcgzbmbrkath 3/12
# → 1/4
```

Bundle an atom with all its dependencies for offline use or distribution:

```sh
zts bundle 2jkr3h8zsm3c0xcgzbmbrkath -o /tmp/fraction
# Extracts to /tmp/fraction/<hash8>/run.ts + a/...
deno run --allow-all /tmp/fraction/2jkr3h8z/run.ts 3/12
# → 1/4
```

## Atom rules (enforced at submission)

| Rule              | Detail                                                                        |
| ----------------- | ----------------------------------------------------------------------------- |
| One value export  | Function, class, const, or enum. Named only — `export default` is forbidden.  |
| Type exports OK   | `export type` and `export interface` don't count toward the limit.            |
| Atom-only imports | Only `../../xx/yy/<21chars>.ts` paths. No npm, JSR, URLs, or bare specifiers. |
| No exported `let` | All value exports must be `const`, function, class, or enum.                  |
| Size limit        | ≤ 768 bytes gzipped after minification.                                       |

## Storage layout

```
~/.local/share/zettelkasten/
  a/
    xx/           ← first 2 chars of hash
      yy/         ← next 2 chars
        <21chars>.ts
  zts.db          ← SQLite: descriptions + embedding vectors
  server.log      ← append-only request log
```

Each stored atom is committed to a Git repo at that path with the message
`<hash8>: <your message>`, giving a full audit trail.

## Semantic search setup

Search requires Ollama running locally with `nomic-embed-text` pulled:

```sh
ollama pull nomic-embed-text
# Ollama defaults to http://localhost:11434
```

Override with environment variables:

```sh
ZTS_EMBED_URL=http://my-server:11434/api/embeddings
ZTS_EMBED_MODEL=nomic-embed-text
ZTS_EMBED_DIM=768
```

If Ollama is unreachable at startup, the server warns but continues — existing
embeddings remain searchable, and `POST /a/<hash>/description` returns 503 until
the service is available.
