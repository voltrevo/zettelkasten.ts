// Supersedes 2gvgog32vgqe52xq0zjop7b55 — adds peekBits/skipBits needed for Huffman decoding.
export class BitReader {
  private pos = 0;
  private cur = 0;
  private bits = 0;
  constructor(private data: Uint8Array) {}
  private fill(n: number): void {
    while (this.bits < n) { this.cur |= this.data[this.pos++] << this.bits; this.bits += 8; }
  }
  peekBits(n: number): number { this.fill(n); return this.cur & ((1 << n) - 1); }
  skipBits(n: number): void { this.cur >>>= n; this.bits -= n; }
  readBits(n: number): number { const v = this.peekBits(n); this.skipBits(n); return v; }
  alignByte(): void { this.cur = 0; this.bits = 0; }
  get offset(): number { return this.pos; }
}