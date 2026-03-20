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

export interface LogEntry {
  op: string;
  subject?: string;
  detail?: string;
  actor?: string;
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

  // --- Lifecycle ---

  close(): void {
    this.db.close();
  }
}
