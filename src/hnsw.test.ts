import { assertEquals } from "@std/assert";
import { HnswIndex } from "./hnsw.ts";

const DIM = 4;

function unitVec(values: number[]): Float32Array {
  const v = new Float32Array(values);
  const mag = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return v.map((x) => x / mag) as unknown as Float32Array;
}

Deno.test("HnswIndex: empty index returns []", () => {
  const idx = HnswIndex.create(DIM, 16);
  assertEquals(idx.search(new Float32Array([1, 0, 0, 0]), 5), []);
  assertEquals(idx.size, 0);
});

Deno.test("HnswIndex: size reflects insertions", () => {
  const idx = HnswIndex.create(DIM, 16);
  idx.add("aaaaabbbbbcccccdddddeeeee", unitVec([1, 0, 0, 0]));
  idx.add("fffffggggghhhhhjjjjjkkkkk", unitVec([0, 1, 0, 0]));
  assertEquals(idx.size, 2);
});

Deno.test("HnswIndex: add is no-op for duplicate hash", () => {
  const idx = HnswIndex.create(DIM, 16);
  idx.add("aaaaabbbbbcccccdddddeeeee", unitVec([1, 0, 0, 0]));
  idx.add("aaaaabbbbbcccccdddddeeeee", unitVec([0, 1, 0, 0]));
  assertEquals(idx.size, 1);
});

Deno.test("HnswIndex: search returns closest vector first", () => {
  const idx = HnswIndex.create(DIM, 16);
  const hashA = "aaaaabbbbbcccccdddddeeeee";
  const hashB = "fffffggggghhhhhjjjjjkkkkk";
  idx.add(hashA, unitVec([1, 0, 0, 0]));
  idx.add(hashB, unitVec([0, 1, 0, 0]));

  // Query close to A
  const results = idx.search(unitVec([0.99, 0.01, 0, 0]), 2);
  assertEquals(results.length, 2);
  assertEquals(results[0].hash, hashA);
  assertEquals(results[0].score > results[1].score, true);
});

Deno.test("HnswIndex: search score is in [-1, 1] range", () => {
  const idx = HnswIndex.create(DIM, 16);
  idx.add("aaaaabbbbbcccccdddddeeeee", unitVec([1, 0, 0, 0]));
  const [hit] = idx.search(unitVec([1, 0, 0, 0]), 1);
  assertEquals(hit.score >= -1 && hit.score <= 1, true);
});

Deno.test("HnswIndex: k capped at available items", () => {
  const idx = HnswIndex.create(DIM, 16);
  idx.add("aaaaabbbbbcccccdddddeeeee", unitVec([1, 0, 0, 0]));
  const results = idx.search(unitVec([1, 0, 0, 0]), 10);
  assertEquals(results.length, 1);
});

Deno.test("HnswIndex: capacity expansion preserves existing vectors", () => {
  const idx = HnswIndex.create(DIM, 4);
  const hashes = Array.from(
    { length: 10 },
    (_, i) => `aaaaa${String(i).padStart(20, "0")}`,
  );
  for (const h of hashes) {
    idx.add(
      h,
      unitVec([Math.random(), Math.random(), Math.random(), Math.random()]),
    );
  }
  assertEquals(idx.size, 10);
  // All hashes should still be findable
  const results = idx.search(unitVec([1, 0, 0, 0]), 10);
  assertEquals(results.length, 10);
});
