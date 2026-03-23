import { Database } from "@db/sqlite";

const SCHEMA_VERSION = 4;

const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS goals (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  weight     REAL NOT NULL DEFAULT 0.5,
  done       INTEGER NOT NULL DEFAULT 0,
  body       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS goal_comments (
  id         INTEGER PRIMARY KEY,
  goal_id    INTEGER NOT NULL REFERENCES goals(id),
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS atoms (
  hash        TEXT PRIMARY KEY,
  source      TEXT NOT NULL,
  gzip_size   INTEGER NOT NULL,
  description TEXT NOT NULL,
  goal        TEXT REFERENCES goals(name),
  status      TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('draft', 'published')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS archive (
  hash        TEXT PRIMARY KEY,
  source      TEXT NOT NULL,
  gzip_size   INTEGER NOT NULL,
  description TEXT NOT NULL,
  goal        TEXT,
  status      TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  archived_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS embeddings (
  hash   TEXT PRIMARY KEY REFERENCES atoms(hash),
  vector BLOB NOT NULL,
  dim    INTEGER NOT NULL,
  model  TEXT NOT NULL DEFAULT '',
  text   TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS relationships (
  from_hash  TEXT NOT NULL,
  kind       TEXT NOT NULL,
  to_hash    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(from_hash, kind, to_hash)
);

CREATE TABLE IF NOT EXISTS properties (
  hash  TEXT NOT NULL REFERENCES atoms(hash),
  key   TEXT NOT NULL,
  value TEXT,
  PRIMARY KEY (hash, key)
);

CREATE TABLE IF NOT EXISTS test_evaluation (
  test_atom        TEXT NOT NULL,
  target_atom      TEXT NOT NULL,
  expected_outcome TEXT NOT NULL
    CHECK (expected_outcome IN ('pass', 'violates_intent', 'falls_short')),
  commentary       TEXT,
  PRIMARY KEY (test_atom, target_atom)
);

CREATE TABLE IF NOT EXISTS test_runs (
  id          INTEGER PRIMARY KEY,
  test_atom   TEXT NOT NULL,
  target_atom TEXT NOT NULL,
  run_by      TEXT NOT NULL CHECK (run_by IN ('checker', 'agent')),
  result      TEXT NOT NULL CHECK (result IN ('pass', 'fail')),
  duration_ms INTEGER,
  details     TEXT,
  ran_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE VIRTUAL TABLE IF NOT EXISTS atoms_fts USING fts5(
  hash UNINDEXED,
  source,
  content=atoms,
  content_rowid=rowid
);

-- Triggers to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS atoms_fts_insert AFTER INSERT ON atoms
WHEN NEW.status = 'published'
BEGIN
  INSERT INTO atoms_fts(rowid, hash, source) VALUES (NEW.rowid, NEW.hash, NEW.source);
END;

CREATE TRIGGER IF NOT EXISTS atoms_fts_delete AFTER DELETE ON atoms BEGIN
  INSERT INTO atoms_fts(atoms_fts, rowid, hash, source) VALUES ('delete', OLD.rowid, OLD.hash, OLD.source);
END;

CREATE TRIGGER IF NOT EXISTS atoms_fts_publish AFTER UPDATE OF status ON atoms
WHEN NEW.status = 'published' AND OLD.status = 'draft'
BEGIN
  INSERT INTO atoms_fts(rowid, hash, source) VALUES (NEW.rowid, NEW.hash, NEW.source);
END;

CREATE TABLE IF NOT EXISTS prompts (
  name       TEXT PRIMARY KEY,
  body       TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS log (
  id         INTEGER PRIMARY KEY,
  op         TEXT NOT NULL,
  subject    TEXT,
  detail     TEXT,
  actor      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

export interface Atom {
  hash: string;
  source: string;
  gzipSize: number;
  description: string;
  goal: string | null;
  status: "draft" | "published";
  createdAt: string;
}

export interface Embedding {
  hash: string;
  vector: Float32Array;
  dim: number;
}

export interface Relationship {
  from: string;
  kind: string;
  to: string;
  createdAt: string;
}

export interface TestEvaluation {
  testAtom: string;
  targetAtom: string;
  expectedOutcome: "pass" | "violates_intent" | "falls_short";
  commentary: string | null;
}

export interface TestRun {
  id: number;
  testAtom: string;
  targetAtom: string;
  runBy: "checker" | "agent";
  result: "pass" | "fail";
  durationMs: number | null;
  details: string | null;
  ranAt: string;
}

export interface Goal {
  id: number;
  name: string;
  weight: number;
  done: boolean;
  body: string;
  createdAt: string;
}

export interface GoalComment {
  id: number;
  body: string;
  createdAt: string;
}

export interface LogEntry {
  op: string;
  subject?: string;
  detail?: string;
  actor?: string;
}

export class AmbiguousHashError extends Error {
  constructor(prefix: string) {
    super(`Ambiguous hash prefix: ${prefix}`);
    this.name = "AmbiguousHashError";
  }
}

export class Db {
  private db: Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.exec("PRAGMA journal_mode=WAL");
    this.db.exec("PRAGMA foreign_keys=ON");
    this.db.exec(SCHEMA_DDL);
    this.initSchemaVersion();
  }

  private initSchemaVersion(): void {
    const row = this.db.prepare(
      "SELECT version FROM schema_version LIMIT 1",
    ).get<{ version: number }>();
    if (!row) {
      this.db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(
        SCHEMA_VERSION,
      );
    } else if (row.version > SCHEMA_VERSION) {
      throw new Error(
        `Database is schema version ${row.version}, server supports up to ${SCHEMA_VERSION}. Upgrade the server.`,
      );
    } else if (row.version < SCHEMA_VERSION) {
      this.runMigrations(row.version);
    }
  }

  private runMigrations(fromVersion: number): void {
    if (fromVersion < 2) {
      // v1→v2: add goals tables, recreate atoms with FK to goals
      console.log("Migrating schema v1 → v2...");
      this.db.exec("PRAGMA foreign_keys=OFF");
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS goals (
          id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE,
          weight REAL NOT NULL DEFAULT 0.5, done INTEGER NOT NULL DEFAULT 0,
          body TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS goal_comments (
          id INTEGER PRIMARY KEY, goal_id INTEGER NOT NULL REFERENCES goals(id),
          body TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE atoms_new (
          hash TEXT PRIMARY KEY, source TEXT NOT NULL, gzip_size INTEGER NOT NULL,
          description TEXT NOT NULL, goal TEXT REFERENCES goals(name),
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO atoms_new SELECT hash, source, gzip_size, description, goal, created_at FROM atoms;
        DROP TABLE atoms;
        ALTER TABLE atoms_new RENAME TO atoms;
      `);
      // Recreate FTS triggers (they reference atoms which was recreated)
      this.db.exec(`
        DROP TRIGGER IF EXISTS atoms_fts_insert;
        DROP TRIGGER IF EXISTS atoms_fts_delete;
        CREATE TRIGGER atoms_fts_insert AFTER INSERT ON atoms BEGIN
          INSERT INTO atoms_fts(rowid, hash, source) VALUES (NEW.rowid, NEW.hash, NEW.source);
        END;
        CREATE TRIGGER atoms_fts_delete AFTER DELETE ON atoms BEGIN
          INSERT INTO atoms_fts(atoms_fts, rowid, hash, source) VALUES ('delete', OLD.rowid, OLD.hash, OLD.source);
        END;
      `);
      this.db.exec("PRAGMA foreign_keys=ON");
      this.db.prepare("UPDATE schema_version SET version = ?").run(2);
      console.log("Schema v2 migration complete.");
    }
    if (fromVersion < 3) {
      // v2→v3: add prompts table
      console.log("Migrating schema v2 → v3...");
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS prompts (
          name TEXT PRIMARY KEY, body TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
      this.db.prepare("UPDATE schema_version SET version = ?").run(3);
      console.log("Schema v3 migration complete.");
    }
    if (fromVersion < 4) {
      console.log("Migrating schema v3 → v4...");
      this.db.exec("PRAGMA foreign_keys=OFF");
      this.db.exec(`
        CREATE TABLE atoms_new (
          hash TEXT PRIMARY KEY, source TEXT NOT NULL, gzip_size INTEGER NOT NULL,
          description TEXT NOT NULL, goal TEXT REFERENCES goals(name),
          status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('draft', 'published')),
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO atoms_new SELECT hash, source, gzip_size, description, goal, 'published', created_at FROM atoms;
        DROP TABLE atoms;
        ALTER TABLE atoms_new RENAME TO atoms;
        CREATE TABLE IF NOT EXISTS archive (
          hash TEXT PRIMARY KEY, source TEXT NOT NULL, gzip_size INTEGER NOT NULL,
          description TEXT NOT NULL, goal TEXT, status TEXT NOT NULL,
          created_at TEXT NOT NULL, archived_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
      // Recreate FTS triggers
      this.db.exec(`
        DROP TRIGGER IF EXISTS atoms_fts_insert;
        DROP TRIGGER IF EXISTS atoms_fts_delete;
        CREATE TRIGGER atoms_fts_insert AFTER INSERT ON atoms
        WHEN NEW.status = 'published'
        BEGIN
          INSERT INTO atoms_fts(rowid, hash, source) VALUES (NEW.rowid, NEW.hash, NEW.source);
        END;
        CREATE TRIGGER atoms_fts_delete AFTER DELETE ON atoms BEGIN
          INSERT INTO atoms_fts(atoms_fts, rowid, hash, source) VALUES ('delete', OLD.rowid, OLD.hash, OLD.source);
        END;
        CREATE TRIGGER atoms_fts_publish AFTER UPDATE OF status ON atoms
        WHEN NEW.status = 'published' AND OLD.status = 'draft'
        BEGIN
          INSERT INTO atoms_fts(rowid, hash, source) VALUES (NEW.rowid, NEW.hash, NEW.source);
        END;
      `);
      this.db.exec("PRAGMA foreign_keys=ON");
      this.db.prepare("UPDATE schema_version SET version = ?").run(4);
      console.log("Schema v4 migration complete.");
    }
  }

  // --- Hash resolution ---

  /** Resolve a hash prefix to a full hash. Returns null if no match, throws if ambiguous. */
  resolveHash(prefix: string): string | null {
    if (prefix.length === 25) {
      return this.atomExists(prefix) ? prefix : null;
    }
    const rows = this.db.prepare(
      "SELECT hash FROM atoms WHERE hash LIKE ? LIMIT 2",
    ).all<{ hash: string }>(prefix + "%");
    if (rows.length === 0) return null;
    if (rows.length > 1) {
      throw new AmbiguousHashError(prefix);
    }
    return rows[0].hash;
  }

  // --- Atoms ---

  insertAtom(
    hash: string,
    source: string,
    gzipSize: number,
    description: string,
    goal?: string,
    status: "draft" | "published" = "published",
  ): boolean {
    try {
      this.db.prepare(
        "INSERT INTO atoms (hash, source, gzip_size, description, goal, status) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(hash, source, gzipSize, description, goal ?? null, status);
      return true;
    } catch {
      // UNIQUE constraint = already exists
      return false;
    }
  }

  getAtom(hash: string): Atom | null {
    const row = this.db.prepare(
      "SELECT hash, source, gzip_size, description, goal, status, created_at FROM atoms WHERE hash = ?",
    ).get<{
      hash: string;
      source: string;
      gzip_size: number;
      description: string;
      goal: string | null;
      status: string;
      created_at: string;
    }>(hash);
    if (!row) return null;
    return {
      hash: row.hash,
      source: row.source,
      gzipSize: row.gzip_size,
      description: row.description,
      goal: row.goal,
      status: row.status as "draft" | "published",
      createdAt: row.created_at,
    };
  }

  listAtoms(opts: {
    recent?: number;
    goal?: string;
    broken?: boolean;
    prop?: string;
    status?: "draft" | "published";
  }): Omit<Atom, "source">[] {
    const conditions: string[] = [];
    const params: (string | number)[] = [];
    let join = "";
    // Default to published only
    conditions.push("a.status = ?");
    params.push(opts.status ?? "published");
    if (opts.goal) {
      conditions.push("a.goal = ?");
      params.push(opts.goal);
    }
    if (opts.broken) {
      conditions.push("a.description LIKE 'BROKEN:%'");
    }
    if (opts.prop) {
      join = "JOIN properties p ON a.hash = p.hash AND p.key = ?";
      params.unshift(opts.prop);
    }
    const where = conditions.length > 0
      ? `WHERE ${conditions.join(" AND ")}`
      : "";
    const limit = opts.recent ? `LIMIT ?` : "";
    if (opts.recent) params.push(opts.recent);
    const rows = this.db.prepare(
      `SELECT a.hash, a.gzip_size, a.description, a.goal, a.status, a.created_at FROM atoms a ${join} ${where} ORDER BY a.created_at DESC ${limit}`,
    ).all<{
      hash: string;
      gzip_size: number;
      description: string;
      goal: string | null;
      status: string;
      created_at: string;
    }>(...params);
    return rows.map((r) => ({
      hash: r.hash,
      gzipSize: r.gzip_size,
      description: r.description,
      goal: r.goal,
      status: r.status as "draft" | "published",
      createdAt: r.created_at,
    }));
  }

  getSource(hash: string): string | null {
    const row = this.db.prepare(
      "SELECT source FROM atoms WHERE hash = ?",
    ).get<{ source: string }>(hash);
    return row?.source ?? null;
  }

  atomExists(hash: string): boolean {
    const row = this.db.prepare(
      "SELECT 1 FROM atoms WHERE hash = ?",
    ).get<{ "1": number }>(hash);
    return row !== undefined;
  }

  deleteAtom(hash: string): boolean {
    const changes = this.db.prepare(
      "DELETE FROM atoms WHERE hash = ?",
    ).run(hash);
    return changes > 0;
  }

  getAtomStatus(hash: string): "draft" | "published" | null {
    const row = this.db.prepare(
      "SELECT status FROM atoms WHERE hash = ?",
    ).get<{ status: string }>(hash);
    return (row?.status as "draft" | "published") ?? null;
  }

  publishAtom(hash: string, description: string, goal?: string): boolean {
    const changes = this.db.prepare(
      "UPDATE atoms SET status = 'published', description = ?, goal = ? WHERE hash = ? AND status = 'draft'",
    ).run(description, goal ?? null, hash);
    return changes > 0;
  }

  listDrafts(): Omit<Atom, "source">[] {
    const rows = this.db.prepare(
      "SELECT hash, gzip_size, description, goal, status, created_at FROM atoms WHERE status = 'draft' ORDER BY created_at DESC",
    ).all<{
      hash: string;
      gzip_size: number;
      description: string;
      goal: string | null;
      status: string;
      created_at: string;
    }>();
    return rows.map((r) => ({
      hash: r.hash,
      gzipSize: r.gzip_size,
      description: r.description,
      goal: r.goal,
      status: r.status as "draft" | "published",
      createdAt: r.created_at,
    }));
  }

  archiveAtom(hash: string): void {
    this.db.exec("BEGIN");
    try {
      this.db.prepare(
        "INSERT INTO archive (hash, source, gzip_size, description, goal, status, created_at) SELECT hash, source, gzip_size, description, goal, status, created_at FROM atoms WHERE hash = ?",
      ).run(hash);
      this.db.prepare("DELETE FROM embeddings WHERE hash = ?").run(hash);
      this.db.prepare("DELETE FROM properties WHERE hash = ?").run(hash);
      this.db.prepare(
        "DELETE FROM relationships WHERE from_hash = ? OR to_hash = ?",
      ).run(hash, hash);
      this.db.prepare(
        "DELETE FROM test_evaluation WHERE test_atom = ? OR target_atom = ?",
      ).run(hash, hash);
      this.db.prepare("DELETE FROM atoms WHERE hash = ?").run(hash);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  getArchivedAtom(hash: string): Atom | null {
    const row = this.db.prepare(
      "SELECT hash, source, gzip_size, description, goal, status, created_at FROM archive WHERE hash = ?",
    ).get<{
      hash: string;
      source: string;
      gzip_size: number;
      description: string;
      goal: string | null;
      status: string;
      created_at: string;
    }>(hash);
    if (!row) return null;
    return {
      hash: row.hash,
      source: row.source,
      gzipSize: row.gzip_size,
      description: row.description,
      goal: row.goal,
      status: row.status as "draft" | "published",
      createdAt: row.created_at,
    };
  }

  listStaleDrafts(olderThan: string): string[] {
    return this.db.prepare(
      "SELECT hash FROM atoms WHERE status = 'draft' AND created_at < ?",
    ).all<{ hash: string }>(olderThan).map((r) => r.hash);
  }

  updateDescription(hash: string, description: string): boolean {
    const changes = this.db.prepare(
      "UPDATE atoms SET description = ? WHERE hash = ?",
    ).run(description, hash);
    return changes > 0;
  }

  getDescription(hash: string): string | null {
    const row = this.db.prepare(
      "SELECT description FROM atoms WHERE hash = ?",
    ).get<{ description: string }>(hash);
    return row?.description ?? null;
  }

  // --- Embeddings ---

  upsertEmbedding(hash: string, vec: Float32Array, text: string): void {
    this.db.prepare(
      "INSERT OR REPLACE INTO embeddings (hash, vector, dim, text) VALUES (?, ?, ?, ?)",
    ).run(hash, new Uint8Array(vec.buffer), vec.length, text);
  }

  getEmbedding(hash: string): Embedding | null {
    const row = this.db.prepare(
      "SELECT hash, vector, dim FROM embeddings WHERE hash = ?",
    ).get<{ hash: string; vector: Uint8Array; dim: number }>(hash);
    if (!row) return null;
    return {
      hash: row.hash,
      vector: new Float32Array(
        row.vector.buffer,
        row.vector.byteOffset,
        row.vector.byteLength / 4,
      ),
      dim: row.dim,
    };
  }

  getAllEmbeddings(): Map<string, Float32Array> {
    const rows = this.db.prepare(
      "SELECT hash, vector FROM embeddings",
    ).all<{ hash: string; vector: Uint8Array }>();
    const result = new Map<string, Float32Array>();
    for (const row of rows) {
      result.set(
        row.hash,
        new Float32Array(
          row.vector.buffer,
          row.vector.byteOffset,
          row.vector.byteLength / 4,
        ),
      );
    }
    return result;
  }

  hasEmbedding(hash: string): boolean {
    const row = this.db.prepare(
      "SELECT 1 FROM embeddings WHERE hash = ?",
    ).get<{ "1": number }>(hash);
    return row !== undefined;
  }

  deleteEmbedding(hash: string): void {
    this.db.prepare("DELETE FROM embeddings WHERE hash = ?").run(hash);
  }

  // --- Relationships ---

  insertRelationship(from: string, kind: string, to: string): boolean {
    try {
      this.db.prepare(
        "INSERT INTO relationships (from_hash, kind, to_hash) VALUES (?, ?, ?)",
      ).run(from, kind, to);
      return true;
    } catch {
      return false;
    }
  }

  deleteRelationship(from: string, kind: string, to: string): boolean {
    const exists = this.db.prepare(
      "SELECT 1 FROM relationships WHERE from_hash = ? AND kind = ? AND to_hash = ?",
    ).get(from, kind, to);
    if (!exists) return false;
    this.db.prepare(
      "DELETE FROM relationships WHERE from_hash = ? AND kind = ? AND to_hash = ?",
    ).run(from, kind, to);
    return true;
  }

  queryRelationships(
    filter: { from?: string; kind?: string; to?: string },
  ): Relationship[] {
    const conditions: string[] = [];
    const params: string[] = [];
    if (filter.from !== undefined) {
      conditions.push("from_hash = ?");
      params.push(filter.from);
    }
    if (filter.kind !== undefined) {
      conditions.push("kind = ?");
      params.push(filter.kind);
    }
    if (filter.to !== undefined) {
      conditions.push("to_hash = ?");
      params.push(filter.to);
    }
    const where = conditions.length > 0
      ? `WHERE ${conditions.join(" AND ")}`
      : "";
    const rows = this.db.prepare(
      `SELECT from_hash, kind, to_hash, created_at FROM relationships ${where}`,
    ).all<
      { from_hash: string; kind: string; to_hash: string; created_at: string }
    >(
      ...params,
    );
    return rows.map((r) => ({
      from: r.from_hash,
      kind: r.kind,
      to: r.to_hash,
      createdAt: r.created_at,
    }));
  }

  // --- Supersedes / tops ---

  /**
   * BFS up the supersedes graph from `hash`. Returns tops (atoms not
   * themselves superseded) in BFS depth order, level-complete at `limit`.
   * If `hash` is already a top, returns it.
   */
  findTops(
    hash: string,
    limit: number,
  ): { hash: string; depth: number; description: string }[] {
    // "superseded by" = atoms where kind=supersedes, to=hash → from supersedes hash
    // So to go "up" from hash, find relationships where to=hash, kind=supersedes
    // Those `from` atoms are the ones that supersede hash.

    // Check if hash itself is a top (nothing supersedes it)
    const supersededBy = this.queryRelationships({
      to: hash,
      kind: "supersedes",
    });
    if (supersededBy.length === 0) {
      const desc = this.getDescription(hash) ?? "";
      return [{ hash, depth: 0, description: desc }];
    }

    // BFS: queue of { hash, depth }
    const visited = new Set<string>();
    visited.add(hash);
    const queue: { hash: string; depth: number }[] = [];
    for (const r of supersededBy) {
      if (!visited.has(r.from)) {
        visited.add(r.from);
        queue.push({ hash: r.from, depth: 1 });
      }
    }

    const tops: { hash: string; depth: number; description: string }[] = [];
    let qi = 0;

    while (qi < queue.length) {
      const current = queue[qi++];
      const nextSupersededBy = this.queryRelationships({
        to: current.hash,
        kind: "supersedes",
      });

      if (nextSupersededBy.length === 0) {
        // This is a top
        const desc = this.getDescription(current.hash) ?? "";
        tops.push({
          hash: current.hash,
          depth: current.depth,
          description: desc,
        });

        // Level-complete: if we've hit the limit, finish the current depth level
        if (tops.length >= limit) {
          const cutoffDepth = current.depth;
          // Continue processing remaining items at this depth
          while (qi < queue.length && queue[qi].depth === cutoffDepth) {
            const item = queue[qi++];
            const itemSupersededBy = this.queryRelationships({
              to: item.hash,
              kind: "supersedes",
            });
            if (itemSupersededBy.length === 0) {
              const d = this.getDescription(item.hash) ?? "";
              tops.push({ hash: item.hash, depth: item.depth, description: d });
            }
          }
          break;
        }
      } else {
        for (const r of nextSupersededBy) {
          if (!visited.has(r.from)) {
            visited.add(r.from);
            queue.push({ hash: r.from, depth: current.depth + 1 });
          }
        }
      }
    }

    return tops;
  }

  // --- Properties ---

  setProperty(hash: string, key: string, value?: string): void {
    this.db.prepare(
      "INSERT OR REPLACE INTO properties (hash, key, value) VALUES (?, ?, ?)",
    ).run(hash, key, value ?? null);
  }

  unsetProperty(hash: string, key: string): boolean {
    const changes = this.db.prepare(
      "DELETE FROM properties WHERE hash = ? AND key = ?",
    ).run(hash, key);
    return changes > 0;
  }

  getProperties(hash: string): { key: string; value: string | null }[] {
    return this.db.prepare(
      "SELECT key, value FROM properties WHERE hash = ?",
    ).all<{ key: string; value: string | null }>(hash);
  }

  // --- Test evaluation ---

  upsertTestEvaluation(
    testAtom: string,
    targetAtom: string,
    expectedOutcome: string,
    commentary?: string,
  ): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO test_evaluation
       (test_atom, target_atom, expected_outcome, commentary)
       VALUES (?, ?, ?, ?)`,
    ).run(testAtom, targetAtom, expectedOutcome, commentary ?? null);
  }

  getTestEvaluation(
    testAtom: string,
    targetAtom: string,
  ): TestEvaluation | null {
    const row = this.db.prepare(
      `SELECT test_atom, target_atom, expected_outcome, commentary
       FROM test_evaluation WHERE test_atom = ? AND target_atom = ?`,
    ).get<{
      test_atom: string;
      target_atom: string;
      expected_outcome: string;
      commentary: string | null;
    }>(testAtom, targetAtom);
    if (!row) return null;
    return {
      testAtom: row.test_atom,
      targetAtom: row.target_atom,
      expectedOutcome: row
        .expected_outcome as TestEvaluation["expectedOutcome"],
      commentary: row.commentary,
    };
  }

  /** Get all evaluations for a target atom. */
  getEvaluationsForTarget(targetAtom: string): TestEvaluation[] {
    const rows = this.db.prepare(
      `SELECT test_atom, target_atom, expected_outcome, commentary
       FROM test_evaluation WHERE target_atom = ?`,
    ).all<{
      test_atom: string;
      target_atom: string;
      expected_outcome: string;
      commentary: string | null;
    }>(targetAtom);
    return rows.map((r) => ({
      testAtom: r.test_atom,
      targetAtom: r.target_atom,
      expectedOutcome: r.expected_outcome as TestEvaluation["expectedOutcome"],
      commentary: r.commentary,
    }));
  }

  // --- Test runs ---

  insertTestRun(run: Omit<TestRun, "id" | "ranAt">): void {
    this.db.prepare(
      `INSERT INTO test_runs (test_atom, target_atom, run_by, result, duration_ms, details)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      run.testAtom,
      run.targetAtom,
      run.runBy,
      run.result,
      run.durationMs ?? null,
      run.details ?? null,
    );
  }

  queryTestRuns(opts: {
    target?: string;
    test?: string;
    recent?: number;
  }): TestRun[] {
    const conditions: string[] = [];
    const params: (string | number)[] = [];
    if (opts.target) {
      conditions.push("target_atom = ?");
      params.push(opts.target);
    }
    if (opts.test) {
      conditions.push("test_atom = ?");
      params.push(opts.test);
    }
    const where = conditions.length > 0
      ? `WHERE ${conditions.join(" AND ")}`
      : "";
    const limit = opts.recent ? `LIMIT ?` : "";
    if (opts.recent) params.push(opts.recent);
    const rows = this.db.prepare(
      `SELECT id, test_atom, target_atom, run_by, result, duration_ms, details, ran_at
       FROM test_runs ${where} ORDER BY id DESC ${limit}`,
    ).all<{
      id: number;
      test_atom: string;
      target_atom: string;
      run_by: string;
      result: string;
      duration_ms: number | null;
      details: string | null;
      ran_at: string;
    }>(...params);
    return rows.map((r) => ({
      id: r.id,
      testAtom: r.test_atom,
      targetAtom: r.target_atom,
      runBy: r.run_by as TestRun["runBy"],
      result: r.result as TestRun["result"],
      durationMs: r.duration_ms,
      details: r.details,
      ranAt: r.ran_at,
    }));
  }

  // --- Log ---

  insertLog(entry: LogEntry): void {
    this.db.prepare(
      "INSERT INTO log (op, subject, detail, actor) VALUES (?, ?, ?, ?)",
    ).run(
      entry.op,
      entry.subject ?? null,
      entry.detail ?? null,
      entry.actor ?? null,
    );
  }

  queryLog(opts: {
    recent?: number;
    op?: string;
    subject?: string;
  }): {
    id: number;
    op: string;
    subject: string | null;
    detail: string | null;
    actor: string | null;
    createdAt: string;
  }[] {
    const conditions: string[] = [];
    const params: (string | number)[] = [];
    if (opts.op) {
      conditions.push("op = ?");
      params.push(opts.op);
    }
    if (opts.subject) {
      conditions.push("subject = ?");
      params.push(opts.subject);
    }
    const where = conditions.length > 0
      ? `WHERE ${conditions.join(" AND ")}`
      : "";
    const limit = opts.recent ? `LIMIT ?` : "";
    if (opts.recent) params.push(opts.recent);
    return this.db.prepare(
      `SELECT id, op, subject, detail, actor, created_at FROM log ${where} ORDER BY id DESC ${limit}`,
    ).all<{
      id: number;
      op: string;
      subject: string | null;
      detail: string | null;
      actor: string | null;
      created_at: string;
    }>(...params).map((r) => ({
      id: r.id,
      op: r.op,
      subject: r.subject,
      detail: r.detail,
      actor: r.actor,
      createdAt: r.created_at,
    }));
  }

  // --- FTS source search ---

  searchSource(
    query: string,
    limit: number = 20,
  ): { hash: string; snippet: string }[] {
    // Quote each token to prevent FTS5 syntax errors from special chars
    const tokens = query
      .split(/\s+/)
      .filter((t) => t.length > 0);
    if (tokens.length === 0) return [];
    const safe = tokens
      .map((t) => `"${t.replace(/"/g, '""')}"`)
      .join(" ");
    return this.db.prepare(
      `SELECT f.hash, snippet(atoms_fts, 1, '[[', ']]', '...', 40) as snippet
       FROM atoms_fts f JOIN atoms a ON a.hash = f.hash
       WHERE f.source MATCH ? AND a.status = 'published'
       ORDER BY rank LIMIT ?`,
    ).all<{ hash: string; snippet: string }>(safe, limit).map((r) => ({
      hash: r.hash,
      snippet: r.snippet.replace(/\[\[/g, "<mark>").replace(/]]/g, "</mark>"),
    }));
  }

  /** Rebuild the FTS index from all atoms. Call after migration. */
  rebuildFts(): void {
    this.db.exec("INSERT INTO atoms_fts(atoms_fts) VALUES ('rebuild')");
  }

  // --- Goals ---

  private rowToGoal(r: {
    id: number;
    name: string;
    weight: number;
    done: number;
    body: string;
    created_at: string;
  }): Goal {
    return {
      id: r.id,
      name: r.name,
      weight: r.weight,
      done: r.done === 1,
      body: r.body,
      createdAt: r.created_at,
    };
  }

  createGoal(
    name: string,
    weight: number = 0.5,
    body: string = "",
  ): Goal {
    this.db.prepare(
      "INSERT INTO goals (name, weight, body) VALUES (?, ?, ?)",
    ).run(name, weight, body);
    return this.getGoal(name)!;
  }

  getGoal(name: string): Goal | null {
    const row = this.db.prepare(
      "SELECT id, name, weight, done, body, created_at FROM goals WHERE name = ?",
    ).get<{
      id: number;
      name: string;
      weight: number;
      done: number;
      body: string;
      created_at: string;
    }>(name);
    if (!row) return null;
    return this.rowToGoal(row);
  }

  listGoals(opts: {
    done?: boolean;
    all?: boolean;
  } = {}): Goal[] {
    let sql = "SELECT id, name, weight, done, body, created_at FROM goals";
    if (!opts.all) {
      if (opts.done) {
        sql += " WHERE done = 1";
      } else {
        sql += " WHERE done = 0";
      }
    }
    sql += " ORDER BY weight DESC, name ASC";
    return this.db.prepare(sql).all<{
      id: number;
      name: string;
      weight: number;
      done: number;
      body: string;
      created_at: string;
    }>().map((r) => this.rowToGoal(r));
  }

  /** Weighted random sample of non-done goals. */
  pickGoals(n: number = 1): Goal[] {
    const goals = this.listGoals();
    if (goals.length === 0) return [];
    // Weighted random sampling without replacement
    const picked: Goal[] = [];
    const remaining = [...goals];
    for (let i = 0; i < n && remaining.length > 0; i++) {
      const totalWeight = remaining.reduce((s, g) => s + g.weight, 0);
      let r = Math.random() * totalWeight;
      let idx = 0;
      for (; idx < remaining.length - 1; idx++) {
        r -= remaining[idx].weight;
        if (r <= 0) break;
      }
      picked.push(remaining[idx]);
      remaining.splice(idx, 1);
    }
    return picked;
  }

  goalAtomCounts(): Map<string, number> {
    const rows = this.db.prepare(
      "SELECT goal, count(*) as c FROM atoms WHERE status = 'published' AND goal IS NOT NULL GROUP BY goal",
    ).all<{ goal: string; c: number }>();
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.goal, r.c);
    return m;
  }

  updateGoal(
    name: string,
    updates: { weight?: number; body?: string },
  ): boolean {
    const sets: string[] = [];
    const params: (string | number)[] = [];
    if (updates.weight !== undefined) {
      sets.push("weight = ?");
      params.push(updates.weight);
    }
    if (updates.body !== undefined) {
      sets.push("body = ?");
      params.push(updates.body);
    }
    if (sets.length === 0) return false;
    params.push(name);
    const changes = this.db.prepare(
      `UPDATE goals SET ${sets.join(", ")} WHERE name = ?`,
    ).run(...params);
    return changes > 0;
  }

  deleteGoal(name: string): boolean {
    const goal = this.getGoal(name);
    if (!goal) return false;
    this.db.prepare("DELETE FROM goal_comments WHERE goal_id = ?").run(goal.id);
    const changes = this.db.prepare("DELETE FROM goals WHERE name = ?").run(
      name,
    );
    return changes > 0;
  }

  markGoalDone(name: string): boolean {
    const changes = this.db.prepare(
      "UPDATE goals SET done = 1 WHERE name = ?",
    ).run(name);
    return changes > 0;
  }

  markGoalUndone(name: string): boolean {
    const changes = this.db.prepare(
      "UPDATE goals SET done = 0 WHERE name = ?",
    ).run(name);
    return changes > 0;
  }

  addGoalComment(name: string, body: string): boolean {
    const goal = this.getGoal(name);
    if (!goal) return false;
    this.db.prepare(
      "INSERT INTO goal_comments (goal_id, body) VALUES (?, ?)",
    ).run(goal.id, body);
    return true;
  }

  getGoalComments(name: string, recent?: number): GoalComment[] {
    const goal = this.getGoal(name);
    if (!goal) return [];
    const limit = recent ? `LIMIT ?` : "";
    const params: (number)[] = [goal.id];
    if (recent) params.push(recent);
    return this.db.prepare(
      `SELECT id, body, created_at FROM goal_comments WHERE goal_id = ? ORDER BY id DESC ${limit}`,
    ).all<{ id: number; body: string; created_at: string }>(...params).map(
      (r) => ({
        id: r.id,
        body: r.body,
        createdAt: r.created_at,
      }),
    );
  }

  deleteGoalComment(id: number): boolean {
    const result = this.db.prepare("DELETE FROM goal_comments WHERE id = ?")
      .run(
        id,
      );
    return result > 0;
  }

  goalExists(name: string): boolean {
    const row = this.db.prepare(
      "SELECT 1 FROM goals WHERE name = ?",
    ).get<{ "1": number }>(name);
    return row !== undefined;
  }

  // --- Prompts ---

  getPromptOverride(name: string): string | null {
    const row = this.db.prepare(
      "SELECT body FROM prompts WHERE name = ?",
    ).get<{ body: string }>(name);
    return row?.body ?? null;
  }

  setPromptOverride(name: string, body: string): void {
    this.db.prepare(
      "INSERT OR REPLACE INTO prompts (name, body, updated_at) VALUES (?, ?, datetime('now'))",
    ).run(name, body);
  }

  deletePromptOverride(name: string): boolean {
    const changes = this.db.prepare(
      "DELETE FROM prompts WHERE name = ?",
    ).run(name);
    return changes > 0;
  }

  // --- Status ---

  getStatus(since: string): {
    totalAtoms: number;
    defects: number;
    superseded: number;
    recentAtoms: number;
    recentRelationships: number;
    recentGoalsDone: number;
    goalStats: {
      name: string;
      total: number;
      recent: number;
      commentCount: number;
    }[];
    activeGoals: { name: string; weight: number }[];
  } {
    const totalAtoms = this.db.prepare(
      "SELECT count(*) as c FROM atoms WHERE status = 'published'",
    ).get<{ c: number }>()!.c;

    const defects = this.db.prepare(
      "SELECT count(DISTINCT target_atom) as c FROM test_evaluation WHERE expected_outcome = 'violates_intent'",
    ).get<{ c: number }>()!.c;

    const superseded = this.db.prepare(
      "SELECT count(DISTINCT to_hash) as c FROM relationships WHERE kind = 'supersedes'",
    ).get<{ c: number }>()!.c;

    const recentAtoms = this.db.prepare(
      "SELECT count(*) as c FROM atoms WHERE status = 'published' AND created_at >= ?",
    ).get<{ c: number }>(since)!.c;

    const recentRelationships = this.db.prepare(
      "SELECT count(*) as c FROM relationships WHERE created_at >= ?",
    ).get<{ c: number }>(since)!.c;

    const recentGoalsDone = this.db.prepare(
      "SELECT count(*) as c FROM log WHERE op = 'goal.done' AND created_at >= ?",
    ).get<{ c: number }>(since)!.c;

    const goalStats = this.db.prepare(
      `SELECT g.name,
              count(a.hash) as total,
              count(CASE WHEN a.created_at >= ? THEN 1 END) as recent,
              (SELECT count(*) FROM goal_comments gc WHERE gc.goal_id = g.id) as comment_count
       FROM goals g
       LEFT JOIN atoms a ON a.goal = g.name
       WHERE g.done = 0
       GROUP BY g.id
       ORDER BY recent DESC, total DESC`,
    ).all<{
      name: string;
      total: number;
      recent: number;
      comment_count: number;
    }>(since).map((r) => ({
      name: r.name,
      total: r.total,
      recent: r.recent,
      commentCount: r.comment_count,
    }));

    const activeGoals = this.db.prepare(
      "SELECT name, weight FROM goals WHERE done = 0 ORDER BY weight DESC",
    ).all<{ name: string; weight: number }>();

    return {
      totalAtoms,
      defects,
      superseded,
      recentAtoms,
      recentRelationships,
      recentGoalsDone,
      goalStats,
      activeGoals,
    };
  }

  // --- Lifecycle ---

  close(): void {
    this.db.close();
  }
}
