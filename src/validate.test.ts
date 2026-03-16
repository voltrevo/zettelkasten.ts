import { assertEquals } from "@std/assert";
import { validateAtom } from "./validate.ts";

async function ok(source: string): Promise<void> {
  const err = await validateAtom(source);
  assertEquals(err, null, `expected valid, got: ${err?.message}`);
}

async function fail(source: string, substr: string): Promise<void> {
  const err = await validateAtom(source);
  if (!err) throw new Error(`expected error containing "${substr}", got null`);
  if (!err.message.includes(substr)) {
    throw new Error(`expected "${substr}" in error, got: "${err.message}"`);
  }
}

// --- value exports ---

Deno.test("accepts export const", () => ok("export const x = 1;"));

Deno.test("accepts export function", () => ok("export function f() {}"));

Deno.test("accepts export class", () => ok("export class C {}"));

Deno.test("rejects no exports", () => fail("const x = 1;", "none found"));

Deno.test("rejects two value exports", () =>
  fail("export const x = 1;\nexport const y = 2;", "found 2"));

Deno.test("rejects exported let", () =>
  fail("export let x = 1;", "exported let"));

// --- type-only exports ---

Deno.test("accepts type alias alongside value export", () =>
  ok("export type Cap = { fetch: typeof fetch };\nexport const x = 1;"));

Deno.test("accepts interface alongside value export", () =>
  ok("export interface Cap { fetch: typeof fetch }\nexport const x = 1;"));

Deno.test("accepts multiple type exports alongside one value export", () =>
  ok(
    "export type Cap = {};\nexport interface Opts { n: number }\nexport const x = 1;",
  ));

Deno.test("rejects two value exports even with type exports", () =>
  fail(
    "export type Cap = {};\nexport const x = 1;\nexport const y = 2;",
    "found 2",
  ));

// --- imports ---

Deno.test("accepts valid atom import", () =>
  ok(
    'import { f } from "../../ab/cd/abcdefghijklmnopqrstu.ts";\nexport const x = 1;',
  ));

Deno.test("rejects bare specifier import", () =>
  fail('import { x } from "lodash";\nexport const x = 1;', "invalid import"));

Deno.test("rejects relative non-atom import", () =>
  fail(
    'import { x } from "./other.ts";\nexport const x = 1;',
    "invalid import",
  ));
