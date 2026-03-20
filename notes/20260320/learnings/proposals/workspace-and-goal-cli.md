# Proposal: workspace separation and goal CLI

## `zts script <name>`

Outputs a shell script to stdout, intended to be piped to `bash`. The script
name selects which script to emit.

```sh
zts script worker | bash          # run one agent iteration
zts script worker > worker.sh     # inspect before running
```

`zts script worker` is the main agent loop runner. See
`proposals/agent-loop-runner.md` for the full mechanism.

Additional scripts can be added over time (e.g., `zts script setup` to
initialise a fresh workspace).

---

## `zts goal` subcommand family

### Storage

Goals are stored in the zts SQLite database (`zts.db`), not as files. This
makes them part of the installation — they belong to a specific running zts
instance, not to the source repo or any shared file tree.

The SQLite schema:

```sql
CREATE TABLE goals (
  id      INTEGER PRIMARY KEY,
  name    TEXT NOT NULL UNIQUE,         -- short slug, e.g. "websocket-framing"
  weight  REAL NOT NULL DEFAULT 0.5,   -- 0.1–1.0; higher = more likely to be picked
  done    INTEGER NOT NULL DEFAULT 0,  -- 0 or 1
  body    TEXT NOT NULL DEFAULT '',    -- free-form markdown: description, subatom breakdown, etc.
  created_at TEXT NOT NULL             -- ISO 8601 UTC
);

CREATE TABLE goal_comments (
  id         INTEGER PRIMARY KEY,
  goal_id    INTEGER NOT NULL REFERENCES goals(id),
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL             -- ISO 8601 UTC
);
```

### Agent commands (`zts goal`)

Agents can read goals, mark completion, and append observations. They cannot
create, modify, or delete goals.

**Pick a goal:**
```sh
zts goal pick [--n N]
```
Weighted random sampling over non-done goals. `--n` controls how many to
display (default 1). Output is the goal name, weight, and full body, suitable
for inclusion in an agent prompt.

The selection is a suggestion. Agents are encouraged to bias toward goals
where they see more opportunity (existing subatoms to build on, recent
momentum, shared infrastructure with in-progress work).

**Show a goal:**
```sh
zts goal show <name>
```
Prints the full goal body plus all comments, newest last.

**List goals:**
```sh
zts goal list
```
Lists non-done goals with name and first line of body. No weights shown
(weights are an admin concern).

**Mark done / undone:**
```sh
zts goal done <name>    # sets done=1; excluded from pick
zts goal undone <name>  # sets done=0; available again (critic agents)
```
Done goals remain in the DB and are queryable — they just don't appear in
`pick` output.

**Add a comment:**
```sh
zts goal comment <name> "observation text"
```
Appends a timestamped row to `goal_comments`. Timestamp is ISO 8601 UTC.

**Query comments:**
```sh
zts goal comments <name> [--recent N]
```
Prints the last N comments (default: all). Useful for agents picking up a
goal that has prior history.

---

### Admin commands (`zts admin goal`)

Operators manage the goal list. Agents do not have access to these commands
(enforced by the per-iteration prompt and, where possible, by the workspace
not having admin credentials or being sandboxed).

**Add a goal:**
```sh
zts admin goal add <name> [--weight 0.8] [--body "description text"]
```
Creates a new goal. `<name>` is a short slug (alphanumeric and hyphens).
`--body` accepts multi-line markdown. `--weight` defaults to 0.5.

**Update a goal:**
```sh
zts admin goal set <name> --weight 0.9
zts admin goal set <name> --body "updated description"
```
Updates mutable fields. `name` and `id` are immutable after creation.

**List all goals (including done):**
```sh
zts admin goal list [--done] [--all]
```
Full listing with weights and done status.

**Delete a goal:**
```sh
zts admin goal delete <name>
```
Removes the goal and all its comments. Only permitted if the goal has no
active agent session referencing it (i.e., no in-progress handover names it).
In practice, deletion should be rare — prefer marking done.

---

## Workspace initialisation

A fresh agent workspace is a lightweight directory. It has no zts source code,
no corpus filesystem access, no SQLite.

```
workspace/
  notes/
    current.md        ← seeded with a brief orientation prompt
  handovers/
    current.md        ← seeded with "first run" content
  logs/
  tmp/
```

`zts script setup` (or similar) could create this structure and seed the
initial files.

---

## Enforcement vs documentation

Architectural enforcement is preferred over documentation-only:

- The workspace directory should not contain or be a subdirectory of the corpus
  repo or the zts source repo
- The `zts` CLI and `zts script worker` should not expose corpus filesystem
  paths to the agent environment
- If the zts server and agent workspace run in separate containers, filesystem
  isolation is automatic

Where enforcement is not yet implemented, the per-iteration prompt should
explicitly warn: "Do not inspect the corpus filesystem or SQLite DB directly.
Use the `zts` CLI. If you find yourself wanting a filesystem path to a corpus
file, you are doing something wrong."
