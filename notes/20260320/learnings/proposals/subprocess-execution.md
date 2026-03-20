# Proposal: subprocess execution boundary

## The problem

If the CLI imports and evaluates atom code inside its own Deno context, the atom
inherits the CLI's permissions — whatever `--allow-*` flags the CLI was started
with. A buggy or malicious atom could escalate to those privileges. The server
is worse: a Deno HTTP server handling arbitrary requests should never evaluate
corpus code at all.

## The rule

**The server never executes corpus code.** It stores, validates, retrieves,
searches, and manages relationships. No atom import, no eval, no dynamic
execution of any kind happens inside the server process.

**The CLI never evaluates corpus code inside its own Deno context.** Any
operation that runs an atom — `zts exec`, `zts test`, the test gate in `POST /a`
— spawns a fresh Deno subprocess. The CLI process orchestrates (fetch hash,
build command, wait for exit) but does not import the atom.

---

## `zts exec` subprocess model

```
CLI process (minimal perms)
  │
  │  fetches atom path from server (HTTP)
  │  spawns subprocess with inherited stdio
  ▼
Deno subprocess
  deno run \
    --allow-import=<server-origin> \
    [--allow-net] [--allow-read] [--allow-write] [--allow-env] \
    run.ts <hash> [args...]
```

`run.ts` is the universal exec entry point (already exists). It imports the atom
from the server via its content-addressed URL and calls `main(globalThis)`.

### stdio inheritance

The subprocess is spawned with `stdin`, `stdout`, and `stderr` all set to
`"inherit"`. The atom's I/O goes directly to the terminal — not piped through
the CLI. This means:

- TTY detection works correctly inside the atom
- Signals (Ctrl-C) reach the subprocess directly
- Piped output (`zts exec <hash> | jq`) works as expected
- Interactive atoms (prompts, readline) work naturally

The CLI waits for the subprocess to exit and forwards its exit code.

### Permissions

`--allow-import=<server-origin>` is always granted (needed to import the atom
and its transitive dependencies from the server).

Additional permissions are granted based on the atom's declared `Cap` where
statically determinable, or via explicit flags passed by the caller:

```sh
zts exec <hash>                         # import only
zts exec --allow-net <hash>             # + network
zts exec --allow-read=/tmp <hash>       # + scoped read
```

No permissions beyond those listed are granted to the subprocess. The CLI itself
does not need `--allow-read`, `--allow-write`, or `--allow-net` beyond the
single HTTP connection to the zts server.

---

## `zts test` subprocess model

Already uses a subprocess (`test-runner.ts`). The existing model is correct:

```
deno test \
  --allow-import=<server-origin> \
  test-runner.ts <test-hash> <target-hash>
```

This subprocess gets `--allow-import` only — no network, no filesystem. Tests
are pure in-process assertions against the imported atom. The boundary is
already enforced here; the proposal is to document it explicitly and ensure
`zts exec` follows the same pattern.

---

## Test gate in `POST /a`

The server receives a `POST /a` with `X-Require-Tests: <hash1>,<hash2>`. It must
run those tests before committing. But the server cannot execute atom code.

**Resolution:** the server delegates test execution to the CLI subprocess. When
the server needs to run tests, it calls back to a local test-runner process, or
— more cleanly — the CLI runs tests itself before posting:

The `zts post -t` command:

1. Client-side: CLI spawns test subprocesses for each test hash against the atom
   being posted (running the atom from a temp file, not yet in corpus)
2. If all pass: CLI posts to server with `X-Require-Tests` header
3. Server re-runs tests as a final verification before committing (using the
   same subprocess delegation mechanism)

The server's test execution path: it has a configured local command it can
invoke (e.g., `deno run --allow-import test-runner.ts`) with the subprocess
result captured (pass/fail + output). The server process itself never imports or
evaluates the atom.

---

## Auth and execution

`zts exec` is available to dev-tier callers and above. Since exec fetches the
atom over HTTP (unauthed GET) and runs it locally, the auth check is on the CLI
side: the CLI must hold a dev token to use exec (preventing anonymous callers
from trivially using the server as a code delivery mechanism for unauthenticated
execution).

Unauthed callers cannot use `zts exec`. They can retrieve atom source with
`zts get` and run it manually.

---

## Summary of boundaries

| Component                   | Can execute corpus code?                 |
| --------------------------- | ---------------------------------------- |
| zts server                  | No — never                               |
| zts CLI process             | No — never imports atoms                 |
| `run.ts` subprocess         | Yes — this is the only execution context |
| `test-runner.ts` subprocess | Yes — isolated, import-only permissions  |
