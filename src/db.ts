import { Database } from "@db/sqlite";

const DESCRIPTIONS_DDL = `
CREATE TABLE IF NOT EXISTS descriptions (
  hash        TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  dim         INTEGER NOT NULL,
  vector      BLOB NOT NULL
);
`;

const RELATIONSHIPS_DDL = `
CREATE TABLE IF NOT EXISTS relationships (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  from_hash  TEXT NOT NULL,
  kind       TEXT NOT NULL,
  to_hash    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(from_hash, kind, to_hash)
);
`;

export class EmbeddingStore {
  private db: Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.exec(DESCRIPTIONS_DDL);
  }

  upsert(hash: string, description: string, vec: Float32Array): void {
    this.db.prepare(
      "INSERT OR REPLACE INTO descriptions (hash, description, dim, vector) VALUES (?, ?, ?, ?)",
    ).run(hash, description, vec.length, new Uint8Array(vec.buffer));
  }

  get(hash: string): { description: string; vector: Float32Array } | null {
    const row = this.db.prepare(
      "SELECT description, dim, vector FROM descriptions WHERE hash = ?",
    ).get<{ description: string; dim: number; vector: Uint8Array }>(hash);
    if (!row) return null;
    return {
      description: row.description,
      vector: new Float32Array(
        row.vector.buffer,
        row.vector.byteOffset,
        row.vector.byteLength / 4,
      ),
    };
  }

  getDescription(hash: string): string | null {
    const row = this.db.prepare(
      "SELECT description FROM descriptions WHERE hash = ?",
    ).get<{ description: string }>(hash);
    return row?.description ?? null;
  }

  // Returns hash → vector for all rows (used at startup to populate HNSW)
  getAll(): Map<string, Float32Array> {
    const rows = this.db.prepare(
      "SELECT hash, vector FROM descriptions",
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

  hasHash(hash: string): boolean {
    const row = this.db.prepare(
      "SELECT 1 FROM descriptions WHERE hash = ?",
    ).get<{ "1": number }>(hash);
    return row !== undefined;
  }

  close(): void {
    this.db.close();
  }
}

export interface Relationship {
  from: string;
  kind: string;
  to: string;
  createdAt: string;
}

export class RelationshipStore {
  private db: Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.exec(RELATIONSHIPS_DDL);
  }

  // Returns false if the relationship already exists.
  insert(from: string, kind: string, to: string): boolean {
    try {
      this.db.prepare(
        "INSERT INTO relationships (from_hash, kind, to_hash) VALUES (?, ?, ?)",
      ).run(from, kind, to);
      return true;
    } catch {
      return false;
    }
  }

  // Returns false if the relationship did not exist.
  delete(from: string, kind: string, to: string): boolean {
    const exists = this.db.prepare(
      "SELECT 1 FROM relationships WHERE from_hash = ? AND kind = ? AND to_hash = ?",
    ).get(from, kind, to);
    if (!exists) return false;
    this.db.prepare(
      "DELETE FROM relationships WHERE from_hash = ? AND kind = ? AND to_hash = ?",
    ).run(from, kind, to);
    return true;
  }

  query(filter: { from?: string; kind?: string; to?: string }): Relationship[] {
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

  close(): void {
    this.db.close();
  }
}
