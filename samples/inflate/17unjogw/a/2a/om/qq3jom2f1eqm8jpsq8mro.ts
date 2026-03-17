// Builds a fast Huffman decode table from canonical code lengths.
// Returns {table, maxBits} where table is indexed by the next maxBits bits
// of the bitstream (LSB-first). Each entry: high 16 bits = symbol,
// low 16 bits = actual code length (consume this many bits after lookup).
// Symbols with length 0 are not in the table.
export function buildDecodeTable(lengths: Uint8Array): { table: Uint32Array; maxBits: number } {
  const maxBits = Math.max(...lengths);
  if (maxBits === 0) return { table: new Uint32Array(0), maxBits: 0 };
  // count codes per length
  const count = new Uint16Array(maxBits + 1);
  for (const l of lengths) if (l > 0) count[l]++;
  // first code for each length (canonical assignment, nextCode[l] = starting code for length l)
  const nextCode = new Uint32Array(maxBits + 1);
  for (let i = 1; i < maxBits; i++) nextCode[i + 1] = (nextCode[i] + count[i]) << 1;
  // assign codes and fill table
  const size = 1 << maxBits;
  const table = new Uint32Array(size);
  for (let sym = 0; sym < lengths.length; sym++) {
    const l = lengths[sym];
    if (l === 0) continue;
    const code = nextCode[l]++;
    // reverse code bits for LSB-first lookup, then fill all table entries sharing this prefix
    let rev = 0;
    for (let i = 0; i < l; i++) rev = (rev << 1) | ((code >> i) & 1);
    const fill = 1 << (maxBits - l);
    for (let j = 0; j < fill; j++) table[rev | (j << l)] = (sym << 16) | l;
  }
  return { table, maxBits };
}