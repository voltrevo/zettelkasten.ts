"""
SQLite FTS5 corruption after fork()+exec()

The FTS5 content-sync delete trigger returns SQLITE_CORRUPT after the process
forks, even though the child never touches SQLite.

Reproduces on SQLite 3.51.3, 3.46.0, 3.45.1.
Reproduces with :memory: and file-backed databases.
"""

import sqlite3
import subprocess
import sys

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
print("Insert OK")

subprocess.run([sys.executable, "-c", "0"], capture_output=True)
print("Fork+exec OK")

try:
    db.execute("DELETE FROM docs WHERE id = 1")
    print("DELETE OK")
except Exception as e:
    print(f"DELETE CORRUPTED: {e}")

db.close()
