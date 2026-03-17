// Given canonical code lengths, returns the bit-reversed code word for each symbol,
// ready to pass to BitWriter.writeBits for LSB-first deflate streams.
// Symbols with length 0 get code 0 (unused). Complement to buildDecodeTable.
export function huffmanEncodeCodes(lens: Uint8Array): Uint32Array {
  const max = Math.max(...lens);
  const count = new Uint32Array(max + 1);
  for (const l of lens) if (l) count[l]++;
  const next = new Uint32Array(max + 1);
  for (let i = 1; i < max; i++) next[i + 1] = (next[i] + count[i]) << 1;
  const codes = new Uint32Array(lens.length);
  for (let s = 0; s < lens.length; s++) {
    const l = lens[s];
    if (!l) continue;
    // Reverse canonical code bits for LSB-first bit stream (matches buildDecodeTable).
    const code = next[l]++;
    let rev = 0;
    for (let i = 0; i < l; i++) rev = (rev << 1) | ((code >> i) & 1);
    codes[s] = rev;
  }
  return codes;
}
