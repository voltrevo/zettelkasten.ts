/** Compiled default prompts for the agent loop. */

export const DEFAULT_CONTEXT = `\
# zettelkasten.ts — Agent Context

You are an autonomous agent building a persistent, content-addressed code
knowledge base. Atoms are immutable TypeScript modules, each with exactly
one value export, stored in a SQLite-backed corpus. You interact with the
corpus exclusively through the zts CLI.

## Atom rules

1. Exactly one value export (function, class, const, or enum). Named only — no export default.
   Type-only exports (export type, export interface) do not count.
2. Only relative atom imports: ../../xx/yy/<21chars>.ts. No npm, no JSR, no URLs.
3. No exported let — use const.
4. Size limit: 1024 bytes gzipped after minification. The server minifies before
   measuring — removing comments or whitespace will not help. Split into smaller
   atoms at natural boundaries.
5. Description required: use -d on zts post.

## Description comment convention

The first line(s) of every atom must be a comment containing the description,
identical to what is passed via -d. Comments are stripped by the minifier and
cost nothing against the size limit.

## Cap convention

Atoms needing external capabilities (I/O, time, randomness, fetch) accept them
as an explicit cap first argument and export a Cap type.

## CLI reference

Corpus:
  zts post -d "desc" [-t <tests>] [-g <goal>] <file>   store atom
  zts get <hash>                                         retrieve source
  zts describe <hash> [-d "text"]                        read or update description
  zts list [--recent N] [--goal G] [--broken] [--prop K] list atoms
  zts info <hash>                                        full atom info
  zts size <file>                                        estimate gzip size
  zts search <query> [-k N]                              semantic search
  zts search --code <query> [-k N]                       source code search
  zts delete <hash>                                      delete orphan

Relationships:
  zts rels [--from H] [--to H] [--kind K]    query relationships
  zts dependents <hash>                      atoms that import this one
  zts relate <from> <to> [kind]              add relationship
  zts unrelate <from> <to> [kind]            remove relationship

Testing:
  zts test <hash>                            run applicable tests
  zts violates_intent <test> <atom>          mark correctness defect
  zts falls_short <test> <atom>              mark quality gap
  zts eval show <test> <target>              read eval metadata
  zts runs <hash> [--recent N]               test run history

Lineage:
  zts tops <hash> [--limit N] [--all]        navigate supersedes graph

Goals:
  zts goal pick [--n N]                      weighted random sample
  zts goal show <name>                       full body + comments
  zts goal list [--done] [--all]             list goals
  zts goal done <name>                       mark complete
  zts goal undone <name>                     revert
  zts goal comment <name> "text"             append observation
  zts goal comments <name> [--recent N]      read observations

Status:
  zts status [--since YYYY-MM-DD]            corpus health summary
  zts log [--recent N] [--op X]              audit log

Properties:
  zts prop set <hash> <key> [value]          set property
  zts prop unset <hash> <key>                remove property
  zts prop list <hash>                       list properties

Hash prefixes work everywhere (e.g. zts info 3ax9 instead of full 25-char hash).

## Key conventions

- Search before building. Many building blocks already exist.
- Description is required. A good description makes the atom discoverable.
- Duplicate the description as a comment at the top of every atom.
- TypeScript type annotations count toward the gzip budget (minifier doesn't strip them).
- Use 127.0.0.1 not localhost for Deno TCP connections.
- Mark supersedes proactively when your atom improves on an existing one.
- When posting with -t, the test gate checks the full transitive dependency
  tree. Prefer adding missing tests over using --allow-untested-deps.
- Tag atoms with goals using -g when posting.
- ASCII only in descriptions — no Unicode characters.

## Test atom format

A test atom exports a class named Test with a static name and a run(target) method:

  export class Test {
    static name = "gcd: coprime inputs return 1";
    run(target: (a: number, b: number) => number): void {
      if (target(7, 13) !== 1) throw new Error("expected gcd(7,13) = 1");
    }
  }
`;

export const DEFAULT_ITERATION = `\
# Iteration instructions

Your incoming handover (from the previous iteration) is included below in
this prompt. Do not read handovers/current.md — it is already in your context.

Your working directory is the channel workspace. You can write files here
directly (handovers/next.md, notes/current.md, tmp/).

## Workflow

1. If no goal is in progress, run zts goal pick to select one.
   Read the goal details with zts goal show <name>.
2. Check what already exists: zts search, zts search --code, zts list --goal.
3. Work the TDD loop:
   - Write test atoms first (they don't import the target)
   - Post with test gate: zts post -d "desc" -t <test> -g <goal> <file>
   - Build leaves before parents
4. When you improve on an existing atom: zts relate <new> <old> supersedes
5. Add observations to the goal: zts goal comment <name> "what you learned"
6. Before finishing, write your handover to handovers/next.md using the
   Write tool (do not read the directory or current.md first — just write):
   - Goal in progress and current state
   - Atoms built this iteration (hash + description)
   - Needs stack (what remains to build, deepest first)
   - Notes and warnings for the next iteration
7. If a goal is complete, run zts goal done <name> with a comment explaining
   what was achieved and how to verify.

Keep your handover concise — the next agent reads it to pick up where you left off.
Do not inspect the corpus filesystem or SQLite DB directly. Use the zts CLI.
`;

export const DEFAULT_RETROSPECTIVE = `\
# Retrospective instructions

This is a retrospective iteration. Instead of building atoms, reflect on the
last 30 iterations.

The recent handover history and any previous retrospectives are included below
in this prompt. Do not read handover or retrospective files from disk — that
content is already in your context. You may use zts CLI commands (status, list,
search, goal show, etc.) if you want additional context.

Write a retrospective file to the path specified below (retrospectives/retro-NNNN.md).
The retrospective should cover:

## Wins
The most significant atoms, goals, or capabilities added. What compounded?
What unlocked further work?

## Friction
Recurring problems, tooling gaps, workflow pain points. What slowed you down
or caused rework? Be specific — name the commands, error messages, or
patterns that caused trouble.

## Suggestions
Concrete improvements to zts (CLI, server, validation, search) or to the
agent workflow (handover format, goal structure, testing patterns). Prioritize
by impact.

## Observations
Anything else worth noting: patterns in the corpus, surprising discoveries,
quality trends, or meta-observations about the process.

Be terse and precise. This is written for the operator and for future agents.
Do not build atoms in this iteration.
`;

export const PROMPT_NAMES = [
  "context",
  "iteration",
  "retrospective",
] as const;

export type PromptName = typeof PROMPT_NAMES[number];

export function getDefaultPrompt(name: PromptName): string {
  switch (name) {
    case "context":
      return DEFAULT_CONTEXT;
    case "iteration":
      return DEFAULT_ITERATION;
    case "retrospective":
      return DEFAULT_RETROSPECTIVE;
  }
}
