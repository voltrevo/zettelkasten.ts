export class BitWriter {
  private buf: number[] = [];
  private cur = 0;
  private bits = 0;
  writeBits(val: number, n: number): void {
    this.cur |= (val & ((1 << n) - 1)) << this.bits;
    this.bits += n;
    while (this.bits >= 8) {
      this.buf.push(this.cur & 0xff);
      this.cur >>>= 8;
      this.bits -= 8;
    }
  }
  bytes(): Uint8Array {
    const out = new Uint8Array(this.buf.length + (this.bits > 0 ? 1 : 0));
    for (let i = 0; i < this.buf.length; i++) out[i] = this.buf[i];
    if (this.bits > 0) out[this.buf.length] = this.cur & 0xff;
    return out;
  }
}