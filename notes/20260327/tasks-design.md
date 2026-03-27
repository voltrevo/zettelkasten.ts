# Task System Design Notes

## Concept

Goals are admin-created top-level work items. Tasks are agent-created work items
nested under goals (or under other tasks). Goals are a special kind of task with
extra properties (weight for picking, admin-only CRUD).

Agents can freely create, complete, and nest tasks. They cannot create goals.

## CLI

```
zts task add <goal> <name> [--parent <task-id>] [--body <text>]
zts task list <goal>           # tree view
zts task done <task-id>
zts task pick <goal>           # deepest unfinished leaf with deps met
```

## Schema

```sql
CREATE TABLE tasks (
  id         INTEGER PRIMARY KEY,
  goal_id    INTEGER NOT NULL REFERENCES goals(id),
  parent_id  INTEGER REFERENCES tasks(id),
  name       TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  done       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

## Workflow

1. Agent picks a goal (existing `goal pick`)
2. Agent checks `task list <goal>` — if no tasks, create initial breakdown
3. Agent calls `task pick <goal>` to get deepest unfinished leaf
4. Agent works on that task for the iteration
5. Agent marks `task done <id>` when complete
6. Next iteration picks up the next available task

## task pick algorithm

Walk the tree depth-first by creation order. Return the deepest leaf that:

- Is not done
- All sibling tasks it depends on (earlier siblings) are done
- Has no undone child tasks (i.e. is a leaf, or all children are done)

If no tasks exist, return nothing (agent creates the initial breakdown).

## Open questions

- Should tasks have explicit dependencies beyond parent/sibling ordering?
- Should `goal done` check that all tasks are complete?
- Should task body support § tags for coverage tracking?
- How does task state interact with the summary system?
- Should the worker prompt include the current task tree in context?

## Turn budget awareness

Problem: agents sometimes hit the max-turns limit without writing a summary
or publishing. They have no way to see their own turn count mid-session.

- `num_turns` only appears in the final `result` line of the JSONL stream
- Individual `assistant`/`user` lines carry no turn counter
- The worker can count turns externally but has no channel to communicate
  back to the running agent
- The agent cannot inspect its own turn usage
- Putting the budget in the prompt ("you have 100 turns") doesn't help
  without a way to check current usage

Would need either:
- Claude CLI support for injecting system messages mid-session
- A tool the agent can call to check its turn count (requires claude CLI changes)
- Claude API-level turn tracking visible to the model

Not proceeding with half-measures (prompt-only budget hint) since the agent
can't act on information it can't verify.
