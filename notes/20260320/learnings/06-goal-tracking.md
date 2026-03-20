# Goal tracking

## What was observed

The `samples/goals.md` system provided orientation across sessions and channels.
Agents could read a goal, understand its subatom decomposition, and know where
to start. This worked well.

What was missing:

### No authoritative "what is done" record

Agents declared goals "done" in handovers and conversation, but there was no
canonical place to record this with verified exec examples. The result: goal
completion status lived in handover prose and could not be confirmed without
re-running the relevant atoms.

A `goals-completed.md` file with verified exec commands was introduced here to
fill this gap. It separates "agent said it's done" from "we ran it and it
works."

### No per-goal notes across iterations

When an agent hit a subtle bug in a goal's implementation, the observation
lived in one handover and was not available to the next agent working on that
goal. The next agent would rediscover the same issue.

A `goals/<N>/comments.md` file (append-only, timestamped) was introduced to
accumulate observations per goal. Examples of what belongs there:

- Bugs found and their root cause
- Correctness observations from interactive testing
- Gaps in a "complete" goal (e.g., the HTTP/2 framing layer works but TLS
  integration is broken — both facts belong in goals/14/comments.md)
- Recommended next atoms

### Goal descriptions don't track partial completion

A goal like "HTTP/2 client" has a binary done/not-done status in goals.md.
In practice, completion is gradual: the framing layer (h2c) works; the TLS
integration is broken; HPACK encoding is correct but Huffman decoding has
a known bug. The goal description should acknowledge this granularity.

### Goals need clarification over time

Some goals were underspecified and caused confusion:
- "HTTP/2 client" was interpreted as "framing layer only" by one agent, "full
  HTTPS/2 including TLS" by another. The goal should be explicit about whether
  TLS integration is in scope.
- "Pure-TS SSH client" needed clarification about whether Web Crypto was
  allowed at all.

The goal file should be a living document, updated as subgoals complete and
as the scope becomes clearer through implementation experience.

### Smaller-scope ideas

`samples/wishlist.md` and `samples/ideas.md` serve a different purpose than
`samples/goals.md` — they list smaller, more self-contained ideas that don't
need their own goal entry but are worth building. These feed into the agent
loop as "if you have spare capacity or need a leaf atom" suggestions.

These files exist and work, but aren't linked from `goals.md` or the agent
guide clearly. Agents sometimes missed them and either rebuilt things or
didn't find good leaf ideas.

## What good looks like

A three-tier structure:

1. `goals.md` — the goals with subatom decomposition, updated as scope
   clarifies
2. `goals-completed.md` — verified, executable entries for done goals,
   with specific atom hashes and tested commands
3. `goals/<N>/comments.md` — append-only, timestamped observations per
   goal across all sessions

This structure gives agents at different stages of a goal a clear picture:
what the goal is (goals.md), whether it's been reached (goals-completed.md),
and what was learned along the way (comments.md).
