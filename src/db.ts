import { Database } from "@db/sqlite";

const DDL = `
CREATE TABLE IF NOT EXISTS descriptions (
  hash        TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  dim         INTEGER NOT NULL,
  vector      BLOB NOT NULL
);
`;

export class EmbeddingStore {
  private db: Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.exec(DDL);
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
