import { BitReader } from "../../16/nx/lrsloi7pxpvco0hwvfm51.ts";
import { decodeBlock } from "../../ty/kk/q70405r70vtkku5jxo8tg.ts";
import { readDynamicTrees } from "../../2i/de/9gr88d9nuwlm01fb9w7lq.ts";

// RFC 1951 fixed Huffman code lengths (288 literal/length symbols).
function fixedLitLens(): Uint8Array {
  const lens = new Uint8Array(288);
  for (let i = 0; i <= 143; i++) lens[i] = 8;
  for (let i = 144; i <= 255; i++) lens[i] = 9;
  for (let i = 256; i <= 279; i++) lens[i] = 7;
  for (let i = 280; i <= 287; i++) lens[i] = 8;
  return lens;
}

// Decompresses raw deflate bytes (RFC 1951), returning the original data.
// Handles stored blocks (BTYPE=0), fixed Huffman (BTYPE=1), and
// dynamic Huffman blocks (BTYPE=2).
export function inflate(input: Uint8Array): Uint8Array {
  const r = new BitReader(input);
  const out: number[] = [];
  const fixedDist = new Uint8Array(30).fill(5);

  for (;;) {
    const bfinal = r.readBits(1);
    const btype = r.readBits(2);

    if (btype === 0) {
      // Stored block: align to byte boundary, read len, copy raw bytes.
      r.alignByte();
      const len = r.readBits(16);
      r.readBits(16); // nlen (one's complement check — skip)
      for (let i = 0; i < len; i++) out.push(r.readBits(8));
    } else if (btype === 1) {
      decodeBlock(r, fixedLitLens(), fixedDist, out);
    } else if (btype === 2) {
      const { litLens, distLens } = readDynamicTrees(r);
      decodeBlock(r, litLens, distLens, out);
    } else {
      throw new Error("inflate: reserved BTYPE 3");
    }

    if (bfinal) break;
  }
  return new Uint8Array(out);
}
