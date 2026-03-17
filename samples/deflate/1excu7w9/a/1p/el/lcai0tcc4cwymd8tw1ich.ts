import { deflateSyms } from "../../2b/9c/9t3q7wc4uyo66xb0l761k.ts";
import type { Sym } from "../../2c/xc/2e937niymvz3py1dsukw5.ts";

// Count literal/length and distance symbol frequencies from LZ77 output.
// Symbol 256 (end-of-block) is always counted once.
export function deflateFreqs(syms: Sym[]): { litFreqs: Uint32Array; distFreqs: Uint32Array } {
  const { lenSym, distSym } = deflateSyms;
  const litFreqs = new Uint32Array(286);
  litFreqs[256] = 1;
  const distFreqs = new Uint32Array(30);
  for (const s of syms) {
    if ("lit" in s) {
      litFreqs[s.lit]++;
    } else {
      litFreqs[lenSym(s.len)[0]]++;
      distFreqs[distSym(s.dist)[0]]++;
    }
  }
  return { litFreqs, distFreqs };
}
