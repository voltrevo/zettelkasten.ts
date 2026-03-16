import { assertEquals } from "@std/assert";
import { minify } from "./minify.ts";

function assertIdempotent(source: string): void {
  const m1 = minify(source);
  const m2 = minify(m1);
  assertEquals(m1, m2, "minify should be idempotent");
}

Deno.test("strips single-line comments", () => {
  const out = minify(`
    // this is a comment
    export const x = 1; // inline comment
  `);
  assertEquals(out, "export const x = 1;");
});

Deno.test("strips block comments", () => {
  const out = minify(`
    /* block comment */
    export const x = /* inline block */ 1;
  `);
  assertEquals(out, "export const x = 1;");
});

Deno.test("preserves whitespace inside string literals", () => {
  const out = minify(`export const s = "hello   world";`);
  assertEquals(out, `export const s = "hello   world";`);
});

Deno.test("preserves whitespace inside template literals", () => {
  const out = minify("export const s = `hello   world`;");
  assertEquals(out, "export const s = `hello   world`;");
});

Deno.test("preserves newlines inside template literals", () => {
  const out = minify("export const s = `line1\nline2`;");
  assertEquals(out, "export const s = `line1\nline2`;");
});

Deno.test("preserves template literal with expressions", () => {
  const out = minify("export const f = (n: number) => `value:   ${n}   end`;");
  assertEquals(out, "export const f = (n: number) => `value:   ${n}   end`;");
});

Deno.test("preserves comment-like content inside strings", () => {
  const out = minify(`export const s = "// not a comment /* also not */";`);
  assertEquals(out, `export const s = "// not a comment /* also not */";`);
});

Deno.test("preserves whitespace inside regex literals", () => {
  const out = minify("export const re = /  hello  world  /;");
  assertEquals(out, "export const re = /  hello  world  /;");
});

Deno.test("preserves regex flags", () => {
  const out = minify("export const re = /foo/gi;");
  assertEquals(out, "export const re = /foo/gi;");
});

Deno.test("collapses inter-token whitespace", () => {
  const out = minify(`
    export   const   x   =   1   +   2   ;
  `);
  // TS printer normalises token spacing; we just verify no runs of spaces remain
  assertEquals(out.includes("  "), false);
  assertEquals(out.includes("export"), true);
  assertEquals(out.includes("const"), true);
});

Deno.test("is idempotent on complex source", () => {
  const source = `
    // A function with comments and spacing
    export function   add(
      a:  number,
      b:  number  // the second arg
    ):  number {
      /* compute sum */
      return   a   +   b;
    }
  `;
  assertIdempotent(source);
});

Deno.test("handles ASI-sensitive return statement", () => {
  // TS printer should emit an explicit semicolon after bare return
  const out = minify(`
    export function f() {
      return
      42
    }
  `);
  // The TS AST sees this as: return; 42; — the printer should preserve that
  assertEquals(out.includes("return;"), true);
});
