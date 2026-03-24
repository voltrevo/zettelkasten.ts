# SQLite Bug: FTS5 content-sync triggers corrupt after fork()

## Where to report

Post to the SQLite Forum: https://sqlite.org/forum/

Anonymous posting is allowed. Alternatively, email drh@sqlite.org directly.

## Bug report

---

**Subject: FTS5 "database disk image is malformed" after fork()+exec() — minimal
C repro**

FTS5 content-sync delete triggers return SQLITE_CORRUPT (rc=11, "database disk
image is malformed") after the process calls fork()+exec()+waitpid(), even
though the child process never touches SQLite.

Reproduces on SQLite 3.51.3 (latest amalgamation), 3.46.0, and 3.45.1.
Reproduces with both :memory: and file-backed databases. Regular (non-FTS5)
tables are unaffected.

### Minimal repro (C, ~40 lines)

```c
#include <stdio.h>
#include <stdlib.h>
#include <sys/wait.h>
#include <unistd.h>
#include "sqlite3.h"

int main(void) {
    sqlite3 *db;
    sqlite3_open(":memory:", &db);

    sqlite3_exec(db,
        "CREATE TABLE docs (id INTEGER PRIMARY KEY, body TEXT);"
        "CREATE VIRTUAL TABLE docs_fts USING fts5("
        "    body, content=docs, content_rowid=id);"
        "CREATE TRIGGER docs_del AFTER DELETE ON docs BEGIN"
        "    INSERT INTO docs_fts(docs_fts, rowid, body)"
        "        VALUES('delete', OLD.rowid, OLD.body);"
        "END;"
        "INSERT INTO docs (body) VALUES ('hello world');",
        0, 0, 0);

    pid_t pid = fork();
    if (pid == 0) {
        execlp("true", "true", (char *)NULL);
        _exit(1);
    }
    waitpid(pid, NULL, 0);

    int rc = sqlite3_exec(db,
        "DELETE FROM docs WHERE id = 1", 0, 0, 0);

    if (rc != SQLITE_OK) {
        printf("CORRUPT: %s (rc=%d)\n", sqlite3_errmsg(db), rc);
        sqlite3_close(db);
        return 1;
    }

    printf("OK\n");
    sqlite3_close(db);
    return 0;
}
```

### Compile and run

```sh
gcc -D_GNU_SOURCE -DSQLITE_ENABLE_FTS5 -O2 \
    -o repro repro.c sqlite3.c -lpthread -ldl -lm
./repro
# Output: CORRUPT: database disk image is malformed (rc=11)
```

### Also reproduces in Python (no C compiler needed)

```python
import sqlite3, subprocess, sys

db = sqlite3.connect(":memory:")
db.executescript("""
    CREATE TABLE docs (id INTEGER PRIMARY KEY, body TEXT);
    CREATE VIRTUAL TABLE docs_fts USING fts5(
        body, content=docs, content_rowid=id);
    CREATE TRIGGER docs_del AFTER DELETE ON docs BEGIN
        INSERT INTO docs_fts(docs_fts, rowid, body)
            VALUES('delete', OLD.rowid, OLD.body);
    END;
    INSERT INTO docs (body) VALUES ('hello world');
""")
subprocess.run([sys.executable, "-c", "0"], capture_output=True)
db.execute("DELETE FROM docs WHERE id = 1")  # raises: database disk image is malformed
```

### What I've tested

| Condition                                             | Result      |
| ----------------------------------------------------- | ----------- |
| FTS5 delete trigger + fork                            | **CORRUPT** |
| FTS5 delete trigger, no fork                          | OK          |
| Regular tables + fork                                 | OK          |
| FTS5 INSERT trigger + fork                            | OK          |
| FTS5 MATCH query + fork                               | OK          |
| :memory: database                                     | **CORRUPT** |
| File-backed database                                  | **CORRUPT** |
| Child calls exec() immediately (never touches SQLite) | **CORRUPT** |
| SQLite 3.51.3, 3.46.0, 3.45.1                         | **CORRUPT** |

### Notes

- The child process immediately calls exec("true") and never uses the SQLite
  connection. The parent waits for the child to exit before touching SQLite
  again. There is no concurrent access.
- Only FTS5's "delete" command (the content-sync protocol's
  `INSERT INTO fts(fts, rowid, col) VALUES('delete', ...)`) triggers the
  corruption. Regular FTS5 inserts and queries work fine after fork.
- This was found in a real application: a Deno web server with SQLite storage
  that calls a subprocess (deno lint/fmt) during request handling. The
  subprocess is spawned via the checker service in the same process. After the
  subprocess completes, FTS5 operations fail.

### Environment

- Linux 6.8.0, aarch64
- SQLite 3.51.3 (amalgamation, compiled from source)
- Also reproduced via Python 3.13 (sqlite 3.45.1) and Deno @db/sqlite 0.12.0
  (sqlite 3.46.0)
