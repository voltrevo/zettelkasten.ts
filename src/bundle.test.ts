import { assertEquals } from "@std/assert";
import {
  buildZip,
  bundleZip,
  collectAtoms,
  extractDependencies,
} from "./bundle.ts";

// --- extractDependencies ---

Deno.test("extractDependencies: finds atom imports", () => {
  const src = `
import { foo } from "../../ab/cd/efghijklmnopqrstuvwxy.ts";
import type { Bar } from "../../12/34/5678901234567890123ab.ts";
export const x = 1;
`;
  assertEquals(extractDependencies(src), [
    "abcdefghijklmnopqrstuvwxy",
    "12345678901234567890123ab",
  ]);
});

Deno.test("extractDependencies: ignores non-atom imports", () => {
  const src = `
import { foo } from "npm:foo";
import { bar } from "./local.ts";
import { baz } from "https://example.com/mod.ts";
export const x = 1;
`;
  assertEquals(extractDependencies(src), []);
});

Deno.test("extractDependencies: empty content", () => {
  assertEquals(extractDependencies("export const x = 1;"), []);
});

// --- collectAtoms ---

Deno.test("collectAtoms: single atom no deps", async () => {
  const store = new Map([
    ["aaaaabbbbbcccccdddddeeeee", "export const x = 1;"],
  ]);
  const result = await collectAtoms(
    "aaaaabbbbbcccccdddddeeeee",
    (h) => {
      const c = store.get(h);
      if (!c) throw new Error(`not found: ${h}`);
      return Promise.resolve(c);
    },
  );
  assertEquals([...result.keys()], ["aaaaabbbbbcccccdddddeeeee"]);
});

Deno.test("collectAtoms: walks transitive dependencies", async () => {
  const hDep2 = "fffff0000011111222223333a";
  const hDep1 = "aabbcccdddeeefffggghhh000";
  const hRoot = "zzzzz1111122222333334444a";

  const dep2Content = "export const leaf = 0;";
  const dep1Content =
    `import { leaf } from "../../ff/ff/f0000011111222223333a.ts";\nexport const mid = 1;`;
  const rootContent =
    `import { mid } from "../../aa/bb/cccdddeeefffggghhh000.ts";\nexport const top = 2;`;

  const store = new Map([
    [hDep2, dep2Content],
    [hDep1, dep1Content],
    [hRoot, rootContent],
  ]);
  const result = await collectAtoms(hRoot, (h) => {
    const c = store.get(h);
    if (!c) throw new Error(`not found: ${h}`);
    return Promise.resolve(c);
  });
  assertEquals(result.size, 3);
  assertEquals(result.has(hRoot), true);
  assertEquals(result.has(hDep1), true);
  assertEquals(result.has(hDep2), true);
});

// --- buildZip ---

Deno.test("buildZip: produces valid STORE zip structure", () => {
  const enc = new TextEncoder();
  const files = new Map<string, Uint8Array>([
    ["hello/world.txt", enc.encode("hello world")],
  ]);
  const zip = buildZip(files);

  const view = new DataView(zip.buffer);

  // Local file header signature at offset 0
  assertEquals(view.getUint32(0, true), 0x04034b50);
  // Compression method: STORE (0)
  assertEquals(view.getUint16(8, true), 0);
  // Uncompressed size: 11
  assertEquals(view.getUint32(22, true), 11);

  // End-of-central-dir signature must be last 22 bytes
  assertEquals(
    view.getUint32(zip.length - 22, true),
    0x06054b50,
  );
  // 1 entry in central directory
  assertEquals(view.getUint16(zip.length - 22 + 10, true), 1);
});

Deno.test("buildZip: file content is stored verbatim", () => {
  const enc = new TextEncoder();
  const content = "export const x = 42;";
  const files = new Map<string, Uint8Array>([
    ["test.ts", enc.encode(content)],
  ]);
  const zip = buildZip(files);
  const dec = new TextDecoder();

  // Content follows local header (30 bytes) + filename length (7 bytes) = offset 37
  const nameLen = 7; // "test.ts"
  const dataOffset = 30 + nameLen;
  const stored = dec.decode(zip.slice(dataOffset, dataOffset + content.length));
  assertEquals(stored, content);
});

// --- bundleZip ---

Deno.test("bundleZip: includes run.ts entry point", async () => {
  const hash = "aabbcccdddeeefffggghhh000"; // 25 chars
  const store = new Map([[hash, "export function main() {}"]]);
  const zip = await bundleZip(hash, (h) => {
    const c = store.get(h);
    if (!c) throw new Error(`not found: ${h}`);
    return Promise.resolve(c);
  });

  // Verify run.ts appears in the zip by scanning for the string
  const dec = new TextDecoder();
  const text = dec.decode(zip);
  assertEquals(text.includes("run.ts"), true);
  assertEquals(text.includes("await main(globalThis)"), true);
});
