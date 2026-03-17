import { BitWriter } from "../../2n/i4/e7nhujs522iwzs4tb3gqt.ts";
import { huffmanEncodeCodes } from "../../pr/oh/h84fezcj0o9iwze31bm45.ts";
import { deflateSyms } from "../../2b/9c/9t3q7wc4uyo66xb0l761k.ts";
import type { Sym } from "../../2c/xc/2e937niymvz3py1dsukw5.ts";

// Writes deflate symbol data for a block whose header has already been written.
// litLens and distLens are the same code length arrays used for the header.
export function writeDeflateSymbols(
  w: BitWriter,
  syms: Sym[],
  litLens: Uint8Array,
  distLens: Uint8Array,
): void {
  const { lenSym, distSym } = deflateSyms;
  const litCodes = huffmanEncodeCodes(litLens);
  const distCodes = huffmanEncodeCodes(distLens);
  for (const s of syms) {
    if ("lit" in s) {
      w.writeBits(litCodes[s.lit], litLens[s.lit]);
    } else {
      const [ls, le, lx] = lenSym(s.len);
      w.writeBits(litCodes[ls], litLens[ls]);
      if (le) w.writeBits(lx, le);
      const [ds, de, dx] = distSym(s.dist);
      w.writeBits(distCodes[ds], distLens[ds]);
      if (de) w.writeBits(dx, de);
    }
  }
  // End-of-block symbol (256).
  w.writeBits(litCodes[256], litLens[256]);
}
