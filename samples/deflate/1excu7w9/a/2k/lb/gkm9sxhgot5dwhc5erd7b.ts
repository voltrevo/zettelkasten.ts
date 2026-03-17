import { BitWriter } from "../../2n/i4/e7nhujs522iwzs4tb3gqt.ts";
import { buildHuffmanLengths } from "../../5p/1n/1guha80beks8awqoogy2a.ts";
import { huffmanEncodeCodes } from "../../pr/oh/h84fezcj0o9iwze31bm45.ts";
import { deflateSyms } from "../../2b/9c/9t3q7wc4uyo66xb0l761k.ts";

// Writes a dynamic Huffman deflate block header (RFC 1951 section 3.2.7).
// litLens: code lengths for literal/length symbols 0-285.
// distLens: code lengths for distance codes 0-29.
export function writeDeflateHeader(
  w: BitWriter,
  litLens: Uint8Array,
  distLens: Uint8Array,
  isFinal: boolean,
): void {
  const { CL_ORDER } = deflateSyms;

  // Count code-length alphabet frequencies — include zeros, since most
  // lit/dist symbols are unused and we need a code for length value 0.
  const clFreqs = new Uint32Array(19);
  for (const lens of [litLens, distLens]) for (const l of lens) clFreqs[l]++;
  const clLens = buildHuffmanLengths(clFreqs, 7);
  const clCodes = huffmanEncodeCodes(clLens);

  // Trim trailing unused entries (minimum values per RFC).
  let hclen = 19, hlit = 286, hdist = 30;
  while (hclen > 4 && !clLens[CL_ORDER[hclen - 1]]) hclen--;
  while (hlit > 257 && !litLens[hlit - 1]) hlit--;
  while (hdist > 1 && !distLens[hdist - 1]) hdist--;

  w.writeBits(isFinal ? 1 : 0, 1);
  w.writeBits(2, 2); // BTYPE = dynamic Huffman
  w.writeBits(hlit - 257, 5);
  w.writeBits(hdist - 1, 5);
  w.writeBits(hclen - 4, 4);
  for (let i = 0; i < hclen; i++) w.writeBits(clLens[CL_ORDER[i]], 3);

  // Encode lit/dist lengths using the code-length alphabet.
  for (let i = 0; i < hlit; i++) { const v = litLens[i]; w.writeBits(clCodes[v], clLens[v]); }
  for (let i = 0; i < hdist; i++) { const v = distLens[i]; w.writeBits(clCodes[v], clLens[v]); }
}
