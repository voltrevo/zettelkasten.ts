// In-memory flat vector index with cosine similarity search.
// Vectors are loaded once at startup and kept as a singleton — never reloaded
// per request. Linear scan is fast enough for corpora up to ~100K atoms
// (~50ms at 10K atoms × 768 dims). Replace with a true ANN index if needed.

export interface SearchHit {
  hash: string;
  score: number; // cosine similarity in [-1, 1]; higher is more similar
}

export class HnswIndex {
  private hashes: string[] = [];
  // Stored row-major: vectors[i * dim .. (i+1) * dim] is the i-th vector
  private vectors: Float32Array = new Float32Array(0);
  private hashSet = new Set<string>();
  private readonly dim: number;

  constructor(dim: number) {
    this.dim = dim;
  }

  // Matches the async-create API of the original HNSW plan so call sites are identical.
  static create(dim: number, _maxElements: number): HnswIndex {
    return new HnswIndex(dim);
  }

  // No-op if hash is already indexed.
  add(hash: string, vec: Float32Array): void {
    if (this.hashSet.has(hash)) return;
    this.hashSet.add(hash);
    this.hashes.push(hash);
    const newVectors = new Float32Array(this.vectors.length + this.dim);
    newVectors.set(this.vectors);
    newVectors.set(vec, this.vectors.length);
    this.vectors = newVectors;
  }

  // Linear cosine search. Returns top-k sorted descending by score.
  search(vec: Float32Array, k: number): SearchHit[] {
    const n = this.hashes.length;
    if (n === 0) return [];

    // Normalise query vector once
    let mag = 0;
    for (let i = 0; i < this.dim; i++) mag += vec[i] * vec[i];
    const queryMag = Math.sqrt(mag);
    if (queryMag === 0) return [];

    const scores = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const offset = i * this.dim;
      let dot = 0, storedMag = 0;
      for (let j = 0; j < this.dim; j++) {
        dot += vec[j] * this.vectors[offset + j];
        storedMag += this.vectors[offset + j] * this.vectors[offset + j];
      }
      scores[i] = Math.sqrt(storedMag) === 0
        ? 0
        : dot / (queryMag * Math.sqrt(storedMag));
    }

    // Partial sort: find top-k indices
    const actualK = Math.min(k, n);
    const indices = Array.from({ length: n }, (_, i) => i);
    indices.sort((a, b) => scores[b] - scores[a]);

    return indices.slice(0, actualK).map((i) => ({
      hash: this.hashes[i],
      score: scores[i],
    }));
  }

  get size(): number {
    return this.hashes.length;
  }
}
