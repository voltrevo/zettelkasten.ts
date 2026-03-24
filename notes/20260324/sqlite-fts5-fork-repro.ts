// @db/sqlite FTS5 corruption after Deno.Command subprocess
//
// Repro: create table with FTS5 content-sync triggers, insert a row,
// spawn any subprocess, then DELETE the row (triggering FTS5 delete).
// The FTS5 delete trigger fails with "database disk image is malformed".

import { Database } from "@db/sqlite";

const db = new Database(":memory:");
db.exec(`
  CREATE TABLE docs (id INTEGER PRIMARY KEY, body TEXT);
  CREATE VIRTUAL TABLE docs_fts USING fts5(body, content=docs, content_rowid=id);
  CREATE TRIGGER docs_del AFTER DELETE ON docs BEGIN
    INSERT INTO docs_fts(docs_fts, rowid, body) VALUES('delete', OLD.rowid, OLD.body);
  END;
`);
db.exec("INSERT INTO docs (body) VALUES ('hello world')");

// Spawn any subprocess
const p = new Deno.Command(Deno.execPath(), {
  args: ["eval", "0"],
  stdin: "null",
  stdout: "null",
  stderr: "null",
}).output();
await p;

// This triggers the FTS5 delete — fails with "database disk image is malformed"
db.exec("DELETE FROM docs WHERE id = 1");
console.log("OK");
db.close();
