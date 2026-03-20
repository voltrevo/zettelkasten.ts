# Agent loop

## What was observed

The agent loop (one iteration per Claude invocation, handover doc as the state
carrier) worked well for carrying technical state across context boundaries.
The format — goal in progress, atoms built, needs stack, notes — was followed
consistently and gave clear continuation points.

Several systemic issues emerged across hundreds of iterations.

### Handover format is not enforced

Two iterations across the two channels produced no handover-out.md. In one
case this was explicitly noted by the next iteration: "NOTE: the previous
iteration also ran but did not write a handover; it built parseTlsCvMsg,
tls13CertVerify, and readTlsRecord. Picking up from there." The agent
reconstructed state from the corpus itself, which worked — but only because
the previous agent had described its atoms. Without descriptions, lost
iterations are unrecoverable.

### Inventory tables consume context

As the corpus grows, agents maintain a "what already exists" section in their
handovers to give incoming agents a map. By bricklane iteration ~150, the SVG
atom inventory alone listed 30+ entries with version numbers. This information
has to be re-read and re-internalized by every incoming agent, burning context
window that could be used for building.

The root cause is the lack of a `/list` or browse endpoint — agents maintain
the inventory manually because the system doesn't provide it.

### Iteration numbering drifts

The file system uses per-run iteration folders (`iter-0001`, `iter-0002`, ...),
but the agent's internal counter may not reset between runs. Bricklane's
handovers show "iteration 38" inside the `iter-0109` folder — the agent was
counting from some earlier baseline. This makes cross-referencing handovers
("see iteration 38") unreliable without knowing which run's numbering scheme
the author used.

### Version lineage in handovers grows unwieldy

Atoms are versioned by posting new atoms (V1, V2, V3...). As a goal evolves,
the handover must track which version is canonical. The Markdown pipeline
in the starling channel went through 20+ top-level atoms, and by iteration
N+14 the notes listed 15 entries in the family tree. This is hard for an
incoming agent to parse quickly.

### The needs stack works

The TDD loop and needs-stack pattern (write deepest unbuilt dep first, work
upward) was followed consistently and worked well for dependency trees. Agents
never expressed confusion about depth-first ordering. The pattern should be
preserved and emphasized.

### The TDD loop itself is sound

From final thoughts across multiple sessions:

> "Writing test atoms before implementation atoms is natural for an agent —
> tests encode the spec in a form the system can verify, and the conditional
> POST makes 'did this work?' a yes/no question rather than a judgment call.
> The feedback loop is tight."

The issue is not the loop itself but the tooling friction around it (the `-t`
gate issues described in `03-test-workflow.md`).

### Context-loading at loop start

The `samples/agent-loop.md` guide instructs agents to read several files at the
start of each loop: `CLAUDE.md`, `samples/ambitious-ideas.md`, `TOP_10.md`,
`TOP_10_v2.md`, `IMPRESSIVE_EXAMPLES.md`, `samples/wishlist.md`,
`samples/ideas.md`. This reading list grew as context files were added.

The intent is good — orient the agent before it acts — but the list has
costs:
- Each file burns context window on information the agent may not need this
  iteration
- The files themselves grow over time (TOP_10_v2.md adds to TOP_10.md, not
  replacing it)
- The reading happens before the agent knows which goal it will pursue, so
  much of it is wasted

A better model: the agent reads its handover (which is goal-specific), then
reads only what that goal requires. The loop-start reading list should be
minimal; goal-specific context should come from `goals/<N>/comments.md`.

### Small, recurrent gotchas that every agent rediscovers

These were noted in LEARNINGS.md and recurred in handovers:

- **ASCII-only commit messages and descriptions.** Unicode characters (including
  arrows like `→` or Greek letters) cause ByteString errors in HTTP headers.
  This was rediscovered in at least 6 different iterations across both channels.
  It should be documented and ideally rejected client-side with a clear error.

- **`zts describe` must be called after post.** Skipping it causes 422 on
  subsequent dependent posts. Easy to forget; should be part of the post
  confirmation output.

- **TypeScript type annotations count toward gzip budget.** The minifier
  does not strip them. Counterintuitive and repeatedly rediscovered.

- **`127.0.0.1` not `localhost` for TCP.** Deno resolves `localhost` to IPv6
  (`::1`) in this environment. Any exec atom using `Deno.connect` must use
  the literal IP.

- **`export` keyword required for `zts exec` to find a function by name.**
  The wasm executor and the run.ts harness both look up exports by name.
  Functions without `export` are not callable. Agents discovered this by
  getting "export not found" errors.

### What the handover format does well

- The "needs stack" section provides clean continuation state
- The "built this iteration" section gives incoming agents an audit trail
- Free-text notes allow contextual warnings ("watch for the 768B limit on
  this subtree", "don't use X — it has the Y bug")
- The format is simple enough that agents follow it consistently

The format should be preserved. The improvements are tooling around it, not
changes to the format itself.
