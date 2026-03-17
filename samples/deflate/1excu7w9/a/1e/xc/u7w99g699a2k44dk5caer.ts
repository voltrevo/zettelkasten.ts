import { BitWriter } from "../../2n/i4/e7nhujs522iwzs4tb3gqt.ts";
import { lz77 } from "../../2c/xc/2e937niymvz3py1dsukw5.ts";
import { deflateFreqs } from "../../1p/el/lcai0tcc4cwymd8tw1ich.ts";
import { buildHuffmanLengths } from "../../5p/1n/1guha80beks8awqoogy2a.ts";
import { writeDeflateHeader } from "../../2k/lb/gkm9sxhgot5dwhc5erd7b.ts";
import { writeDeflateSymbols } from "../../g0/oe/abew9qd5gu65m4pwb7cwl.ts";

// Compresses input using deflate (RFC 1951), returning raw deflate bytes
// (no zlib or gzip framing). Uses dynamic Huffman coding with LZ77 matching.
export function deflate(input: Uint8Array): Uint8Array {
  const syms = lz77(input);
  const { litFreqs, distFreqs } = deflateFreqs(syms);
  const litLens = buildHuffmanLengths(litFreqs, 15);
  const distLens = buildHuffmanLengths(
    distFreqs.some(Boolean) ? distFreqs : new Uint32Array([1, 1]),
    15,
  );
  const w = new BitWriter();
  writeDeflateHeader(w, litLens, distLens, true);
  writeDeflateSymbols(w, syms, litLens, distLens);
  return w.bytes();
}
