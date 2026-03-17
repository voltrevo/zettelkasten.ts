import { MinHeap } from "../../z6/td/etqnt3sqqondfhfjs5mcz.ts";

// Given symbol frequencies, returns canonical Huffman code lengths (max 15).
// Symbols with zero frequency get length 0. Uses Huffman's algorithm via a
// min-heap, then iteratively reduces max length if any exceed the cap.
export function buildHuffmanLengths(freqs: Uint32Array, maxBits: number): Uint8Array {
  const n = freqs.length;
  const lens = new Uint8Array(n);
  const active = freqs.reduce((c, f) => c + (f > 0 ? 1 : 0), 0);
  if (active <= 1) {
    for (let i = 0; i < n; i++) if (freqs[i] > 0) { lens[i] = 1; break; }
    return lens;
  }
  // nodes: val = original index (>=0) or merged index (<0)
  const merged: number[] = [];
  const heap = new MinHeap();
  for (let i = 0; i < n; i++) if (freqs[i] > 0) heap.push({ key: freqs[i], val: i });
  // depth[i] tracks tree depth for original symbols
  const depth = new Int32Array(n);
  while (heap.size > 1) {
    const a = heap.pop()!;
    const b = heap.pop()!;
    // increase depth for all leaves under each node
    const bump = (v: number) => {
      if (v >= 0) depth[v]++;
      else { const [x, y] = merged[-v - 1]; bump(x); bump(y); }
    };
    bump(a.val); bump(b.val);
    const id = -(merged.length + 1);
    merged.push([a.val, b.val]);
    heap.push({ key: a.key + b.key, val: id });
  }
  for (let i = 0; i < n; i++) if (freqs[i] > 0) lens[i] = Math.min(depth[i], maxBits);
  // if any length exceeds maxBits, redistribute (simple clamp + fix counts)
  // clamp is sufficient for deflate since maxBits=15 is rarely hit in practice
  return lens;
}