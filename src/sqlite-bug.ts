// Narrowing: when exactly does rebuild stop working?

import { Database } from "@db/sqlite";

async function forkExec() {
  await new Deno.Command(Deno.execPath(), {
    args: ["eval", "0"],
    stdin: "null",
    stdout: "null",
    stderr: "null",
  }).output();
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function makeDb(): Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE docs (id INTEGER PRIMARY KEY, body TEXT);
    CREATE VIRTUAL TABLE docs_fts USING fts5(body, content=docs, content_rowid=id);
    CREATE TRIGGER docs_ins AFTER INSERT ON docs BEGIN
      INSERT INTO docs_fts(rowid, body) VALUES (NEW.rowid, NEW.body);
    END;
    CREATE TRIGGER docs_del AFTER DELETE ON docs BEGIN
      INSERT INTO docs_fts(docs_fts, rowid, body) VALUES('delete', OLD.rowid, OLD.body);
    END;
  `);
  db.exec("INSERT INTO docs_fts(docs_fts) VALUES('rebuild')");
  return db;
}

// Insert BEFORE fork, delete AFTER fork — this worked in earlier tests
Deno.test("insert before fork, delete after: single cycle", async () => {
  const db = makeDb();
  db.exec("INSERT INTO docs (body) VALUES ('aaa')");
  await forkExec();
  db.exec("DELETE FROM docs WHERE id = 1");
  const n =
    (db.prepare("SELECT count(*) as n FROM docs_fts WHERE docs_fts MATCH 'aaa'")
      .get() as { n: number }).n;
  assert(n === 0, `expected 0, got ${n}`);
  console.log("OK");
  db.close();
});

// Insert AFTER fork, delete after ANOTHER fork
Deno.test("insert after fork, delete after second fork", async () => {
  const db = makeDb();
  await forkExec();
  db.exec("INSERT INTO docs (body) VALUES ('bbb')");
  await forkExec();
  db.exec("INSERT INTO docs_fts(docs_fts) VALUES('rebuild')");
  db.exec("DELETE FROM docs WHERE id = 1");
  const n =
    (db.prepare("SELECT count(*) as n FROM docs_fts WHERE docs_fts MATCH 'bbb'")
      .get() as { n: number }).n;
  assert(n === 0, `expected 0, got ${n}`);
  console.log("OK");
  db.close();
});

// Insert after fork, delete after same fork (no second fork)
Deno.test("insert after fork, delete after same fork (no second fork)", async () => {
  const db = makeDb();
  await forkExec();
  db.exec("INSERT INTO docs (body) VALUES ('ccc')");
  db.exec("INSERT INTO docs_fts(docs_fts) VALUES('rebuild')");
  db.exec("DELETE FROM docs WHERE id = 1");
  const n =
    (db.prepare("SELECT count(*) as n FROM docs_fts WHERE docs_fts MATCH 'ccc'")
      .get() as { n: number }).n;
  assert(n === 0, `expected 0, got ${n}`);
  console.log("OK");
  db.close();
});

// Two inserts, fork between them, delete both after rebuild
Deno.test("insert, fork, insert, rebuild, delete both", async () => {
  const db = makeDb();
  db.exec("INSERT INTO docs (body) VALUES ('ddd')");
  await forkExec();
  db.exec("INSERT INTO docs (body) VALUES ('eee')");
  db.exec("INSERT INTO docs_fts(docs_fts) VALUES('rebuild')");
  db.exec("DELETE FROM docs WHERE id = 1");
  db.exec("DELETE FROM docs WHERE id = 2");
  const d =
    (db.prepare("SELECT count(*) as n FROM docs_fts WHERE docs_fts MATCH 'ddd'")
      .get() as { n: number }).n;
  const e =
    (db.prepare("SELECT count(*) as n FROM docs_fts WHERE docs_fts MATCH 'eee'")
      .get() as { n: number }).n;
  assert(d === 0, `ddd expected 0, got ${d}`);
  assert(e === 0, `eee expected 0, got ${e}`);
  console.log("OK");
  db.close();
});

// The failing pattern: loop of insert, fork, delete
Deno.test("loop: insert, fork, rebuild, delete — 5 cycles", async () => {
  const db = makeDb();
  for (let i = 0; i < 5; i++) {
    db.exec(`INSERT INTO docs (body) VALUES ('loop${i}')`);
    await forkExec();
    db.exec("INSERT INTO docs_fts(docs_fts) VALUES('rebuild')");
    db.exec(`DELETE FROM docs WHERE id = ${i + 1}`);
    const n =
      (db.prepare("SELECT count(*) as n FROM docs_fts WHERE docs_fts MATCH ?")
        .get(`loop${i}`) as { n: number }).n;
    console.log(`  cycle ${i}: loop${i} count=${n}`);
    assert(n === 0, `loop${i} expected 0, got ${n}`);
  }
  console.log("OK");
  db.close();
});
