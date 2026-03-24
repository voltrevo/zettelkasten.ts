import { assertEquals, assertRejects } from "@std/assert";
import { type CheckerHandle, startChecker } from "./checker.ts";
import { checkEmbeddingService, defaultEmbedConfig } from "./embed.ts";
import { type ServerHandle, startServer } from "./server.ts";
import { ApiError, createBearerClient } from "./api-client.ts";

const DEV_TOKEN = "test-dev";
const ADMIN_TOKEN = "test-admin";
const TMP_DIR = "/tmp/zts-test";
const SKIP_EMBED = Deno.env.get("ZTS_SKIP_EMBED") === "1";
const VERBOSE = Deno.env.get("ZTS_TEST_VERBOSE") === "1";

function log(...args: unknown[]) {
  if (VERBOSE) console.log("  [test]", ...args);
}

const FAST = 50; // ms — non-embed, non-subprocess steps
const EMBED = 3000; // ms — steps that generate embeddings via Ollama
const SUBPROCESS = 2000; // ms — steps that spawn deno subprocesses

function timed(
  t: Deno.TestContext,
  name: string,
  fn: () => Promise<void>,
  timeoutMs = FAST,
) {
  return t.step(name, async () => {
    const start = performance.now();
    await fn();
    const elapsed = performance.now() - start;
    if (elapsed > timeoutMs) {
      throw new Error(
        `step "${name}" took ${Math.round(elapsed)}ms, limit ${timeoutMs}ms`,
      );
    }
  });
}

Deno.test("integration: full workflow", async (t) => {
  await Deno.mkdir(TMP_DIR, { recursive: true });

  const embedAvailable = !SKIP_EMBED &&
    await checkEmbeddingService(defaultEmbedConfig());

  log("embeddings:", embedAvailable ? "available" : "skipped");

  const checkerHandle: CheckerHandle = startChecker({
    port: 0,
    hostname: "127.0.0.1",
  });
  log(`checker started on port ${checkerHandle.port}`);

  const handle: ServerHandle = startServer({
    port: 0,
    hostname: "127.0.0.1",
    dbPath: ":memory:",
    devToken: DEV_TOKEN,
    adminToken: ADMIN_TOKEN,
    serverUrl: "http://127.0.0.1:0", // updated below after port is known
    checkerUrl: `http://127.0.0.1:${checkerHandle.port}`,
    skipEmbedCheck: true,
  });

  log(`server started on port ${handle.port}`);

  const client = createBearerClient(
    `http://localhost:${handle.port}`,
    { dev: DEV_TOKEN, admin: ADMIN_TOKEN },
    Deno,
    { tmpDir: TMP_DIR },
  );

  const unauthClient = createBearerClient(
    `http://localhost:${handle.port}`,
    {},
  );

  const devOnlyClient = createBearerClient(
    `http://localhost:${handle.port}`,
    { dev: DEV_TOKEN },
  );

  let atomHash = "";
  let atom2Hash = "";

  function importPath(hash: string): string {
    return `../../${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash.slice(4)}.ts`;
  }

  try {
    await timed(t, "empty corpus status", async () => {
      const s = await client.getStatus();
      log("status:", JSON.stringify(s));
      assertEquals(s.totalAtoms, 0);
      assertEquals(s.defects, 0);
    });

    await timed(t, "create goal", async () => {
      const g = await client.createGoal("test-goal", {
        weight: 2,
        body: "Integration test goal",
      });
      assertEquals(g.name, "test-goal");
      assertEquals(g.weight, 2);
    });

    await timed(t, "list goals", async () => {
      const goals = await client.listGoals();
      assertEquals(goals.length, 1);
      assertEquals(goals[0].name, "test-goal");
    });

    await timed(t, "draft atom", async () => {
      const source =
        `// Adds two numbers and returns the sum\nexport function add(a: number, b: number): number { return a + b; }\n`;
      const draftResult = await client.draft(source);
      atomHash = draftResult.hash;
      log("drafted atom:", atomHash, "existing:", draftResult.existing);
      assertEquals(atomHash.length, 25);
      assertEquals(/^[a-z0-9]+$/.test(atomHash), true);
      assertEquals(draftResult.existing, false);
    });

    await timed(t, "draft rejects minified code", async () => {
      const minified =
        `// minified atom\nexport function f(a:number,b:number):number{const c=a+b;const d=c*2;if(d>10){return d-10;}else{return d+10;}}\n`;
      await assertRejects(
        () => client.draft(minified),
        ApiError,
        "minified",
      );
    }, SUBPROCESS);

    let readableOverrideHash = "";
    await timed(
      t,
      "draft accepts minified code with readable override",
      async () => {
        const minified =
          `// minified atom\nexport function f(a:number,b:number):number{const c=a+b;const d=c*2;if(d>10){return d-10;}else{return d+10;}}\n`;
        const result = await client.draft(minified, { readable: true });
        assertEquals(result.hash.length, 25);
        readableOverrideHash = result.hash;
      },
      SUBPROCESS,
    );

    await timed(t, "list drafts shows unpublished atom", async () => {
      const drafts = await client.listDrafts();
      log("drafts:", drafts.map((d) => d.hash.slice(0, 8) + "…"));
      assertEquals(drafts.length, 2);
      assertEquals(drafts.some((d) => d.hash === atomHash), true);
      assertEquals(drafts.some((d) => d.hash === readableOverrideHash), true);
    });

    let _addTestHash = "";

    await timed(t, "add test to draft target", async () => {
      const testSource =
        `// Tests that add returns the sum of two numbers\nexport class Test {\n  static name = "add: basic addition";\n  run(target: (a: number, b: number) => number): void {\n    if (target(2, 3) !== 5) throw new Error("expected 5");\n  }\n}\n`;
      const result = await client.addTest(testSource, [atomHash]);
      _addTestHash = result.hash;
      log("addTest result:", {
        hash: result.hash,
        testName: result.testName,
        results: result.results,
      });
      assertEquals(result.hash.length, 25);
      assertEquals(result.testName, "add: basic addition");
      assertEquals(result.results.length, 1);
      assertEquals(result.results[0].target, atomHash);
      assertEquals(result.results[0].passed, true);
    }, SUBPROCESS);

    await timed(t, "publish atom with test", async () => {
      const pubResult = await client.publish(atomHash, {
        description: "Adds two numbers and returns the sum",
        goal: "test-goal",
      });
      log("published atom:", pubResult.hash);
      assertEquals(pubResult.hash, atomHash);
    }, EMBED);

    await timed(
      t,
      "publish rejects insufficient coverage",
      async () => {
        // Draft an atom with a branch
        const src =
          `// Classify number\nexport function classify(n: number): string {\n  if (n > 0) { return "positive"; }\n  if (n < 0) { return "negative"; }\n  return "zero";\n}\n`;
        const d = await client.draft(src);
        // Test that only covers one branch
        const partial =
          `export class Test {\n  static name = "classify: positive";\n  run(classify: (n: number) => string): void {\n    if (classify(5) !== "positive") throw new Error("fail");\n  }\n}\n`;
        await client.addTest(partial, [d.hash]);
        // Publish should fail — missing coverage on negative and zero branches
        await assertRejects(
          () => client.publish(d.hash, { description: "classify number" }),
          ApiError,
          "coverage",
        );
        log("insufficient coverage rejected as expected");
        // Clean up: remove test relationships, then both atoms
        const rels = await client.queryRelationships({ to: d.hash });
        for (const rel of rels) {
          await client.removeRelationship(rel.from, rel.kind, rel.to);
          await client.deleteAtom(rel.from);
        }
        await client.deleteAtom(d.hash);
      },
      SUBPROCESS * 2,
    );

    await timed(
      t,
      "publish succeeds with full coverage",
      async () => {
        const src =
          `// Classify number\nexport function classify(n: number): string {\n  if (n > 0) { return "positive"; }\n  if (n < 0) { return "negative"; }\n  return "zero";\n}\n`;
        const d = await client.draft(src);
        // Full coverage test
        const full =
          `export class Test {\n  static name = "classify: all branches";\n  run(classify: (n: number) => string): void {\n    if (classify(5) !== "positive") throw new Error("pos");\n    if (classify(-3) !== "negative") throw new Error("neg");\n    if (classify(0) !== "zero") throw new Error("zero");\n  }\n}\n`;
        await client.addTest(full, [d.hash]);
        const result = await client.publish(d.hash, {
          description: "classify number",
        });
        assertEquals(result.hash, d.hash);
        log("full coverage publish succeeded");
        // Clean up
        const rels = await client.queryRelationships({ to: d.hash });
        for (const rel of rels) {
          await client.removeRelationship(rel.from, rel.kind, rel.to);
          await client.deleteAtom(rel.from);
        }
        await client.deleteAtom(d.hash);
      },
      SUBPROCESS * 2,
    );

    await timed(
      t,
      "publish rejects missed branch (ternary)",
      async () => {
        // Ternary: both branches on one line, test only exercises one
        const src =
          `// Absolute value via ternary\nexport function abs(n: number): number {\n  const result = n < 0 ? -n : n;\n  return result;\n}\n`;
        const d = await client.draft(src);
        const partial =
          `export class Test {\n  static name = "abs: positive only";\n  run(abs: (n: number) => number): void {\n    if (abs(5) !== 5) throw new Error("fail");\n  }\n}\n`;
        await client.addTest(partial, [d.hash]);
        await assertRejects(
          () => client.publish(d.hash, { description: "abs" }),
          ApiError,
          "coverage",
        );
        log("missed branch (ternary) rejected as expected");
        const rels = await client.queryRelationships({ to: d.hash });
        for (const rel of rels) {
          await client.removeRelationship(rel.from, rel.kind, rel.to);
          await client.deleteAtom(rel.from);
        }
        await client.deleteAtom(d.hash);
      },
      SUBPROCESS * 2,
    );

    await timed(t, "archive a draft", async () => {
      const tmpSource =
        `// Temporary atom for archive test\nexport const TMP = 42;\n`;
      const draftResult = await client.draft(tmpSource);
      const tmpHash = draftResult.hash;
      log("drafted tmp atom:", tmpHash);

      // Verify it shows in drafts
      const drafts = await client.listDrafts();
      const found = drafts.some((d) => d.hash === tmpHash);
      assertEquals(found, true);

      // Archive it
      await client.archive(tmpHash);

      // Verify it no longer shows in drafts
      const draftsAfter = await client.listDrafts();
      const foundAfter = draftsAfter.some((d) => d.hash === tmpHash);
      assertEquals(foundAfter, false);
    });

    await timed(t, "get atom source", async () => {
      const src = await client.getAtom(atomHash);
      assertEquals(src.includes("export function add"), true);
    });

    await timed(t, "draft applies deno fmt to stored source", async () => {
      // Slightly ugly but under the 10% minification threshold
      const ugly =
        `// fmt test atom\nexport function fmtTest(a: number,b: number): number {\nreturn a+b;\n}\n`;
      const result = await client.draft(ugly);
      const stored = await client.getAtom(result.hash);
      // deno fmt adds space after comma and around +
      assertEquals(stored.includes("a: number, b: number"), true);
      assertEquals(stored.includes("return a + b"), true);
      await client.archive(result.hash);
    }, SUBPROCESS);

    await timed(t, "atom info", async () => {
      const info = await client.info(atomHash);
      log("info:", {
        hash: info.hash,
        desc: info.description,
        goal: info.goal,
        imports: info.imports,
        importedBy: info.importedBy,
        tests: info.tests,
      });
      assertEquals(info.hash, atomHash);
      assertEquals(info.description, "Adds two numbers and returns the sum");
      assertEquals(info.goal, "test-goal");
      assertEquals(info.imports.length, 0);
    });

    await timed(t, "recent atoms", async () => {
      const atoms = await client.recent();
      log(
        "recent:",
        atoms.map((a) =>
          `${a.hash.slice(0, 8)}… ${a.description.slice(0, 40)}`
        ),
      );
      // atomHash + _addTestHash (auto-published with target)
      assertEquals(atoms.length >= 1, true);
      const hashes = atoms.map((a) => a.hash);
      assertEquals(hashes.includes(atomHash), true);
    });

    await timed(t, "goal list includes atomCount", async () => {
      const goals = await client.listGoals();
      const testGoal = goals.find((g) => g.name === "test-goal");
      log("test-goal atomCount:", testGoal?.atomCount);
      assertEquals(testGoal?.atomCount, 1);
    });

    await timed(t, "recent filtered by goal", async () => {
      const match = await client.recent({ goal: "test-goal" });
      assertEquals(match.length, 1);
      const noMatch = await client.recent({ goal: "other" });
      assertEquals(noMatch.length, 0);
    });

    await timed(t, "read description", async () => {
      const desc = await client.describeRead(atomHash);
      assertEquals(desc, "Adds two numbers and returns the sum");
    });

    if (embedAvailable) {
      await timed(t, "update description (embed)", async () => {
        await client.describeUpdate(
          atomHash,
          "Adds two integers and returns their sum",
        );
        const desc = await client.describeRead(atomHash);
        log("updated description:", desc);
        assertEquals(desc, "Adds two integers and returns their sum");
      }, EMBED);

      await timed(t, "semantic search (embed)", async () => {
        const results = await client.search("add numbers together", 5);
        log(
          "semantic search results:",
          results.map((r) =>
            `${r.hash.slice(0, 8)}… score=${r.score.toFixed(3)}`
          ),
        );
        assertEquals(results.length >= 1, true);
        assertEquals(results[0].hash, atomHash);
      }, EMBED);

      await timed(t, "similar atoms (embed)", async () => {
        const results = await client.similar(atomHash, 5);
        log("similar results:", results.length);
        assertEquals(Array.isArray(results), true);
      });
    }

    await timed(t, "code search", async () => {
      const results = await client.searchCode("function add");
      log(
        "code search results:",
        results.map((r) =>
          `${r.hash.slice(0, 8)}… snippet=${r.snippet?.slice(0, 50)}`
        ),
      );
      assertEquals(results.length >= 1, true);
      assertEquals(results[0].hash, atomHash);
    });

    await timed(t, "draft and publish second atom", async () => {
      const source =
        `// The mathematical constant pi\nexport const PI = 3.14159;\n`;
      const draftResult = await client.draft(source);
      atom2Hash = draftResult.hash;
      // Add a simple test
      const testSrc =
        `export class Test {\n  static name = "PI is approximately 3.14";\n  run(PI: number): void {\n    if (Math.abs(PI - 3.14159) > 0.001) throw new Error("wrong PI");\n  }\n}\n`;
      await client.addTest(testSrc, [atom2Hash]);
      await client.publish(atom2Hash, {
        description: "The mathematical constant pi",
      });
      log("posted atom2:", atom2Hash);
      const atoms = await client.recent({ n: 10 });
      assertEquals(atoms.length >= 2, true);
    }, EMBED);

    await timed(t, "properties: set, list, unset", async () => {
      await client.setProperty(atomHash, "starred");
      const props = await client.listProperties(atomHash);
      log("properties after set:", props);
      assertEquals(props.length, 1);
      assertEquals(props[0].key, "starred");

      await client.unsetProperty(atomHash, "starred");
      const empty = await client.listProperties(atomHash);
      log("properties after unset:", empty);
      assertEquals(empty.length, 0);
    });

    await timed(t, "relationships: add, query, remove", async () => {
      await client.addRelationship(atom2Hash, "supersedes", atomHash);
      const rels = await client.queryRelationships({ from: atom2Hash });
      log(
        "relationships:",
        rels.map((r) =>
          `${r.from.slice(0, 8)}… --${r.kind}--> ${r.to.slice(0, 8)}…`
        ),
      );
      assertEquals(rels.length, 1);
      assertEquals(rels[0].kind, "supersedes");
      assertEquals(rels[0].to, atomHash);

      await client.removeRelationship(atom2Hash, "supersedes", atomHash);
      const empty = await client.queryRelationships({ from: atom2Hash });
      assertEquals(empty.length, 0);
    });

    await timed(t, "dependents", async () => {
      await client.addRelationship(atom2Hash, "imports", atomHash);
      const deps = await client.dependents(atomHash);
      assertEquals(deps.length, 1);
      assertEquals(deps[0], atom2Hash);
      await client.removeRelationship(atom2Hash, "imports", atomHash);
    });

    await timed(t, "tops", async () => {
      const tops = await client.tops(atomHash);
      assertEquals(tops.length, 1);
      assertEquals(tops[0].hash, atomHash);
      assertEquals(tops[0].depth, 0);
    });

    await timed(t, "test evaluation CRUD", async () => {
      await client.setTestEvaluation({
        test: atom2Hash,
        target: atomHash,
        expectedOutcome: "pass",
      });
      const ev = await client.getTestEvaluation(atom2Hash, atomHash);
      log("eval after set:", ev);
      assertEquals(ev?.expectedOutcome, "pass");

      await client.updateTestEvaluation({
        test: atom2Hash,
        target: atomHash,
        commentary: "works great",
      });
      const updated = await client.getTestEvaluation(atom2Hash, atomHash);
      log("eval after update:", updated);
      assertEquals(updated?.commentary, "works great");
    });

    await timed(t, "goal comments", async () => {
      await client.addGoalComment("test-goal", "first observation");
      const comments = await client.getGoalComments("test-goal");
      assertEquals(comments.length, 1);
      assertEquals(comments[0].body, "first observation");

      await client.deleteGoalComment("test-goal", comments[0].id);
      const empty = await client.getGoalComments("test-goal");
      assertEquals(empty.length, 0);
    });

    await timed(t, "mark goal done requires DONE: comment", async () => {
      log("attempting markGoalDone without DONE: comment...");
      await assertRejects(
        () => client.markGoalDone("test-goal"),
        ApiError,
      );
      log("correctly rejected");
      await client.addGoalComment("test-goal", "DONE: integration test passed");
      await client.markGoalDone("test-goal");
      const goal = await client.getGoal("test-goal");
      log("goal after done:", { name: goal.name, done: goal.done });
      assertEquals(goal.done, true);

      await client.markGoalUndone("test-goal");
      const undone = await client.getGoal("test-goal");
      log("goal after undone:", { name: undone.name, done: undone.done });
      assertEquals(undone.done, false);
    });

    await timed(t, "prompts: get, set, reset", async () => {
      const def = await client.getPrompt("prompt");
      log("default prompt source:", def.source, "length:", def.text.length);
      assertEquals(def.source, "default");
      assertEquals(def.text.length > 0, true);

      await client.setPrompt("prompt", "custom prompt");
      const over = await client.getPrompt("prompt");
      log("override prompt source:", over.source, "text:", over.text);
      assertEquals(over.source, "override");
      assertEquals(over.text, "custom prompt");

      await client.resetPrompt("prompt");
      const reset = await client.getPrompt("prompt");
      log("after reset source:", reset.source);
      assertEquals(reset.source, "default");
    });

    await timed(t, "log entries", async () => {
      const logs = await client.getLog({ recent: 50 });
      log(
        "log entries:",
        logs.length,
        "ops:",
        [...new Set(logs.map((l) => l.op))].join(", "),
      );
      assertEquals(logs.length > 0, true);
      const draftLogs = logs.filter((l) => l.op === "atom.draft");
      assertEquals(draftLogs.length >= 1, true);
      const publishLogs = logs.filter((l) => l.op === "atom.publish");
      assertEquals(publishLogs.length >= 1, true);
    });

    await timed(t, "delete atom", async () => {
      // Remove test relationships first
      const testRels = await client.queryRelationships({
        to: atom2Hash,
        kind: "tests",
      });
      for (const rel of testRels) {
        await client.removeRelationship(rel.from, "tests", atom2Hash);
        try {
          await client.deleteAtom(rel.from);
        } catch { /* may have other rels */ }
      }
      await client.deleteAtom(atom2Hash);
      await assertRejects(
        () => client.getAtom(atom2Hash),
        ApiError,
      );
    });

    await timed(t, "status reflects changes", async () => {
      const s = await client.getStatus();
      // atomHash + _addTestHash remain (atom2Hash deleted)
      assertEquals(s.totalAtoms >= 2, true);
    });

    await timed(t, "hash prefix resolution", async () => {
      const info = await client.info(atomHash.slice(0, 6));
      assertEquals(info.hash, atomHash);
    });

    // ---- Auth tier enforcement ----

    await timed(t, "unauthed reads work", async () => {
      const src = await unauthClient.getAtom(atomHash);
      assertEquals(src.includes("export function add"), true);
    });

    await timed(t, "unauthed writes rejected", async () => {
      await assertRejects(
        () => unauthClient.draft("export const x = 1;\n"),
        ApiError,
      );
    });

    await timed(t, "dev token cannot create goals", async () => {
      await assertRejects(
        () => devOnlyClient.createGoal("dev-goal"),
        ApiError,
      );
    });

    await timed(t, "dev token cannot set admin-only property", async () => {
      await assertRejects(
        () => devOnlyClient.setProperty(atomHash, "starred"),
        ApiError,
      );
    });

    await timed(t, "dev token can set non-admin property", async () => {
      await devOnlyClient.setProperty(atomHash, "category", "math");
      const props = await client.listProperties(atomHash);
      log("dev-set property:", props);
      const cat = props.find((p) => p.key === "category");
      assertEquals(cat?.value, "math");
      await client.unsetProperty(atomHash, "category");
    });

    await timed(t, "dev token cannot set prompt override", async () => {
      await assertRejects(
        () => devOnlyClient.setPrompt("context", "hacked"),
        ApiError,
      );
    });

    // ---- Idempotent draft ----

    await timed(
      t,
      "draft of already-published content returns 409",
      async () => {
        const source =
          `// Adds two numbers and returns the sum\nexport function add(a: number, b: number): number { return a + b; }\n`;
        await assertRejects(
          () => client.draft(source),
          ApiError,
        );
      },
    );

    await timed(t, "idempotent draft of same draft content", async () => {
      const source = `// Temp atom\nexport const temp = 42;\n`;
      const first = await client.draft(source);
      const second = await client.draft(source);
      assertEquals(second.hash, first.hash);
      assertEquals(second.existing, true);
      // Clean up
      await client.archive(first.hash);
    });

    // ---- Multi-atom dependency tree ----

    let depAtomHash = "";

    await timed(t, "draft and publish atom that imports another", async () => {
      const source = `// Doubles using add\nimport { add } from "${
        importPath(atomHash)
      }";\nexport function double(n: number): number { return add(n, n); }\n`;
      const draftResult = await client.draft(source);
      depAtomHash = draftResult.hash;
      // Add a test for the double function
      const testSrc =
        `export class Test {\n  static name = "double(5) returns 10";\n  run(double: (n: number) => number): void {\n    if (double(5) !== 10) throw new Error("expected 10");\n  }\n}\n`;
      await client.addTest(testSrc, [depAtomHash]);
      await client.publish(depAtomHash, {
        description: "Doubles a number using add",
      });
      log("posted dep atom:", depAtomHash, "imports:", atomHash);
      assertEquals(depAtomHash.length, 25);
    }, EMBED);

    await timed(t, "info shows imports and importedBy", async () => {
      const depInfo = await client.info(depAtomHash);
      log(
        "dep info imports:",
        depInfo.imports,
        "importedBy:",
        depInfo.importedBy,
      );
      assertEquals(depInfo.imports.includes(atomHash), true);

      const baseInfo = await client.info(atomHash);
      log("base info importedBy:", baseInfo.importedBy);
      assertEquals(baseInfo.importedBy.includes(depAtomHash), true);
    });

    await timed(t, "delete atom with relationships rejected", async () => {
      log("attempting delete of atom with incoming import...");
      await assertRejects(() => client.deleteAtom(atomHash), ApiError);
      log("correctly rejected (incoming)");
      log("attempting delete of atom with outgoing import...");
      await assertRejects(() => client.deleteAtom(depAtomHash), ApiError);
      log("correctly rejected (outgoing)");
    });

    await timed(t, "bundle with dependencies", async () => {
      const bundle = await client.getBundle(depAtomHash);
      log(
        "bundle size:",
        bundle.length,
        "bytes, magic:",
        `0x${bundle[0].toString(16)}${bundle[1].toString(16)}`,
      );
      assertEquals(bundle.length > 0, true);
      assertEquals(bundle[0], 0x50);
      assertEquals(bundle[1], 0x4b);
    });

    await timed(t, "delete succeeds after removing relationship", async () => {
      // Remove import relationship
      await client.removeRelationship(depAtomHash, "imports", atomHash);
      // Remove test relationships
      const testRels = await client.queryRelationships({
        to: depAtomHash,
        kind: "tests",
      });
      for (const rel of testRels) {
        await client.removeRelationship(rel.from, "tests", depAtomHash);
        try {
          await client.deleteAtom(rel.from);
        } catch { /* may have other rels */ }
      }
      await client.deleteAtom(depAtomHash);
      await assertRejects(() => client.getAtom(depAtomHash), ApiError);
    });

    // ---- Supersedes chain and tops ----

    let chainA = "";
    let chainB = "";
    let chainC = "";

    await timed(t, "supersedes chain: A <- B <- C", async () => { // 3 draft+test+publish cycles
      // Helper: draft a const, add test, publish
      async function draftTestPublish(
        src: string,
        testSrc: string,
        desc: string,
      ): Promise<string> {
        const d = await client.draft(src);
        await client.addTest(testSrc, [d.hash]);
        await client.publish(d.hash, { description: desc });
        return d.hash;
      }
      chainA = await draftTestPublish(
        `// Chain A\nexport const A = 1;\n`,
        `export class Test {\n  static name = "A is 1";\n  run(A: number): void { if (A !== 1) throw new Error("wrong"); }\n}\n`,
        "Chain constant A",
      );
      chainB = await draftTestPublish(
        `// Chain B\nexport const B = 2;\n`,
        `export class Test {\n  static name = "B is 2";\n  run(B: number): void { if (B !== 2) throw new Error("wrong"); }\n}\n`,
        "Chain constant B",
      );
      chainC = await draftTestPublish(
        `// Chain C\nexport const C = 3;\n`,
        `export class Test {\n  static name = "C is 3";\n  run(C: number): void { if (C !== 3) throw new Error("wrong"); }\n}\n`,
        "Chain constant C",
      );

      log(
        `chain: ${chainA.slice(0, 8)}… <- ${chainB.slice(0, 8)}… <- ${
          chainC.slice(0, 8)
        }…`,
      );
      await client.addRelationship(chainB, "supersedes", chainA);
      await client.addRelationship(chainC, "supersedes", chainB);
    }, SUBPROCESS * 3);

    await timed(t, "tops traverses supersedes chain", async () => {
      const tops = await client.tops(chainA);
      log(
        "tops from A:",
        tops.map((t) => `${t.hash.slice(0, 8)}… depth=${t.depth}`),
      );
      assertEquals(tops.length >= 1, true);
      const topHashes = tops.map((t) => t.hash);
      assertEquals(topHashes.includes(chainC), true);
    });

    await timed(t, "tops with limit", async () => {
      const tops = await client.tops(chainA, { limit: 1 });
      assertEquals(tops.length, 1);
    });

    await timed(t, "status shows superseded count", async () => {
      const s = await client.getStatus();
      log("status superseded:", s.superseded, "total:", s.totalAtoms);
      assertEquals(s.superseded >= 2, true);
    });

    // ---- Relationship validation ----

    await timed(t, "duplicate relationship is idempotent", async () => {
      // Already added chainB supersedes chainA — add again
      await client.addRelationship(chainB, "supersedes", chainA);
      const rels = await client.queryRelationships({
        from: chainB,
        kind: "supersedes",
      });
      assertEquals(rels.length, 1);
    });

    await timed(t, "query relationships requires filter", async () => {
      await assertRejects(
        () => client.queryRelationships({}),
        ApiError,
      );
    });

    // ---- Goal edge cases ----

    await timed(t, "duplicate goal rejected", async () => {
      await assertRejects(
        () => client.createGoal("test-goal"),
        ApiError,
      );
    });

    await timed(t, "get nonexistent goal returns 404", async () => {
      await assertRejects(
        () => client.getGoal("nonexistent"),
        ApiError,
      );
    });

    await timed(t, "update goal weight and body", async () => {
      await client.updateGoal("test-goal", {
        weight: 5,
        body: "updated body",
      });
      const g = await client.getGoal("test-goal");
      assertEquals(g.weight, 5);
      assertEquals(g.body, "updated body");
    });

    await timed(t, "list goals with done filter", async () => {
      await client.createGoal("done-goal", { weight: 1 });
      await client.addGoalComment("done-goal", "DONE: finished");
      await client.markGoalDone("done-goal");

      const doneOnly = await client.listGoals({ done: true });
      log("done goals:", doneOnly.map((g) => g.name));
      assertEquals(doneOnly.length, 1);
      assertEquals(doneOnly[0].name, "done-goal");

      const all = await client.listGoals({ all: true });
      log("all goals:", all.map((g) => `${g.name}${g.done ? " [done]" : ""}`));
      assertEquals(all.length >= 2, true);

      const active = await client.listGoals();
      log("active goals:", active.map((g) => g.name));
      const activeNames = active.map((g) => g.name);
      assertEquals(activeNames.includes("done-goal"), false);
    });

    await timed(t, "goal comments with recent limit", async () => {
      await client.addGoalComment("test-goal", "comment 1");
      await client.addGoalComment("test-goal", "comment 2");
      await client.addGoalComment("test-goal", "comment 3");

      const limited = await client.getGoalComments("test-goal", { recent: 2 });
      assertEquals(limited.length, 2);
    });

    // ---- Recent filtering ----

    await timed(t, "recent with n limit", async () => {
      const limited = await client.recent({ n: 2 });
      assertEquals(limited.length, 2);
    });

    await timed(t, "recent with prop filter", async () => {
      await client.setProperty(atomHash, "starred");
      const starred = await client.recent({ prop: "starred" });
      log("starred atoms:", starred.map((a) => a.hash.slice(0, 8) + "…"));
      assertEquals(starred.length, 1);
      assertEquals(starred[0].hash, atomHash);
      await client.unsetProperty(atomHash, "starred");
    });

    // ---- Log filtering ----

    await timed(t, "log filtered by subject", async () => {
      const logs = await client.getLog({ subject: atomHash });
      log(
        "logs for atom:",
        logs.map((l) => `${l.op} ${l.subject?.slice(0, 8)}…`),
      );
      assertEquals(logs.length >= 1, true);
      for (const l of logs) {
        assertEquals(l.subject, atomHash);
      }
    });

    await timed(t, "log with recent limit", async () => {
      const logs = await client.getLog({ recent: 1 });
      assertEquals(logs.length, 1);
    });

    // ---- Status details ----

    await timed(t, "status with future since shows zero recent", async () => {
      const s = await client.getStatus("2099-01-01");
      assertEquals(s.recentAtoms, 0);
    });

    await timed(t, "status goalStats", async () => {
      const s = await client.getStatus();
      log("goalStats:", s.goalStats);
      const goalStat = s.goalStats.find((g) => g.name === "test-goal");
      assertEquals(goalStat !== undefined, true);
      assertEquals(goalStat!.total >= 1, true);
    });

    // ---- Prompt edge cases ----

    await timed(t, "get all default prompts", async () => {
      for (const name of ["prompt", "retrospective"]) {
        const p = await client.getPrompt(name);
        assertEquals(p.source, "default");
        assertEquals(p.text.length > 0, true);
      }
    });

    await timed(t, "get default-only ignores override", async () => {
      await client.setPrompt("prompt", "override text");
      const def = await client.getPrompt("prompt", true);
      log(
        "default-only source:",
        def.source,
        "contains override?",
        def.text.includes("override text"),
      );
      assertEquals(def.source, "default");
      assertEquals(def.text.includes("override text"), false);

      const over = await client.getPrompt("prompt");
      log(
        "active prompt source:",
        over.source,
        "text:",
        over.text.slice(0, 30),
      );
      assertEquals(over.source, "override");
      assertEquals(over.text, "override text");

      await client.resetPrompt("prompt");
    });

    // ---- Delete nonexistent atom ----

    await timed(t, "delete nonexistent atom returns 404", async () => {
      await assertRejects(
        () => client.deleteAtom("zzzzzzzzzzzzzzzzzzzzzzzzz"),
        ApiError,
      );
    });

    // ---- Hash prefix edge cases ----

    await timed(t, "nonexistent prefix returns 404", async () => {
      await assertRejects(
        () => client.info("zzzzz"),
        ApiError,
      );
    });

    await timed(t, "single-char prefix is ambiguous", async () => {
      // With multiple atoms, a 1-char prefix should match multiple
      try {
        await client.info(atomHash.slice(0, 1));
        // If it resolved, the corpus only has one atom starting with that char
        // — that's fine, not an error
      } catch (e) {
        if (e instanceof ApiError) {
          // Either 400 (ambiguous) or 404 — both are acceptable
          assertEquals(e.status === 400 || e.status === 404, true);
        } else {
          throw e;
        }
      }
    });

    // ---- Test evaluation edge cases ----

    await timed(t, "get nonexistent test evaluation returns null", async () => {
      const ev = await client.getTestEvaluation(
        "aaaaaaaaaaaaaaaaaaaaaaaaa",
        "bbbbbbbbbbbbbbbbbbbbbbbbb",
      );
      assertEquals(ev, null);
    });

    // ---- Cleanup chain atoms ----

    await timed(
      t,
      "cleanup: remove chain relationships and atoms",
      async () => {
        // Remove supersedes relationships
        await client.removeRelationship(chainC, "supersedes", chainB);
        await client.removeRelationship(chainB, "supersedes", chainA);
        // Remove test relationships and test atoms for each chain atom
        for (const hash of [chainC, chainB, chainA]) {
          const rels = await client.queryRelationships({
            to: hash,
            kind: "tests",
          });
          for (const rel of rels) {
            await client.removeRelationship(rel.from, "tests", hash);
            try {
              await client.deleteAtom(rel.from);
            } catch { /* may have other relationships */ }
          }
          await client.deleteAtom(hash);
        }
      },
    );

    // ---- Scripting (last — slow due to subprocess) ----

    await timed(t, "script: inline type-checks and runs", async () => {
      const code = `const atoms = await zts.recent({ n: 1 });\n` +
        `if (atoms.length !== 1) throw new Error("expected 1 atom, got " + atoms.length);\n` +
        `if (!atoms[0].hash) throw new Error("missing hash");\n`;
      const result = await client.script(code);
      assertEquals(result.code, 0);
    }, SUBPROCESS);

    await timed(t, "script: file mode", async () => {
      const scriptPath = `${TMP_DIR}/file-script.ts`;
      await Deno.writeTextFile(
        scriptPath,
        `const s = await zts.getStatus();\nif (!s.totalAtoms && s.totalAtoms !== 0) throw new Error("bad status");\n`,
      );
      const result = await client.script(scriptPath, { file: true });
      assertEquals(result.code, 0);
    }, SUBPROCESS);

    await timed(t, "script: inline type error fails check", async () => {
      const result = await client.script(
        `const x: number = await zts.recent();\n`,
      );
      console.log(
        "  (type checking error above is expected — testing that bad scripts are rejected)",
      );
      assertEquals(result.code !== 0, true);
    }, SUBPROCESS);

    await timed(t, "scriptTypes returns type definitions", async () => {
      const types = await client.scriptTypes();
      assertEquals(types.includes("interface ZtsClient"), true);
      assertEquals(types.includes("interface AtomSummary"), true);
    });
  } finally {
    await Deno.remove(TMP_DIR, { recursive: true }).catch(() => {});
    await handle.shutdown();
    await checkerHandle.shutdown();
  }
});
