# SQLite schema

All server-managed state lives in `zts.db`. No git repo, no flat files. Atoms
are stored as rows, not as `a/xx/yy/*.ts` files. The `xx/yy/rest` path format is
preserved only as a URL convention for HTTP retrieval and inter-atom imports.

---

## Core

### atoms

```sql
CREATE TABLE atoms (
  hash        TEXT PRIMARY KEY,   -- 25-char base36 keccak-256
  source      TEXT NOT NULL,      -- TypeScript source code
  gzip_size   INTEGER NOT NULL,   -- size in bytes after minification + gzip
  description TEXT NOT NULL,      -- required; what the atom computes or does
  goal        TEXT REFERENCES goals(name),  -- nullable; primary goal this contributes to
  created_at  TEXT NOT NULL       -- ISO 8601 UTC
);
```

- `description` is NOT NULL. The CLI requires `-d` by default. Opt out with
  `--no-description`; server accepts only if `X-Allow-No-Description` header is
  present.
- `goal` is the primary goal this atom was built for. One atom, one goal (or
  none). Secondary reuse across goals is implicit through imports.
- `gzip_size` is computed at insertion time. The limit is 1024 bytes.

### relationships

```sql
CREATE TABLE relationships (
  from_hash TEXT NOT NULL,
  to_hash   TEXT NOT NULL,
  kind      TEXT NOT NULL CHECK (kind IN ('imports', 'tests', 'supersedes')),
  PRIMARY KEY (from_hash, to_hash, kind)
);
```

- `imports`: from depends on to (auto-registered from atom source)
- `tests`: from is a test applicable to to
- `supersedes`: from improves on or replaces to

### properties

Key-value metadata on individual atoms. Analogous to relationships (which
connect two atoms), but for single-atom annotations.

```sql
CREATE TABLE properties (
  hash  TEXT NOT NULL REFERENCES atoms(hash),
  key   TEXT NOT NULL,
  value TEXT,            -- nullable; some properties are flags (e.g. starred)
  PRIMARY KEY (hash, key)
);
```

Some keys have special semantics:

| Key       | Value | Access | Meaning                    |
| --------- | ----- | ------ | -------------------------- |
| `starred` | null  | admin  | Operator-curated highlight |

The table is intentionally general. Future keys can be added without schema
changes.

### embeddings

```sql
CREATE TABLE embeddings (
  hash      TEXT PRIMARY KEY REFERENCES atoms(hash),
  vector    BLOB NOT NULL,        -- float32 array, dimension depends on model
  model     TEXT NOT NULL,        -- embedding model identifier
  text      TEXT NOT NULL         -- the text that was embedded (description)
);
```

Embeddings are computed from descriptions at post time. Re-embedded when
description is updated.

---

## Testing

### test_evaluation

One row per (test, target) pair. Records the current intended interpretation,
not history.

```sql
CREATE TABLE test_evaluation (
  test_atom       TEXT NOT NULL,
  target_atom     TEXT NOT NULL,
  mode            TEXT NOT NULL CHECK (mode IN ('contract', 'benchmark')),
  expected_outcome TEXT NOT NULL
    CHECK (expected_outcome IN ('pass', 'violates_intent', 'falls_short')),
  commentary      TEXT,
  PRIMARY KEY (test_atom, target_atom)
);
```

- `contract` + `pass`: the test verifies correctness and is expected to pass.
  Default for all `-t` gate registrations.
- `contract` + `violates_intent`: the test reproduces a bug. Objective evidence
  of a correctness defect. Registered via `zts fail`.
- `benchmark` + `falls_short`: the test measures a quality dimension the atom
  does not meet. Not broken, just outclassed. Registered via `zts benchmark`.
- `commentary`: free-text explanation, set via `zts eval set`.

If no `test_evaluation` row exists for a (test, target) pair that has a
`kind=tests` relationship, `expected_outcome=pass` is assumed.

### test_runs

Append-only execution history. Never updated or deleted.

```sql
CREATE TABLE test_runs (
  id          INTEGER PRIMARY KEY,
  test_atom   TEXT NOT NULL,
  target_atom TEXT NOT NULL,
  run_by      TEXT NOT NULL CHECK (run_by IN ('checker', 'agent')),
  result      TEXT NOT NULL CHECK (result IN ('pass', 'fail')),
  duration_ms INTEGER,
  memory_rss  INTEGER,
  details     TEXT,          -- failure output or structured diagnostics
  ran_at      TEXT NOT NULL  -- ISO 8601 UTC
);
```

- `checker` runs are authoritative — they affect corpus state.
- `agent` runs are exploratory — useful for rapid iteration, do not affect
  corpus state.
- Divergence between checker and agent results is a meaningful signal
  (environment difference, nondeterminism, resource limits).

---

## Goals

### goals

```sql
CREATE TABLE goals (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,        -- short slug: "websocket-framing"
  weight     REAL NOT NULL DEFAULT 0.5,   -- 0.1-1.0; higher = more likely picked
  done       INTEGER NOT NULL DEFAULT 0,  -- 0 or 1
  body       TEXT NOT NULL DEFAULT '',    -- markdown: description, subatom plan
  created_at TEXT NOT NULL                -- ISO 8601 UTC
);
```

Goals are installation-local — they belong to a running zts instance, not the
source repo.

### goal_comments

```sql
CREATE TABLE goal_comments (
  id         INTEGER PRIMARY KEY,
  goal_id    INTEGER NOT NULL REFERENCES goals(id),
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL  -- ISO 8601 UTC
);
```

Append-only observations per goal across sessions. Agents read these when
picking up a goal with prior history.

---

## Audit

### log

```sql
CREATE TABLE log (
  id         INTEGER PRIMARY KEY,
  op         TEXT NOT NULL,     -- 'atom.create', 'atom.delete', 'rel.create',
                                -- 'rel.delete', 'eval.set', 'goal.done', etc.
  subject    TEXT,              -- hash, goal name, or composite key
  detail     TEXT,              -- lean JSON, not full payload
  actor      TEXT,              -- token tier, channel name, or 'admin'
  created_at TEXT NOT NULL      -- ISO 8601 UTC
);
```

Every write operation gets a log row. Detail is minimal — enough to identify
what happened, not reproduce it:

| op            | subject     | detail example                            |
| ------------- | ----------- | ----------------------------------------- |
| `atom.create` | hash        | `{"gzip_size": 412}`                      |
| `atom.delete` | hash        | `{}`                                      |
| `rel.create`  | from:to     | `{"kind": "tests"}`                       |
| `eval.set`    | test:target | `{"expected_outcome": "violates_intent"}` |
| `goal.done`   | goal name   | `{}`                                      |
| `goal.create` | goal name   | `{"weight": 0.8}`                         |

Join back to source tables for full content.

---

## Search

### atoms_fts

```sql
CREATE VIRTUAL TABLE atoms_fts USING fts5(
  hash UNINDEXED,
  source,
  content=atoms,
  content_rowid=rowid
);
```

FTS5 full-text index on atom source code. Complements embedding search on
descriptions. Kept in sync via triggers on atoms INSERT/DELETE.

Embedding search answers "find atoms that do X" (natural language). FTS5 search
answers "find atoms containing this code pattern" (literal).

---

## Meta

### schema_version

```sql
CREATE TABLE schema_version (
  version INTEGER NOT NULL
);
-- Seeded with a single row on first creation.
```

Checked on server startup. If the DB version is ahead of the server, fail with a
clear error ("database is schema version N, server supports up to M — upgrade
the server"). If behind, run migrations forward. Single row, never deleted —
only updated.
