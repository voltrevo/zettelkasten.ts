# Sample ideas

## gzip
Compress/decompress `.gz` files. deflate with a gzip header (magic, OS, flags,
mtime) and a CRC32 + original-size trailer. Interops with the `gzip` CLI.

Needs: CRC32 (new), then thin gzip framing atom.
Reuses: `deflate` (`1excu7w9`), `inflate` (`17unjogw`)

---

## zlib
Raw deflate with a 2-byte header and Adler32 trailer. Required by PNG and many
network protocols.

Needs: Adler32 (new), then thin framing atom.
Reuses: `deflate` (`1excu7w9`), `inflate` (`17unjogw`)

---

## PNG decode
Read a PNG file into `{ width, height, channels, pixels: Uint8Array }`. Chunk
parsing, CRC32 validation, zlib decompression, and PNG filter reconstruction
(Sub, Up, Average, Paeth).

Needs: CRC32, Adler32, zlib, PNG chunk parser, PNG filter undo.
Reuses: `inflate` (`17unjogw`)

---

## PNG encode
Write a `{ width, height, channels, pixels }` struct to a valid PNG byte stream.
Filter selection (Paeth tends to compress best), zlib compression, chunk assembly
with CRC32. Round-trips with the decoder.

Needs: CRC32, Adler32, zlib, PNG filter apply.
Reuses: `deflate` (`1excu7w9`)

---

## zip archive
Read and write `.zip` files: per-file local headers, compressed payloads,
central directory, end-of-central-directory record. Interops with `unzip`.

Needs: CRC32 (new), zip parser/writer atoms.
Reuses: `deflate` (`1excu7w9`), `inflate` (`17unjogw`)

---

## Huffman codec
A standalone compressor/decompressor using only Huffman coding (no LZ77 back-references).
Simpler than deflate; useful as a teaching example and for already-deduplicated data.

Reuses: `buildHuffmanLengths` (`5p1n1guh`), `huffmanEncodeCodes` (`prohh84f`),
`buildDecodeTable` (`2aomqq3j`), `BitWriter` (`2ni4e7nh`), `BitReader` (`16nxlrsl`)

---

## LZ4
Block compressor with no Huffman step — pure LZ77-style literals + matches
encoded in a simple binary format. Much faster to decompress than deflate; good
for situations where speed matters more than ratio.

Reuses: LZ77 match-finding ideas from `lz77` (`2cxc2e93`); new format encoder/decoder.

---

## number theory cluster
`gcd`, `isPrime`, `primeFactors`, `totient` already exist. Natural extensions:
`lcm`, `modPow`, `modInverse`, `millerRabin` (probabilistic primality), `nthPrime`.

Reuses: `gcd` (`29q33z8r`), `isPrime`, `totient` (see samples/totient)

---

## Base64
Encode/decode Base64 and Base64url. Frequently paired with deflate for
binary-in-text transport (data URIs, JWT payloads, PEM files).

No existing dependencies — leaf atom.
