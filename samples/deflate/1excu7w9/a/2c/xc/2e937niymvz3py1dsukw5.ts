export type Sym = { lit: number } | { len: number; dist: number };

// LZ77 compression: scans input and emits literals or back-references.
// Uses a hash chain over 3-byte sequences with a 32KB sliding window.
// Back-references have len in [3,258] and dist in [1,32768].
export function lz77(input: Uint8Array): Sym[] {
  const WIN = 32768, MIN = 3, MAX = 258;
  const out: Sym[] = [];
  const head = new Int32Array(65536).fill(-1); // hash → most recent pos
  const prev = new Int32Array(WIN).fill(-1);   // pos%WIN → previous pos with same hash
  const hash = (i: number) =>
    (((input[i] * 0x9e37 ^ input[i + 1]) * 0x9e37 ^ input[i + 2]) & 0xffff) >>> 0;
  let i = 0;
  while (i < input.length) {
    if (i + MIN > input.length) { out.push({ lit: input[i++] }); continue; }
    const h = hash(i);
    let bestLen = MIN - 1, bestDist = 0;
    let j = head[h];
    let chain = 0;
    while (j >= 0 && i - j <= WIN && chain++ < 128) {
      if (input[j] === input[i] && input[j + 1] === input[i + 1]) {
        let l = 0;
        while (l < MAX && i + l < input.length && input[j + l] === input[i + l]) l++;
        if (l > bestLen) { bestLen = l; bestDist = i - j; }
      }
      j = prev[j % WIN];
    }
    prev[i % WIN] = head[h];
    head[h] = i;
    if (bestLen >= MIN) {
      out.push({ len: bestLen, dist: bestDist });
      for (let k = 1; k < bestLen; k++) {
        const ii = i + k;
        if (ii + MIN <= input.length) {
          const hh = hash(ii);
          prev[ii % WIN] = head[hh];
          head[hh] = ii;
        }
      }
      i += bestLen;
    } else {
      out.push({ lit: input[i++] });
    }
  }
  return out;
}