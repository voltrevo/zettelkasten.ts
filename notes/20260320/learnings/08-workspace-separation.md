# Workspace separation

## The mistake

The first trial ran agents inside the zts project directory. This was wrong in
several ways:

- Agents had direct filesystem access to the corpus git repo
  (`~/.local/share/zettelkasten/`) and could read or write atom files without
  going through the CLI
- Agents had access to the SQLite DB and could query embeddings and
  relationships directly, bypassing the intended HTTP interface
- Agents could read zts source code and were sometimes confused about whether
  they should modify it
- The goals, agent loop scripts, and prompt documents lived as loose files in
  the workspace — entangled with corpus-building rather than being part of the
  tool itself

The result: no clean boundary between "building the corpus" and "developing
zts." Agents occasionally did things directly (reading corpus files, inspecting
the DB) that should only be done via the CLI.

## The right model

**zts runs on a separate server.** The agent workspace has no visibility into
the corpus filesystem, the SQLite DB, or the zts source code. The only
interfaces are:

- `zts` CLI (preferred)
- HTTP API via `curl` (acceptable fallback, but discouraged — the CLI should
  cover everything an agent needs)

This forces the correct abstraction: the corpus is a service, not a directory.
Agents interact with it as users, not as administrators.

## Loop machinery belongs in zts

The agent loop script, the per-iteration prompt, and the goal tracking system
are features of the zts tool — not loose files the operator maintains
separately. They should ship with zts and be invokable via CLI subcommands. This
makes the agent loop a first-class feature, versioned and distributed with the
tool.

## The agent workspace

The workspace is a lightweight, fully self-contained directory. It has no zts
source code and no corpus files. Everything the agent owns lives here:

```
workspace/
  notes/          ← persistent across iterations; agent's long-term memory
  handovers/      ← current.md / next.md; managed by loop runner
  logs/
  tmp/            ← atom drafts before posting
```

The `handovers/` directory is managed by the loop runner (`zts script worker`):
it promotes `next.md` → `current.md` after each iteration. The agent reads
`handovers/current.md` at start and writes `handovers/next.md` before exit. The
workspace is fully self-contained — no external handover directory needed.

## Notes system

`workspace/notes/` accumulates across iterations, unlike handovers which are
per-iteration state transfers. Notes are for longer-lived observations,
patterns, and decisions that are worth carrying forward but don't belong in the
handover.

### Philosophy

- **Terse and precise.** Written for intelligent agents to read, not for
  external audiences. No selling, no padding.
- **Corpus engagement first.** The point is building atoms, not maintaining
  notes. Notes serve the work; they are not the work.
- **Subjective commentary is fine.** "This approach felt wrong" or "I'm
  suspicious of this atom" are valuable observations. Just keep them brief.
- **Not a log.** Don't record what you did — that's what handovers and git
  history are for. Record what you learned, what surprised you, what to watch
  out for.

### Proposed structure

```
notes/
  current.md        ← rolling focus: what goal, what's live, what to do next
                       if you start fresh and have no handover, read this first
  <topic>.md        ← one file per persistent concern (e.g. tls.md, c32.md)
                       created when a topic accumulates enough to be worth
                       separating; merged back into current.md when resolved
```

`current.md` is the single most important file. It should answer: "if I woke up
with no memory, what would I need to know right now?" Keep it short — a few
paragraphs at most. Prune it when it gets stale.

Topic files are created deliberately, not by default. Most observations belong
in `current.md` or the handover. A topic file earns its existence when the same
concern recurs across multiple iterations.

## Goal tracking

Goal tracking is a zts CLI feature, not a file the operator maintains. See
`proposals/workspace-and-goal-cli.md` for the CLI design. The key conceptual
points:

- Goals are weighted, not ordered. The agent picks a goal probabilistically,
  biased toward higher-weight goals but free to deviate when it sees
  opportunity.
- Done goals are excluded from random selection but remain in the corpus for
  reference. A critic agent can reverse a done marking.
- Per-goal comments are queryable via CLI, removing the need to carry goal
  history in handover docs.
