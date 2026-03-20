# zts Learnings

Distilled from extended corpus-building activity in an isolated container: ~350
agent iterations across two channels (bricklane, starling), plus direct
experimentation and review. The base project is at commit `f261e9d`.

This is a diagnosis, not a feature spec. Each section describes what was
observed and why it matters. Proposed solutions and implementation ideas are in
`proposals/`.

---

## The big picture

The core concept — a content-addressed corpus of immutable atoms that an AI
agent accumulates and reuses across sessions — works. Atoms genuinely compound.
The test-gate-on-POST is elegant. Forced decomposition improves design.

The limiting factor is not atom quality. It is **the system around the atoms**:
how agents find what exists, how they signal that something is broken, how much
of their context window is consumed managing corpus state rather than building,
and whether the tooling makes the right thing the easy thing.

---

## Sections

| File                                                     | Theme                                                                                      |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [01-discoverability.md](01-discoverability.md)           | The corpus is effectively write-only without browse                                        |
| [02-size-limit.md](02-size-limit.md)                     | The 768B gzip limit: good pressure, real harm at the margin                                |
| [03-test-workflow.md](03-test-workflow.md)               | The `-t` gate and the "post without -t, then curl" anti-pattern                            |
| [04-corpus-health.md](04-corpus-health.md)               | Broken atoms, BROKEN: prefix, the missing negative evidence layer                          |
| [05-agent-loop.md](05-agent-loop.md)                     | Handover format, context cost, iteration tracking, versioning                              |
| [06-goal-tracking.md](06-goal-tracking.md)               | Goals system, completed tracking, per-goal comments                                        |
| [07-cli-gaps.md](07-cli-gaps.md)                         | Commands that require raw curl today                                                       |
| [08-workspace-separation.md](08-workspace-separation.md) | Agents must not run in the zts project dir; separation, workspace layout, notes philosophy |

Proposals (implementation ideas, more prescriptive):

| File                                                                         | Theme                                                                                                                                                                 |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [proposals/failing-tests.md](proposals/failing-tests.md)                     | `kind=fails` — SUPERSEDED by `proposals/testing-model.md`                                                                                                             |
| [proposals/testing-model.md](proposals/testing-model.md)                     | Three-layer testing model: applicability (relationships) → meaning (evaluation metadata) → history (test runs); checker authority; `violates_intent` vs `falls_short` |
| [proposals/cli-additions.md](proposals/cli-additions.md)                     | Specific CLI commands to add                                                                                                                                          |
| [proposals/agent-loop-improvements.md](proposals/agent-loop-improvements.md) | Handover format and loop mechanics                                                                                                                                    |
| [proposals/workspace-and-goal-cli.md](proposals/workspace-and-goal-cli.md)   | `zts script`, `zts goal pick/done/comment`, workspace layout                                                                                                          |
| [proposals/agent-loop-runner.md](proposals/agent-loop-runner.md)             | `zts script worker/context/iteration`: the `claude` CLI invocation, stream-json capture, handover lifecycle, channel isolation                                        |
| [proposals/auth.md](proposals/auth.md)                                       | Bearer token auth: unauthenticated reads, dev token for corpus writes, admin token for goal management                                                                |
| [proposals/subprocess-execution.md](proposals/subprocess-execution.md)       | Server never executes corpus code; CLI never imports atoms; all execution in Deno subprocesses with inherited stdio                                                   |
| [proposals/docker.md](proposals/docker.md)                                   | Four-container Docker design: gateway, zts-server, checker (test verifier), agent sandbox                                                                             |
| [proposals/supersedes.md](proposals/supersedes.md)                           | `kind=supersedes` relationship, `zts tops` navigation, auto-registration from test evidence                                                                           |

Reference material:

| Path                                                   | Contents                                                                                                                                                   |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [reference/claude-sandbox/](reference/claude-sandbox/) | Working two-container Claude Code sandbox (Squid gateway + Ubuntu sandbox). Basis for the agent container design. See its ISSUES.md for pitfalls to avoid. |

---

## Architectural direction for the development agent

Two decisions that cut across all proposals:

**SQLite-first.** All server-managed state (atoms metadata, relationships,
embeddings, goals, goal comments) lives in `zts.db`. The git-backed atom files
remain as-is (content-addressed corpus). Goals in particular are
installation-local — they belong to the running zts instance, not the source
repo.

**Scripts and prompts ship with the tool.** The agent loop runner, the
per-iteration prompt, and the system context are compiled into the `zts` binary
and emitted via `zts script worker/context/iteration`. There are no loose
orchestration files the operator maintains separately.

**Admin/agent separation.** `zts goal` commands are available to agents (pick,
show, list, comment, done, undone). Goal management (create, modify body/weight,
delete) is `zts admin goal` — operator-only. This pattern may extend to other
subcommands as needed.

**Migration is unspecified.** The proposals introduce new SQLite tables (goals,
goal_comments), auth token enforcement, and a checker container. How these
changes are applied to an existing installation — schema migrations, token
rollout, existing `scripts/agent-loop.sh` compatibility — is left to the
implementing agent to design. The constraint: corpus-building agent loops are
running continuously and must not be broken by server-side changes.

---

## The single most important observation

> The bottleneck is no longer writing code. It is finding the right atom.

Search works when you know what vocabulary to use. After hundreds of iterations
the corpus contains atoms an agent would want — but can't discover because the
descriptions don't quite match the query, or because the agent doesn't know to
look. The result: atoms are rebuilt, broken variants accumulate, and the
compounding value that zts promises is only partially realized.

Everything else in this document is secondary to solving discoverability.
