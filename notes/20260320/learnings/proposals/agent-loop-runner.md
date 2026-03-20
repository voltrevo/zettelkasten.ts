# Proposal: agent loop runner (`zts script worker`)

## What the current implementation does

The agent loop lives in `scripts/agent-loop.sh` (outside the learnings dir;
documented here so the learnings are self-contained). Key facts:

**Invocation mechanism:** `claude` CLI, non-interactive mode:

```sh
claude \
  --dangerously-skip-permissions \
  --max-turns 100 \
  --output-format stream-json \
  --verbose \
  -p "$(cat agent-context.md && printf '\n\n---\n\n' && cat agent-iteration.md)"
```

The prompt is two files concatenated: a static system context
(`agent-context.md`) followed by the per-iteration instructions
(`agent-iteration.md`). The agent reads its handover as a Bash tool call
inside the session — the loop passes `$ZTS_CHANNEL` and `$ZTS_HANDOVER_DIR`
as environment variables so the agent knows where to find it.

**Handover lifecycle:**

```
Before iteration:
  handovers/current.md     ← agent reads this via Bash tool
  (next.md removed)        ← deleted by runner to detect whether agent wrote one

After iteration:
  if next.md was written:
    next.md → current.md   ← promoted (next.md deleted)
    current.md archived to handovers/history/<N>-<timestamp>.md
  else:
    current.md kept         ← runner logs WARNING
```

**Channel isolation:** multiple loops can run in parallel under separate
channels. Each channel has its own `agent/<channel>/handovers/` and
`agent/<channel>/runs/` directories under the zts data dir. The agent
receives `$ZTS_CHANNEL` and `$ZTS_HANDOVER_DIR` so it knows which set
of files to read and write.

**Output capture:** stream-json is tee'd to `iter-NNNN/stream.jsonl`
while a `jq` pipeline extracts readable text (tool calls, thinking
excerpts, assistant text) to stdout, which `script` captures to
`iter-NNNN/terminal.log`. This gives both structured and human-readable
records of each iteration.

**Backoff on error:** if the `claude` process exits non-zero, the runner
waits 30 seconds before starting the next iteration, to avoid hammering on
hard failures.

---

## How `zts script worker` should implement this

`zts script worker` replaces `scripts/agent-loop.sh`. It outputs a shell
script to stdout, which the operator pipes to bash:

```sh
zts script worker | bash
zts script worker --channel bricklane | bash
zts script worker --channel bricklane --max-turns 80 | bash
```

The emitted script is readable and inspectable before execution. The
operator can redirect it to a file and audit it:

```sh
zts script worker > worker.sh
cat worker.sh   # inspect
bash worker.sh  # run
```

### Arguments

```
--channel <name>    agent channel name; must be [a-zA-Z0-9_-]+; default: "default"
--max-turns <n>     max claude turns per iteration; default: 100
--once              run exactly one iteration and exit (useful for testing)
```

### What the emitted script does

1. Resolves the data dir from `$XDG_DATA_HOME` or `~/.local/share/zettelkasten`
2. Creates `agent/<channel>/handovers/history/` and `agent/<channel>/runs/<run-id>/`
3. Initialises `handovers/current.md` if this is the first run ever
4. Enters the iteration loop (or runs once if `--once`)

Inside each iteration:

1. Snapshots `current.md` to `iter-NNNN/handover-in.md`
2. Removes `next.md` to detect whether the agent writes it
3. Writes `iter-NNNN/wrapper.sh` with the `claude` invocation
4. Runs the wrapper under `script -q -e -f -c` to capture terminal output
5. After exit: archives `current.md`, promotes `next.md` → `current.md`
   (or logs WARNING if `next.md` absent), backs off 30s on non-zero exit

### The `claude` invocation

```sh
claude \
  --dangerously-skip-permissions \
  --max-turns "$MAX_TURNS" \
  --output-format stream-json \
  --verbose \
  -p "$(zts script context && printf '\n\n---\n\n' && zts script iteration)"
```

The context and iteration prompts are emitted by two sub-commands (see below)
rather than read from files at a path that callers must maintain. The
`stream-json` output is tee'd to `iter-NNNN/stream.jsonl` and piped through
a `jq` formatter to produce `iter-NNNN/terminal.log`.

### `zts script context` and `zts script iteration`

Two additional sub-commands emit the prompt fragments:

```sh
zts script context    # emits agent-context.md equivalent to stdout
zts script iteration  # emits agent-iteration.md equivalent to stdout
```

This makes the prompts part of the versioned zts binary rather than loose
files the operator must keep in sync with the tool. An operator who wants
to customise the prompts can:

```sh
zts script context > my-context.md
# edit my-context.md
# pass it manually: cat my-context.md && zts script iteration
```

### Required prompt content

The iteration prompt (`zts script iteration`) must cover everything in the
current `samples/agent-iteration.md` plus the following topics introduced
by these proposals. Each proposal's "Worker prompt additions" or "Guidance
for agents" section specifies the exact wording to include:

| Topic | Source |
|---|---|
| `supersedes` — when and how to mark, auto-registration, `zts tops` | `proposals/supersedes.md` |
| `kind=fails` — marking broken atoms with test evidence | `proposals/failing-tests.md` |
| `zts rels` / `zts dependents` — replacing raw curl | `proposals/cli-additions.md` |
| ASCII-only commit messages and descriptions | already in current prompt |
| Describe atoms immediately after posting | already in current prompt |

### Environment variables exposed to the agent

```sh
export ZTS_CHANNEL="$CHANNEL"
export ZTS_HANDOVER_DIR="$AGENT_DIR/handovers"
```

No corpus filesystem paths. No SQLite paths. No zts source paths.
The agent sees only the handover directory and its channel name.

### Workspace initialisation

```sh
zts script setup [--channel <name>] [--workspace <dir>]
```

Creates the workspace directory structure described in `workspace-and-goal-cli.md`:

```
workspace/
  notes/
    current.md        ← seeded with orientation text
  handovers/
    current.md        ← seeded with "first run" content
  logs/
  tmp/
```

Workspace dir defaults to `./workspace` if not specified. Emits a message
confirming creation and the command to start the loop.

---

## What moves into the tool vs stays external

| Artifact | Now | After |
|---|---|---|
| Loop runner script | `scripts/agent-loop.sh` (project file) | `zts script worker` (built in) |
| Agent system context | `samples/agent-context.md` (project file) | `zts script context` (built in) |
| Per-iteration prompt | `samples/agent-iteration.md` (project file) | `zts script iteration` (built in) |
| Goals list | `samples/goals.md` (project file) | `zts goal list` (see `workspace-and-goal-cli.md`) |
| Handover state | wherever operator puts it | `~/.local/share/zettelkasten/agent/<channel>/` |
| Workspace | unspecified | lightweight dir with notes/, handovers/, tmp/ |

The project repo has no loose orchestration files. Cloning the repo gives
you the zts server and CLI. The agent loop is `zts script worker | bash`.
