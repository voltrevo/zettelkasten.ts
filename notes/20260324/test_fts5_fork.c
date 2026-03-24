/*
 * SQLite FTS5 corruption after fork()+exec()
 *
 * Repro: create table with FTS5 content-sync delete trigger,
 * insert a row, fork+exec a child, then DELETE the row.
 * The FTS5 delete trigger fails with SQLITE_CORRUPT.
 */
#include <stdio.h>
#include <stdlib.h>
#include <sys/wait.h>
#include <unistd.h>
#include "sqlite-amalgamation-3510300/sqlite3.c"

static void check(int rc, sqlite3 *db, const char *msg) {
    if (rc != SQLITE_OK && rc != SQLITE_DONE && rc != SQLITE_ROW) {
        fprintf(stderr, "FAIL at %s: %s (rc=%d)\n", msg, sqlite3_errmsg(db), rc);
        exit(1);
    }
}

int main(void) {
    sqlite3 *db;
    check(sqlite3_open(":memory:", &db), db, "open");

    check(sqlite3_exec(db,
        "CREATE TABLE docs (id INTEGER PRIMARY KEY, body TEXT);"
        "CREATE VIRTUAL TABLE docs_fts USING fts5(body, content=docs, content_rowid=id);"
        "CREATE TRIGGER docs_del AFTER DELETE ON docs BEGIN"
        "  INSERT INTO docs_fts(docs_fts, rowid, body) VALUES('delete', OLD.rowid, OLD.body);"
        "END;"
        "INSERT INTO docs (body) VALUES ('hello world');",
        NULL, NULL, NULL), db, "schema+insert");

    printf("Insert OK\n");

    /* fork + exec */
    pid_t pid = fork();
    if (pid == 0) {
        execlp("true", "true", NULL);
        _exit(1);
    }
    waitpid(pid, NULL, 0);
    printf("Fork+exec OK\n");

    /* This triggers the FTS5 delete */
    int rc = sqlite3_exec(db, "DELETE FROM docs WHERE id = 1", NULL, NULL, NULL);
    if (rc != SQLITE_OK) {
        printf("DELETE CORRUPTED: %s (rc=%d)\n", sqlite3_errmsg(db), rc);
        sqlite3_close(db);
        return 1;
    }

    printf("DELETE OK\n");
    sqlite3_close(db);
    return 0;
}
