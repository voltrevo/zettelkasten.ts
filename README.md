# zettelkasten.ts

A Deno server that stores immutable TypeScript atoms in a content-addressed,
SQLite-backed corpus. Each atom is a single TypeScript module with exactly one
value export, identified by a 25-character base36 keccak-256 hash.

The vision: a persistent code knowledge base where AI agents accumulate reusable
implementations over time — preferring to retrieve and reuse existing atoms over
writing new ones.

## Quick start

```sh
# Install the CLI
deno task install

# Create config (generates auth tokens)
zts init

# Start services
zts checker start    # test execution service
zts server start     # main server

# Or run in foreground
zts checker run &
zts server run
```

Optionally, pull an embedding model for semantic search:

```sh
ollama pull nomic-embed-text
```

## Atom lifecycle

Atoms go through a draft → test → publish lifecycle:

```sh
# 1. Draft: upload atom, get hash + HTTP URL
zts draft /tmp/myatom.ts

# 2. Explore: import the draft via HTTP URL in any Deno program
deno run -A /tmp/explore.ts

# 3. Add tests: each test runs immediately against the target
zts add-test /tmp/test.ts --targets <draft-hash>

# 4. Publish: promote draft to permanent atom
zts publish <hash> -d "brief description" -g <goal>
```

Publishing requires:
- All imported atoms are already published
- At least one passing test (test atoms are exempt)
- 100% line and branch coverage across all tests
- Code passes `deno fmt` formatting check (>10% expansion is rejected)
- Description is ASCII only

## Writing atoms

An atom is a single `.ts` file that:

- Exports **exactly one named value** (function, class, const, or enum)
- Imports only other atoms via relative paths: `../../xx/yy/<21chars>.ts`
- Has no `export default`, no `export let`
- Fits within 1024 bytes gzipped after minification
- Type-only exports (`export type`, `export interface`) are unlimited

```typescript
export function gcd(a: number, b: number): number {
  while (b !== 0) {
    const t = b;
    b = a % b;
    a = t;
  }
  return Math.abs(a);
}
```

## Capability convention

Atoms that need external I/O accept a `cap` parameter as their first argument:

```typescript
export type Cap = {
  console: Pick<Console, "log" | "error">;
  Deno: { args: readonly string[] };
};

export function main(cap: Cap): void {
  cap.console.log(cap.Deno.args.join(" "));
}
```

Callers pass `globalThis`. Tests substitute only what they need. If an atom
imports other atoms that export `Cap`, its own `Cap` is the intersection of
theirs plus any additional capabilities it needs directly.

```typescript
export type Cap = {
  fetch: typeof fetch;
  Date: Pick<typeof Date, "now">;
};

export function pollEndpoint(cap: Cap, url: string): Promise<number> {
  return cap.fetch(url).then(() => cap.Date.now());
}
```

## Writing tests

A test atom exports a class named `Test` with a `static name` and a
`run(target)` method:

```typescript
export class Test {
  static name = "gcd: known values";
  run(target: (a: number, b: number) => number): void {
    if (target(48, 18) !== 6) throw new Error("48,18");
    if (target(0, 5) !== 5) throw new Error("0,5");
  }
}
```

For atoms that take a `Cap` parameter, create a mock cap inline:

```typescript
export class Test {
  static name = "main: echoes args";
  run(target: (cap: { console: { log: (s: string) => void }; Deno: { args: readonly string[] } }) => void): void {
    const out: string[] = [];
    target({
      console: { log: (s) => out.push(s) },
      Deno: { args: ["hello", "world"] },
    });
    if (out[0] !== "hello world") throw new Error(out[0]);
  }
}
```

## Atom rules

| Rule | Detail |
|------|--------|
| One value export | Function, class, const, or enum. Named only — `export default` is forbidden. |
| Type exports OK | `export type` and `export interface` don't count toward the limit. |
| Atom-only imports | Only `../../xx/yy/<21chars>.ts` paths. No npm, JSR, URLs, or bare specifiers. |
| No exported `let` | All value exports must be `const`, function, class, or enum. |
| Size limit | ≤ 1024 bytes gzipped after minification. |
| Formatted | Code must pass `deno fmt` — the server formats on ingest and rejects heavily minified code. |

## Development workflow

### 1. Search before you write

```sh
zts search "greatest common divisor"
zts search --code "function gcd"
```

If a match looks right, check for the best version:

```sh
zts tops <hash>
zts get <hash>
```

### 2. Draft and explore

```sh
zts draft /tmp/my-atom.ts
# → <hash>
# → http://localhost:7483/a/xx/yy/rest.ts
```

Explore with real inputs using the HTTP URL:

```sh
cat > /tmp/explore.ts << 'EOF'
import { myFn } from "http://localhost:7483/a/xx/yy/rest.ts";
console.log(myFn(42));
EOF
deno run -A /tmp/explore.ts
```

### 3. Test and publish

```sh
zts add-test /tmp/test.ts --targets <hash>
zts publish <hash> -d "description of what it does" -g <goal>
```

If coverage is insufficient, the publish error shows exactly which lines need
tests. Add more tests with `zts add-test` and try again.

### 4. Execute and bundle

Run an atom that exports `main(cap)`:

```sh
zts exec <hash> arg1 arg2
```

Bundle an atom with all dependencies for offline use:

```sh
zts bundle <hash> -o /tmp/output
deno run --allow-all /tmp/output/<hash8>/run.ts arg1
```

## Storage

All data lives in `~/.local/share/zettelkasten/`:

```
zts.db         ← SQLite: atoms, embeddings, relationships, properties,
                 test_evaluation, test_runs, goals, prompts, log
server.log     ← append-only process log
config.json5   ← auth tokens, ports, URLs (chmod 600)
```

The hash format is 25-char base36 keccak-256. The full hash splits as
`hash[0:2]/hash[2:4]/hash[4:]` for URL paths (2 + 2 + 21 = 25 chars).

## Semantic search

Requires Ollama with `nomic-embed-text`. Configure in `config.json5`:

```json5
{
  embedUrl: "http://localhost:11434/api/embeddings",
  embedModel: "nomic-embed-text",
  embedDim: 768,
}
```

If Ollama is unreachable at startup, the server warns but continues — existing
embeddings remain searchable, and description updates return 503 until
available.

## CLI reference

Run `zts -h` for the full command list. Key commands:

```
zts draft <file>                 upload atom as draft
zts add-test <file> --targets h  add test, run immediately
zts publish <hash> -d <desc>     promote draft (requires tests + coverage)
zts search <query>               semantic search
zts search --code <query>        full-text source search
zts exec <hash> [args]           run atom's main(globalThis)
zts info <hash>                  source, description, relationships
zts tops <hash>                  navigate supersedes chain to best version
zts recent [-n N] [--goal G]     recent published atoms
zts status                       corpus health summary
```

Hash prefixes work everywhere (e.g. `zts info 3ax9`).

## Auth

Bearer tokens in `config.json5` (created by `zts init`), three tiers:

- **unauthed** — reads (get, list, search, info)
- **dev** — writes (draft, publish, describe, test, relate)
- **admin** — goal CRUD, starred property, prompt overrides

## Docker

A full Docker setup runs the server, checker, agent, Ollama, and a squid proxy:

```sh
cd docker
docker compose up -d
```

See [docker/README.md](docker/README.md) for details.

## Agent loop

The `zts worker` command runs an autonomous agent that picks goals and builds
atoms:

```sh
zts worker setup        # create workspace
zts worker run          # start the agent loop
```

The agent prompt is in `src/worker-prompt.md`. Goals are managed via `zts goal`
commands.

## Development

```sh
deno task test              # unit tests
deno task test:integration  # integration tests
deno task test:all          # both
deno task ui:dev            # Vite dev server for web UI
deno task precommit         # fmt + typecheck + test + lint + ui build
```

## Architecture

| File | Purpose |
|------|---------|
| `src/server.ts` | HTTP server: routes, atom storage, search, auth |
| `src/checker.ts` | Test checker: sandboxed test execution, coverage, lint, fmt |
| `src/db.ts` | SQLite wrapper: all tables, schema migrations |
| `src/api-client.ts` | Typed API client shared by CLI and web UI |
| `src/worker.ts` | Agent loop: workspace management, claude subprocess |
| `src/worker-prompt.md` | Agent prompt with walkthrough example |
| `src/validate.ts` | Atom validation: export count, import paths, size limit |
| `src/minify.ts` | Comment stripping + whitespace collapse for size check |
| `src/embed.ts` | Embedding API client (Ollama), cosine similarity |
| `main.ts` | CLI entry point: all subcommands |
| `ui/` | Vite + TypeScript web UI |
