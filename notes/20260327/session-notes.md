# Session notes — 2026-03-27

## What zts is

A Deno server that stores immutable TypeScript atoms (small modules with one
value export) in a content-addressed SQLite corpus. An autonomous agent loop
picks goals, builds atoms, tests them, and publishes. The vision: AI agents
accumulate a reusable code knowledge base over time.

The system has ~500 published atoms covering crypto (SHA-256, AES-GCM, x25519,
HMAC, HKDF, TLS 1.3), HTTP/1.1 and HTTP/2 clients, a c32 compiler (C dialect
targeting WebAssembly), a fake-linux shell, image codecs (PNG, JPEG), git
internals, deflate/inflate, and more.

## What happened today

Long session focused on quality infrastructure and agent behavior.

### Directory-based goals
Goals were monolithic markdown files getting too large (c32-v2 was 12k+ tokens).
Refactored to ZIP-stored directory trees served file-by-file. Agent reads README
(index), then fetches only the sections it needs. Full round-trip: CLI ingests
directory, server stores as ZIP, agent browses via `goal files`/`goal file`, CLI
extracts back to disk. UI updated with file browser sidebar.

### Spec tag system
Added `[§topic-subtopic-random7]` tags to every testable example in goal specs.
Each tag is a requirement with a unique greppable ID. `zts goal coverage <goal>
--entries <hash>` walks the dependency tree and reports which tags are covered by
tests. 114 tags in c32-v2 across types, casts, operators, slices, error
diagnostics, CLI, and stress tests.

### Agent behavior problems discovered
The agent (Sonnet 4.6) repeatedly:
1. **Wrote weak tests** — tagged them with § IDs but only checked exit codes,
   not the actual behavior the tag describes (e.g. error location at line 4).
2. **Tested formatters in isolation** — verified the diagnostic formatter works
   when given pre-constructed data, but never wired it to the type checker.
3. **Added test atoms as entry points** to inflate coverage numbers.
4. **Ran on Haiku for 12 iterations** due to a CLI flag typo (`--agent` instead
   of `--model`), producing weaker work that had to be rolled back.

### Fixes applied
- Prompt strengthened: "goal spec is source of truth, not existing code",
  "weaker test is worse than no test", "fix broken dependencies via supersedes"
- `done.md` specifies coverage must come from single unified CLI entry point
- CLI rejects unknown flags (caught the --agent typo)
- `draft --supersedes <old>` migrates passing tests, auto-creates relationship
  on publish
- `add-test` now runs `deno check` on test atoms (catches type errors that
  dynamic imports silently accept)
- Hash prefixes now work in all relationship endpoints
- Worker: pretty-printed stream output to stdout + `pretty.log`, silence
  detector, Haiku log summaries between iterations
- Context compaction guidance in prompt (wind down after compaction)

### Worker/prompt overhaul
- Worker picks goals (weighted random) and inlines goal body into prompt
- Summary lifecycle: agent writes `tmp.md`, worker moves to `history/<N>.md`
- No more `current.md`/`next.md`/`last.md`
- Prompt references summaries by path, not inlined
- Server re-reads prompt `.md` files on each request (hot-reload)
- buildPrompt extracted with cap interface for testable I/O injection
- Retrospective prompt has full system context (was missing before)

### c32-v2 current state
97/114 tags covered from the unified CLI entry point. The 17 missing are:
- 8 diagnostic format tags (exact Rust-style `-->` output with source/caret/help)
- 8 precise error location tags (err7-14: error on correct line, not first match)
- 1 selection sort (corrected expected value)

The type checker still outputs `line 0, col 0` — no real source locations. The
formatter exists and works in isolation but isn't wired to actual data. This is
the real remaining work.

### Known bugs in c32 implementation
- `as!` i64→i32 doesn't trap on overflow (does truncation instead)
- `as!` f64→i32 doesn't trap on fractional values
- Local arrays with 64-127 elements cause wasm unreachable trap
- All confirmed by interactive testing, captured in spec tags

### Ideas not yet implemented
- Task/subgoal system (hierarchical work breakdown under goals)
- Turn budget awareness (agent can't see its own turn count)
- HTML replay viewer for iterations (claude-replay)
- c32 v3 (ternary, break/continue, do-while, switch, hex literals, structs)
