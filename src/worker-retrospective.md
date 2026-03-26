# Retrospective

You are reviewing the recent work of an autonomous agent loop that builds a
corpus of tested, reusable TypeScript atoms.

## System overview

**zettelkasten.ts** is a Deno server that stores immutable TypeScript atoms in a
content-addressed, SQLite-backed corpus. Each atom is a single TypeScript module
with exactly one value export, identified by a 25-character base36 keccak-256
hash.

**Atoms** are small, tested, immutable. They can only import other atoms (via
relative hash paths like `../../1k/1b/ks5opabqf39499ludtcni.ts`). No npm, no
URLs, no bare specifiers. Max 768 tokens. Atoms that need external capabilities
(I/O, randomness, fetch) accept them as an explicit `cap` parameter.

**Tests** are also atoms. A test atom exports a `Test` class with a
`run(target)` method. Every non-test atom must have at least one passing test
before it can be published. Tests run in a sandboxed subprocess.

**Goals** define what the agent should build. Each goal has a name, weight (for
random selection), and a body describing what to build and how to verify it.
Some goals are directory-based with multiple linked markdown files — the agent
uses `zts goal files <name>` and `zts goal file <name> <path>` to navigate
these.

**The agent loop** picks a goal each iteration, assembles a prompt with the goal
body inlined, and spawns a Claude agent. The agent builds one well-tested atom
per iteration (or nothing if it can't make confident progress). After each
iteration the agent writes a summary to `summary/tmp.md`, which the worker moves
to `summary/history/<iter>.md`.

**Relationships** between atoms: `imports` (dependency), `tests` (test covers
target), `supersedes` (newer version of an older atom). `zts tops <hash>` walks
the supersedes chain to find the current best version.

## Key CLI commands for your review

```
zts goal list --all              # all goals with done/active status
zts goal show <name>             # goal body + comments
zts goal comments <name>         # agent observations on a goal
zts recent [-n N] [--goal G]     # recently published atoms
zts status                       # corpus health: total atoms, defects, etc.
zts info <hash>                  # atom details: imports, tests, dependents
zts search <query>               # semantic search on descriptions
zts log [--recent N]             # audit log of operations
```

Use these to independently verify claims in summaries and to understand the
current state of the corpus and goals.

## What to review

This is a retrospective iteration. Instead of building atoms, reflect on the
last 30 iterations.

The recent summary history and any previous retrospectives are included below in
this prompt. You may also read files from the workspace and use zts CLI commands
for additional context.

Write a retrospective file to the path specified below
(retrospectives/retro-NNNN.md). The retrospective should cover:

## Wins

The most significant atoms, goals, or capabilities added. What compounded? What
unlocked further work?

## Friction

Recurring problems, tooling gaps, workflow pain points. What slowed the agent
down or caused rework? Be specific — name the commands, error messages, or
patterns that caused trouble.

## Suggestions

Concrete improvements to zts (CLI, server, validation, search) or to the agent
workflow (summary format, goal structure, testing patterns). Prioritize by
impact.

## Observations

Anything else worth noting: patterns in the corpus, surprising discoveries,
quality trends, or meta-observations about the process.

Be terse and precise. This is written for the operator and for future agents. Do
not build atoms in this iteration.

---

{{retrospective-context}}
