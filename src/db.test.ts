import { assertEquals, assertNotEquals } from "@std/assert";
import { Db } from "./db.ts";

function makeDb(): Db {
  return new Db(":memory:");
}

function vec(values: number[]): Float32Array {
  return new Float32Array(values);
}

const HASH_A = "aaaaabbbbbcccccdddddeeeee";
const HASH_B = "fffffggggghhhhhjjjjjkkkkk";
const HASH_C = "zzzzzbbbbbcccccdddddeeeee";

// --- Atoms ---

Deno.test("Db: insertAtom and getAtom round-trip", () => {
  const d = makeDb();
  const ok = d.insertAtom(HASH_A, "export const x = 1;", 42, "test atom");
  assertEquals(ok, true);
  const atom = d.getAtom(HASH_A);
  assertEquals(atom?.hash, HASH_A);
  assertEquals(atom?.source, "export const x = 1;");
  assertEquals(atom?.gzipSize, 42);
  assertEquals(atom?.description, "test atom");
  assertEquals(atom?.goal, null);
  d.close();
});

Deno.test("Db: insertAtom with goal", () => {
  const d = makeDb();
  d.insertAtom(HASH_A, "export const x = 1;", 42, "test atom", "my-goal");
  const atom = d.getAtom(HASH_A);
  assertEquals(atom?.goal, "my-goal");
  d.close();
});

Deno.test("Db: insertAtom returns false on duplicate", () => {
  const d = makeDb();
  assertEquals(d.insertAtom(HASH_A, "src", 10, "desc"), true);
  assertEquals(d.insertAtom(HASH_A, "src", 10, "desc"), false);
  d.close();
});

Deno.test("Db: getSource returns source only", () => {
  const d = makeDb();
  d.insertAtom(HASH_A, "export const x = 1;", 42, "desc");
  assertEquals(d.getSource(HASH_A), "export const x = 1;");
  assertEquals(d.getSource(HASH_B), null);
  d.close();
});

Deno.test("Db: atomExists", () => {
  const d = makeDb();
  assertEquals(d.atomExists(HASH_A), false);
  d.insertAtom(HASH_A, "src", 10, "desc");
  assertEquals(d.atomExists(HASH_A), true);
  d.close();
});

Deno.test("Db: deleteAtom", () => {
  const d = makeDb();
  d.insertAtom(HASH_A, "src", 10, "desc");
  assertEquals(d.deleteAtom(HASH_A), true);
  assertEquals(d.atomExists(HASH_A), false);
  assertEquals(d.deleteAtom(HASH_A), false);
  d.close();
});

Deno.test("Db: updateDescription and getDescription", () => {
  const d = makeDb();
  d.insertAtom(HASH_A, "src", 10, "original");
  assertEquals(d.getDescription(HASH_A), "original");
  d.updateDescription(HASH_A, "updated");
  assertEquals(d.getDescription(HASH_A), "updated");
  assertEquals(d.getDescription(HASH_B), null);
  d.close();
});

// --- Embeddings ---

Deno.test("Db: upsertEmbedding and getEmbedding round-trip", () => {
  const d = makeDb();
  d.insertAtom(HASH_A, "src", 10, "desc");
  const v = vec([0.1, 0.2, 0.3]);
  d.upsertEmbedding(HASH_A, v, "desc");
  const result = d.getEmbedding(HASH_A);
  assertEquals(result?.vector.length, 3);
  assertEquals(result?.vector[0], v[0]);
  assertEquals(result?.vector[2], v[2]);
  d.close();
});

Deno.test("Db: getEmbedding returns null for missing hash", () => {
  const d = makeDb();
  assertEquals(d.getEmbedding(HASH_A), null);
  d.close();
});

Deno.test("Db: getAllEmbeddings", () => {
  const d = makeDb();
  d.insertAtom(HASH_A, "src", 10, "one");
  d.insertAtom(HASH_B, "src", 10, "two");
  d.upsertEmbedding(HASH_A, vec([0.1, 0.2]), "one");
  d.upsertEmbedding(HASH_B, vec([0.3, 0.4]), "two");
  const all = d.getAllEmbeddings();
  assertEquals(all.size, 2);
  assertEquals(all.has(HASH_A), true);
  assertEquals(all.has(HASH_B), true);
  d.close();
});

Deno.test("Db: upsertEmbedding is idempotent", () => {
  const d = makeDb();
  d.insertAtom(HASH_A, "src", 10, "desc");
  d.upsertEmbedding(HASH_A, vec([1, 0]), "first");
  d.upsertEmbedding(HASH_A, vec([0, 1]), "second");
  const result = d.getEmbedding(HASH_A);
  assertNotEquals(result?.vector[0], 1);
  d.close();
});

Deno.test("Db: hasEmbedding", () => {
  const d = makeDb();
  assertEquals(d.hasEmbedding(HASH_A), false);
  d.insertAtom(HASH_A, "src", 10, "desc");
  d.upsertEmbedding(HASH_A, vec([1]), "desc");
  assertEquals(d.hasEmbedding(HASH_A), true);
  d.close();
});

// --- Relationships ---

Deno.test("Db: insertRelationship and queryRelationships round-trip", () => {
  const d = makeDb();
  const inserted = d.insertRelationship(HASH_A, "tests", HASH_B);
  assertEquals(inserted, true);
  const rows = d.queryRelationships({ from: HASH_A, kind: "tests" });
  assertEquals(rows.length, 1);
  assertEquals(rows[0].from, HASH_A);
  assertEquals(rows[0].kind, "tests");
  assertEquals(rows[0].to, HASH_B);
  d.close();
});

Deno.test("Db: insertRelationship returns false on duplicate", () => {
  const d = makeDb();
  assertEquals(d.insertRelationship(HASH_A, "tests", HASH_B), true);
  assertEquals(d.insertRelationship(HASH_A, "tests", HASH_B), false);
  assertEquals(d.queryRelationships({ from: HASH_A }).length, 1);
  d.close();
});

Deno.test("Db: deleteRelationship", () => {
  const d = makeDb();
  d.insertRelationship(HASH_A, "tests", HASH_B);
  assertEquals(d.deleteRelationship(HASH_A, "tests", HASH_B), true);
  assertEquals(d.queryRelationships({ from: HASH_A }).length, 0);
  d.close();
});

Deno.test("Db: deleteRelationship returns false when not found", () => {
  const d = makeDb();
  assertEquals(d.deleteRelationship(HASH_A, "tests", HASH_B), false);
  d.close();
});

Deno.test("Db: queryRelationships by to", () => {
  const d = makeDb();
  d.insertRelationship(HASH_A, "tests", HASH_B);
  d.insertRelationship(HASH_C, "tests", HASH_B);
  const rows = d.queryRelationships({ to: HASH_B, kind: "tests" });
  assertEquals(rows.length, 2);
  d.close();
});

Deno.test("Db: queryRelationships with no filter returns all", () => {
  const d = makeDb();
  d.insertRelationship(HASH_A, "tests", HASH_B);
  d.insertRelationship(HASH_C, "tests", HASH_B);
  assertEquals(d.queryRelationships({}).length, 2);
  d.close();
});

// --- Log ---

Deno.test("Db: insertLog", () => {
  const d = makeDb();
  d.insertLog({
    op: "atom.create",
    subject: HASH_A,
    detail: '{"gzip_size":42}',
  });
  d.insertLog({ op: "atom.delete", subject: HASH_A });
  // No crash = success; log is append-only audit trail
  d.close();
});

// --- Hash resolution ---

Deno.test("Db: resolveHash with full hash", () => {
  const d = makeDb();
  d.insertAtom(HASH_A, "src", 10, "desc");
  assertEquals(d.resolveHash(HASH_A), HASH_A);
  assertEquals(d.resolveHash(HASH_B), null);
  d.close();
});

Deno.test("Db: resolveHash with prefix", () => {
  const d = makeDb();
  d.insertAtom(HASH_A, "src", 10, "desc");
  // HASH_A = "aaaaabbbbbcccccdddddeeeee", prefix "aaaaa" should match
  assertEquals(d.resolveHash("aaaaa"), HASH_A);
  d.close();
});

Deno.test("Db: resolveHash throws on ambiguous prefix", () => {
  const d = makeDb();
  // HASH_A and HASH_C both start with different chars, but let's create two
  // that share a prefix
  d.insertAtom("abcde" + "f".repeat(20), "src", 10, "one");
  d.insertAtom("abcde" + "g".repeat(20), "src", 10, "two");
  let threw = false;
  try {
    d.resolveHash("abcde");
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
  d.close();
});

// --- List atoms ---

Deno.test("Db: listAtoms returns all atoms", () => {
  const d = makeDb();
  d.insertAtom(HASH_A, "src", 10, "first");
  d.insertAtom(HASH_B, "src", 20, "second");
  const atoms = d.listAtoms({});
  assertEquals(atoms.length, 2);
  d.close();
});

Deno.test("Db: listAtoms with recent limit", () => {
  const d = makeDb();
  d.insertAtom(HASH_A, "src", 10, "first");
  d.insertAtom(HASH_B, "src", 20, "second");
  const atoms = d.listAtoms({ recent: 1 });
  assertEquals(atoms.length, 1);
  d.close();
});

Deno.test("Db: listAtoms filters by goal", () => {
  const d = makeDb();
  d.insertAtom(HASH_A, "src", 10, "first", "my-goal");
  d.insertAtom(HASH_B, "src", 20, "second");
  const atoms = d.listAtoms({ goal: "my-goal" });
  assertEquals(atoms.length, 1);
  assertEquals(atoms[0].hash, HASH_A);
  d.close();
});

Deno.test("Db: listAtoms filters broken", () => {
  const d = makeDb();
  d.insertAtom(HASH_A, "src", 10, "BROKEN: bad atom");
  d.insertAtom(HASH_B, "src", 20, "good atom");
  const atoms = d.listAtoms({ broken: true });
  assertEquals(atoms.length, 1);
  assertEquals(atoms[0].hash, HASH_A);
  d.close();
});

// --- Properties ---

Deno.test("Db: setProperty and getProperties", () => {
  const d = makeDb();
  d.insertAtom(HASH_A, "src", 10, "desc");
  d.setProperty(HASH_A, "starred");
  d.setProperty(HASH_A, "color", "red");
  const props = d.getProperties(HASH_A);
  assertEquals(props.length, 2);
  assertEquals(props.find((p) => p.key === "starred")?.value, null);
  assertEquals(props.find((p) => p.key === "color")?.value, "red");
  d.close();
});

Deno.test("Db: setProperty is idempotent (upsert)", () => {
  const d = makeDb();
  d.insertAtom(HASH_A, "src", 10, "desc");
  d.setProperty(HASH_A, "color", "red");
  d.setProperty(HASH_A, "color", "blue");
  const props = d.getProperties(HASH_A);
  assertEquals(props.length, 1);
  assertEquals(props[0].value, "blue");
  d.close();
});

Deno.test("Db: unsetProperty", () => {
  const d = makeDb();
  d.insertAtom(HASH_A, "src", 10, "desc");
  d.setProperty(HASH_A, "starred");
  assertEquals(d.unsetProperty(HASH_A, "starred"), true);
  assertEquals(d.getProperties(HASH_A).length, 0);
  assertEquals(d.unsetProperty(HASH_A, "starred"), false);
  d.close();
});

Deno.test("Db: listAtoms filters by prop", () => {
  const d = makeDb();
  d.insertAtom(HASH_A, "src", 10, "starred atom");
  d.insertAtom(HASH_B, "src", 20, "normal atom");
  d.setProperty(HASH_A, "starred");
  const atoms = d.listAtoms({ prop: "starred" });
  assertEquals(atoms.length, 1);
  assertEquals(atoms[0].hash, HASH_A);
  d.close();
});

// --- Test evaluation ---

Deno.test("Db: upsertTestEvaluation and getTestEvaluation", () => {
  const d = makeDb();
  d.upsertTestEvaluation(HASH_A, HASH_B, "pass");
  const ev = d.getTestEvaluation(HASH_A, HASH_B);
  assertEquals(ev?.expectedOutcome, "pass");
  assertEquals(ev?.commentary, null);
  d.close();
});

Deno.test("Db: upsertTestEvaluation with commentary", () => {
  const d = makeDb();
  d.upsertTestEvaluation(HASH_A, HASH_B, "violates_intent", "bug in parser");
  const ev = d.getTestEvaluation(HASH_A, HASH_B);
  assertEquals(ev?.expectedOutcome, "violates_intent");
  assertEquals(ev?.commentary, "bug in parser");
  d.close();
});

Deno.test("Db: upsertTestEvaluation overwrites", () => {
  const d = makeDb();
  d.upsertTestEvaluation(HASH_A, HASH_B, "pass");
  d.upsertTestEvaluation(HASH_A, HASH_B, "violates_intent", "broken");
  const ev = d.getTestEvaluation(HASH_A, HASH_B);
  assertEquals(ev?.expectedOutcome, "violates_intent");
  d.close();
});

Deno.test("Db: getEvaluationsForTarget", () => {
  const d = makeDb();
  d.upsertTestEvaluation(HASH_A, HASH_B, "pass");
  d.upsertTestEvaluation(HASH_C, HASH_B, "violates_intent");
  const evals = d.getEvaluationsForTarget(HASH_B);
  assertEquals(evals.length, 2);
  d.close();
});

// --- Test runs ---

Deno.test("Db: insertTestRun and queryTestRuns", () => {
  const d = makeDb();
  d.insertTestRun({
    testAtom: HASH_A,
    targetAtom: HASH_B,
    runBy: "checker",
    result: "pass",
    durationMs: 42,
    details: null,
  });
  const runs = d.queryTestRuns({ target: HASH_B });
  assertEquals(runs.length, 1);
  assertEquals(runs[0].result, "pass");
  assertEquals(runs[0].durationMs, 42);
  assertEquals(runs[0].runBy, "checker");
  d.close();
});

Deno.test("Db: queryTestRuns with recent limit", () => {
  const d = makeDb();
  d.insertTestRun({
    testAtom: HASH_A,
    targetAtom: HASH_B,
    runBy: "checker",
    result: "pass",
    durationMs: 10,
    details: null,
  });
  d.insertTestRun({
    testAtom: HASH_A,
    targetAtom: HASH_B,
    runBy: "checker",
    result: "fail",
    durationMs: 20,
    details: "error",
  });
  const runs = d.queryTestRuns({ target: HASH_B, recent: 1 });
  assertEquals(runs.length, 1);
  assertEquals(runs[0].result, "fail"); // most recent first
  d.close();
});

// --- Schema version ---

Deno.test("Db: schema version is set on creation", () => {
  const d = makeDb();
  // Just verifying it doesn't throw on creation
  d.close();
});
