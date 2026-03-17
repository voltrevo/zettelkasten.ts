export class MinHeap {
  private h: Array<{ key: number; val: number }> = [];
  push(item: { key: number; val: number }): void {
    this.h.push(item);
    let i = this.h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.h[p].key <= this.h[i].key) break;
      [this.h[p], this.h[i]] = [this.h[i], this.h[p]];
      i = p;
    }
  }
  pop(): { key: number; val: number } | null {
    if (!this.h.length) return null;
    const top = this.h[0];
    const last = this.h.pop()!;
    if (this.h.length) {
      this.h[0] = last;
      let i = 0;
      for (;;) {
        let s = i;
        const l = 2 * i + 1, r = l + 1;
        if (l < this.h.length && this.h[l].key < this.h[s].key) s = l;
        if (r < this.h.length && this.h[r].key < this.h[s].key) s = r;
        if (s === i) break;
        [this.h[s], this.h[i]] = [this.h[i], this.h[s]];
        i = s;
      }
    }
    return top;
  }
  get size(): number { return this.h.length; }
}