import { Database } from "@db/sqlite";

const SCHEMA_VERSION = 1;

const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS atoms (
  hash        TEXT PRIMARY KEY,
  source      TEXT NOT NULL,
  gzip_size   INTEGER NOT NULL,
  description TEXT NOT NULL,
  goal        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
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
CREATE TRIGGER IF NOT EXISTS atoms_fts_insert AFTER INSERT ON atoms BEGIN
  INSERT INTO atoms_fts(rowid, hash, source) VALUES (NEW.rowid, NEW.hash, NEW.source);
END;

CREATE TRIGGER IF NOT EXISTS atoms_fts_delete AFTER DELETE ON atoms BEGIN
  INSERT INTO atoms_fts(atoms_fts, rowid, hash, source) VALUES ('delete', OLD.rowid, OLD.hash, OLD.source);
END;

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
    }
    // Future: run migrations if row.version < SCHEMA_VERSION
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
  ): boolean {
    try {
      this.db.prepare(
        "INSERT INTO atoms (hash, source, gzip_size, description, goal) VALUES (?, ?, ?, ?, ?)",
      ).run(hash, source, gzipSize, description, goal ?? null);
      return true;
    } catch {
      // UNIQUE constraint = already exists
      return false;
    }
  }

  getAtom(hash: string): Atom | null {
    const row = this.db.prepare(
      "SELECT hash, source, gzip_size, description, goal, created_at FROM atoms WHERE hash = ?",
    ).get<{
      hash: string;
      source: string;
      gzip_size: number;
      description: string;
      goal: string | null;
      created_at: string;
    }>(hash);
    if (!row) return null;
    return {
      hash: row.hash,
      source: row.source,
      gzipSize: row.gzip_size,
      description: row.description,
      goal: row.goal,
      createdAt: row.created_at,
    };
  }

  listAtoms(opts: {
    recent?: number;
    goal?: string;
    broken?: boolean;
    prop?: string;
  }): Omit<Atom, "source">[] {
    const conditions: string[] = [];
    const params: (string | number)[] = [];
    let join = "";
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
      `SELECT a.hash, a.gzip_size, a.description, a.goal, a.created_at FROM atoms a ${join} ${where} ORDER BY a.created_at DESC ${limit}`,
    ).all<{
      hash: string;
      gzip_size: number;
      description: string;
      goal: string | null;
      created_at: string;
    }>(...params);
    return rows.map((r) => ({
      hash: r.hash,
      gzipSize: r.gzip_size,
      description: r.description,
      goal: r.goal,
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
    return this.db.prepare(
      `SELECT hash, snippet(atoms_fts, 1, '>>>', '<<<', '...', 40) as snippet
       FROM atoms_fts WHERE source MATCH ? ORDER BY rank LIMIT ?`,
    ).all<{ hash: string; snippet: string }>(query, limit);
  }

  /** Rebuild the FTS index from all atoms. Call after migration. */
  rebuildFts(): void {
    this.db.exec("INSERT INTO atoms_fts(atoms_fts) VALUES ('rebuild')");
  }

  // --- Lifecycle ---

  close(): void {
    this.db.close();
  }
}
