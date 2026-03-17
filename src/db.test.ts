import { assertEquals, assertNotEquals } from "@std/assert";
import { EmbeddingStore } from "./db.ts";

function makeStore(): EmbeddingStore {
  return new EmbeddingStore(":memory:");
}

function vec(values: number[]): Float32Array {
  return new Float32Array(values);
}

Deno.test("EmbeddingStore: upsert and get round-trip", () => {
  const store = makeStore();
  const v = vec([0.1, 0.2, 0.3]);
  store.upsert("aaaaabbbbbcccccdddddeeeee", "test description", v);
  const result = store.get("aaaaabbbbbcccccdddddeeeee");
  assertEquals(result?.description, "test description");
  assertEquals(result?.vector.length, 3);
  assertEquals(result?.vector[0], v[0]);
  assertEquals(result?.vector[2], v[2]);
  store.close();
});

Deno.test("EmbeddingStore: get returns null for missing hash", () => {
  const store = makeStore();
  assertEquals(store.get("aaaaabbbbbcccccdddddeeeee"), null);
  store.close();
});

Deno.test("EmbeddingStore: getDescription returns text only", () => {
  const store = makeStore();
  store.upsert("aaaaabbbbbcccccdddddeeeee", "hello world", vec([1, 2]));
  assertEquals(
    store.getDescription("aaaaabbbbbcccccdddddeeeee"),
    "hello world",
  );
  assertEquals(store.getDescription("zzzzzbbbbbcccccdddddeeeee"), null);
  store.close();
});

Deno.test("EmbeddingStore: hasHash", () => {
  const store = makeStore();
  assertEquals(store.hasHash("aaaaabbbbbcccccdddddeeeee"), false);
  store.upsert("aaaaabbbbbcccccdddddeeeee", "desc", vec([1]));
  assertEquals(store.hasHash("aaaaabbbbbcccccdddddeeeee"), true);
  store.close();
});

Deno.test("EmbeddingStore: getAll returns all vectors", () => {
  const store = makeStore();
  store.upsert("aaaaabbbbbcccccdddddeeeee", "one", vec([0.1, 0.2]));
  store.upsert("fffffggggghhhhhjjjjjkkkkk", "two", vec([0.3, 0.4]));
  const all = store.getAll();
  assertEquals(all.size, 2);
  assertEquals(all.has("aaaaabbbbbcccccdddddeeeee"), true);
  assertEquals(all.has("fffffggggghhhhhjjjjjkkkkk"), true);
  store.close();
});

Deno.test("EmbeddingStore: upsert is idempotent", () => {
  const store = makeStore();
  store.upsert("aaaaabbbbbcccccdddddeeeee", "first", vec([1, 0]));
  store.upsert("aaaaabbbbbcccccdddddeeeee", "second", vec([0, 1]));
  const result = store.get("aaaaabbbbbcccccdddddeeeee");
  assertEquals(result?.description, "second");
  assertNotEquals(result?.vector[0], 1);
  store.close();
});
