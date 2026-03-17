import { assertEquals, assertNotEquals } from "@std/assert";
import { EmbeddingStore, RelationshipStore } from "./db.ts";

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

// RelationshipStore tests

const TEST_HASH = "aaaaabbbbbcccccdddddeeeee";
const TARGET_HASH = "fffffggggghhhhhjjjjjkkkkk";
const OTHER_HASH = "zzzzzbbbbbcccccdddddeeeee";

function makeRelStore(): RelationshipStore {
  return new RelationshipStore(":memory:");
}

Deno.test("RelationshipStore: insert and query round-trip", () => {
  const store = makeRelStore();
  const inserted = store.insert(TEST_HASH, "tests", TARGET_HASH);
  assertEquals(inserted, true);
  const rows = store.query({ from: TEST_HASH, kind: "tests" });
  assertEquals(rows.length, 1);
  assertEquals(rows[0].from, TEST_HASH);
  assertEquals(rows[0].kind, "tests");
  assertEquals(rows[0].to, TARGET_HASH);
  store.close();
});

Deno.test("RelationshipStore: insert returns false on duplicate", () => {
  const store = makeRelStore();
  assertEquals(store.insert(TEST_HASH, "tests", TARGET_HASH), true);
  assertEquals(store.insert(TEST_HASH, "tests", TARGET_HASH), false);
  // only one row stored
  assertEquals(store.query({ from: TEST_HASH }).length, 1);
  store.close();
});

Deno.test("RelationshipStore: delete removes relationship", () => {
  const store = makeRelStore();
  store.insert(TEST_HASH, "tests", TARGET_HASH);
  assertEquals(store.delete(TEST_HASH, "tests", TARGET_HASH), true);
  assertEquals(store.query({ from: TEST_HASH }).length, 0);
  store.close();
});

Deno.test("RelationshipStore: delete returns false when not found", () => {
  const store = makeRelStore();
  assertEquals(store.delete(TEST_HASH, "tests", TARGET_HASH), false);
  store.close();
});

Deno.test("RelationshipStore: query by to", () => {
  const store = makeRelStore();
  store.insert(TEST_HASH, "tests", TARGET_HASH);
  store.insert(OTHER_HASH, "tests", TARGET_HASH);
  const rows = store.query({ to: TARGET_HASH, kind: "tests" });
  assertEquals(rows.length, 2);
  store.close();
});

Deno.test("RelationshipStore: query with no filter returns all rows", () => {
  const store = makeRelStore();
  store.insert(TEST_HASH, "tests", TARGET_HASH);
  store.insert(OTHER_HASH, "tests", TARGET_HASH);
  assertEquals(store.query({}).length, 2);
  store.close();
});
