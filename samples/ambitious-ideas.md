# Ambitious ideas

Rebuild the world in pure TypeScript atoms. No platform APIs, no npm, no
built-ins beyond what the language gives you. Each entry describes a top-level
goal and the notable subatoms that would emerge along the way.

---

## TLS 1.3

A complete TLS 1.3 handshake and record layer. Enough to open an HTTPS
connection from raw TCP bytes.

Subatoms: SHA-256, SHA-384, HMAC, HKDF, AES-128-GCM, AES-256-GCM,
ChaCha20-Poly1305, X25519 key exchange, ECDSA-P256 verify, ASN.1 DER parser,
X.509 certificate chain validator, TLS record framing, handshake state machine,
key schedule derivation.

---

## SSH client

Enough to authenticate (password or ed25519 key), open a channel, and run a
command. The protocol is layered enough to decompose well.

Subatoms: SSH transport framing, Curve25519 key exchange, Ed25519 sign/verify,
SHA-256, HMAC, AES-CTR, AES-GCM, packet MAC, user auth state machine, channel
multiplexer, SSH agent forwarding parser.

---

## PDF renderer

Parse a PDF file and rasterize pages to pixel buffers. Even a subset (no
embedded fonts, no transparency groups) is enormous.

Subatoms: PDF cross-reference table parser, PDF object/stream parser, content
stream interpreter, Type1/TrueType glyph outline parser, Bezier curve
rasterizer, scanline fill, affine transform, CMap (character mapping), zlib
inflate (exists), JPEG decoder, ICC color profile converter, alpha compositor.

---

## JPEG codec

Decode and encode JPEG images. Lossy compression based on DCT, quantization,
and Huffman coding.

Subatoms: 8x8 DCT (forward and inverse), zigzag scan ordering, quantization
table apply/unapply, Huffman encode/decode (partially exists), JFIF marker
parser, MCU assembly/disassembly, YCbCr ↔ RGB color space conversion, chroma
subsampling/upsampling.

---

## Markdown → HTML

Full CommonMark-spec Markdown parser producing an HTML string. The spec is
deceptively complex (link reference resolution, lazy continuation, precedence).

Subatoms: block structure parser (ATX headings, fenced code, lists, blockquotes,
thematic breaks), inline parser (emphasis/strong, code spans, autolinks, images,
hard line breaks), link reference definition collector, HTML entity decoder,
tree-to-HTML serializer.

---

## SQLite reader

Read a `.sqlite` file and execute SELECT queries against it. No write support
needed — just B-tree traversal and the query evaluator.

Subatoms: SQLite file header parser, page reader (13 page types), B-tree node
parser, cell parser (record format decoder, varint), overflow page chain walker,
SQL tokenizer, SQL expression parser, query planner (table scan, index scan),
expression evaluator, type affinity coercion.

---

## Git object store

Read a `.git` directory: parse packfiles, resolve deltas, walk commit graphs,
read trees, diff blobs. Enough to implement `git log`, `git show`, `git diff`.

Subatoms: SHA-1, zlib inflate (exists), loose object parser, packfile index
parser, packfile entry reader, OFS/REF delta apply, commit graph walker, tree
parser, unified diff generator, ref resolver (branches, tags, HEAD).

---

## HTTP/2 client

Frame-level HTTP/2 over a raw byte stream. Multiplexed requests, HPACK header
compression, flow control, server push.

Subatoms: HTTP/2 frame parser/serializer (10 frame types), HPACK static table,
HPACK Huffman decoder (custom 256-symbol tree), HPACK dynamic table, stream
state machine (RFC 7540 §5.1), flow control window manager, priority tree,
request/response assembler.

---

## Regular expression engine

A from-scratch regex implementation supporting the most-used subset: character
classes, quantifiers, groups, alternation, backreferences, lookahead.

Subatoms: regex parser (pattern string → AST), NFA builder (Thompson
construction), NFA → DFA subset construction, DFA minimizer, backtracking
interpreter (for backreferences), character class set operations (union,
intersection, negation), Unicode category tables.

---

## Ed25519

Sign and verify with Ed25519. Requires modular arithmetic over a 255-bit prime
field — a serious bignum exercise.

Subatoms: bigint modular arithmetic (add, sub, mul, pow, inverse mod p),
Edwards curve point operations (add, double, scalar multiply), SHA-512, message
encoding (RFC 8032), key derivation, constant-time comparison.

---

## Floating-point printf

Format an IEEE 754 double to a decimal string with correct rounding. Implements
Ryu or Grisu2 algorithm — the kind of thing every language runtime needs.

Subatoms: IEEE 754 bit decomposer (sign, exponent, mantissa), 128-bit integer
multiply, Ryu lookup tables (powers of 5, powers of 2), shortest representation
algorithm, fixed/scientific/general format selectors, NaN/Infinity handling.

---

## Tar archive

Read and write POSIX tar archives (ustar format). Simple header-per-file
structure, 512-byte aligned blocks.

Subatoms: tar header parser (name, mode, uid, gid, size, mtime, checksum,
typeflag), header checksum calculator, octal string codec, long name extension
parser (@@LongLink), tar entry iterator, tar writer.

---

## DNS resolver

Construct and parse DNS packets. Enough to resolve A, AAAA, CNAME, MX, TXT
records given raw UDP send/receive.

Subatoms: DNS packet builder (header, question, resource record), DNS name
compression (pointer following), DNS packet parser, record type decoders (A →
IPv4, AAAA → IPv6, MX → preference + name), query ID generator, response
matching.

---

## S-expression evaluator

A minimal Lisp: parse, evaluate, define functions, closures, tail-call
optimization. Small enough to be tractable, deep enough to be interesting.

Subatoms: tokenizer, S-expression parser, environment (scope chain),
eval/apply core, special forms (define, lambda, if, quote, set!), built-in
arithmetic and list operations, tail-call trampoline, REPL loop.

---

## Ray tracer

Render a 3D scene to a pixel buffer. Spheres, planes, point lights, shadows,
reflections.

Subatoms: Vec3 (add, sub, dot, cross, normalize, scale), Ray (origin +
direction), sphere intersection, plane intersection, Phong shading, shadow ray
tester, recursive reflection tracer, camera (ray generation from pixel coords),
scene graph, PPM image writer, PNG encode (exists after ideas.md work).

---

## BigDecimal

Arbitrary-precision decimal arithmetic with correct rounding. Needed for
financial calculations, scientific computing, or implementing printf.

Subatoms: arbitrary-length digit array, addition, subtraction, long
multiplication, long division with remainder, rounding modes (half-even,
half-up, ceiling, floor, truncate), decimal shift, string parser, string
formatter, comparison operators.

---

## WebSocket framing

Parse and construct WebSocket frames (RFC 6455). Enough to send/receive
text and binary messages given a raw TCP byte stream.

Subatoms: frame parser (fin, opcode, mask, payload length, masking key),
frame builder, masking/unmasking XOR, fragmentation reassembler, close frame
handshake, ping/pong handler, SHA-1 (for the upgrade handshake), Base64 (exists
or leaf).

---

## TOML parser

Parse TOML 1.0 into a nested object. Surprisingly tricky: multiline strings,
inline tables, dotted keys, datetime literals, array-of-tables.

Subatoms: TOML tokenizer, basic value parsers (string, integer, float, boolean,
datetime), dotted key resolver, table header parser, array-of-tables merger,
inline table parser, multiline string handler, escape sequence decoder.
