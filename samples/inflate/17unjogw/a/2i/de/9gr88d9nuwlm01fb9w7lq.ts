import { BitReader } from "../../16/nx/lrsloi7pxpvco0hwvfm51.ts";
import { buildDecodeTable } from "../../2a/om/qq3jom2f1eqm8jpsq8mro.ts";

// Reads the dynamic Huffman code length tables from a deflate stream.
// Call this after reading BTYPE=2 bits. Returns litLens (hlit entries)
// and distLens (hdist entries) for use with decodeBlock.
export function readDynamicTrees(r: BitReader): { litLens: Uint8Array; distLens: Uint8Array } {
  const hlit = r.readBits(5) + 257;
  const hdist = r.readBits(5) + 1;
  const hclen = r.readBits(4) + 4;
  const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
  const clLens = new Uint8Array(19);
  for (let i = 0; i < hclen; i++) clLens[CL_ORDER[i]] = r.readBits(3);
  const { table: clTable, maxBits: clMax } = buildDecodeTable(clLens);
  // Decode all hlit + hdist code lengths using the code-length alphabet.
  const combined = new Uint8Array(hlit + hdist);
  let i = 0;
  while (i < combined.length) {
    const entry = clTable[r.peekBits(clMax)];
    r.skipBits(entry & 0xffff);
    const sym = entry >> 16;
    if (sym < 16) {
      combined[i++] = sym;
    } else if (sym === 16) {
      // Copy previous length; capture prev before incrementing i.
      const prev = combined[i - 1];
      const rep = r.readBits(2) + 3;
      for (let j = 0; j < rep; j++) combined[i++] = prev;
    } else if (sym === 17) {
      i += r.readBits(3) + 3;
    } else {
      i += r.readBits(7) + 11;
    }
  }
  return { litLens: combined.slice(0, hlit), distLens: combined.slice(hlit) };
}
