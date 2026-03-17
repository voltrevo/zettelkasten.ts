import { BitReader } from "../../16/nx/lrsloi7pxpvco0hwvfm51.ts";
import { buildDecodeTable } from "../../2a/om/qq3jom2f1eqm8jpsq8mro.ts";
import { deflateSyms } from "../../2b/9c/9t3q7wc4uyo66xb0l761k.ts";

// Decodes one deflate block body, appending decoded bytes to out.
// litLengths and distLengths are the canonical code length arrays for this block.
export function decodeBlock(
  reader: BitReader,
  litLengths: Uint8Array,
  distLengths: Uint8Array,
  out: number[],
): void {
  const { lenBase, distBase } = deflateSyms;
  const { table: litTable, maxBits: litMax } = buildDecodeTable(litLengths);
  const { table: distTable, maxBits: distMax } = buildDecodeTable(distLengths);

  for (;;) {
    // Peek maxBits, decode symbol, consume only the code's actual length.
    const litEntry = litTable[reader.peekBits(litMax)];
    reader.skipBits(litEntry & 0xffff);
    const sym = litEntry >> 16;

    if (sym < 256) {
      out.push(sym);
    } else if (sym === 256) {
      // End of block.
      break;
    } else {
      // Length/distance back-reference.
      const [baseLen, extraLen] = lenBase(sym);
      const length = baseLen + (extraLen ? reader.readBits(extraLen) : 0);

      const distEntry = distTable[reader.peekBits(distMax)];
      reader.skipBits(distEntry & 0xffff);
      const distCode = distEntry >> 16;
      const [baseDist, extraDist] = distBase(distCode);
      const dist = baseDist + (extraDist ? reader.readBits(extraDist) : 0);

      // Copy bytes from the sliding window (byte-by-byte to handle overlapping runs).
      const start = out.length - dist;
      for (let i = 0; i < length; i++) out.push(out[start + i]);
    }
  }
}
