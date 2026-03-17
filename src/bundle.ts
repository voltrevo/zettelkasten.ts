// CRC-32 lookup table
const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  CRC32_TABLE[i] = c >>> 0;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const b of data) {
    crc = (CRC32_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Extract atom hashes referenced by import statements in an atom.
export function extractDependencies(content: string): string[] {
  const hashes: string[] = [];
  const re =
    /from\s+["']\.\.\/\.\.\/([a-z0-9]{2})\/([a-z0-9]{2})\/([a-z0-9]{21})\.ts["']/g;
  let m;
  while ((m = re.exec(content)) !== null) hashes.push(m[1] + m[2] + m[3]);
  return hashes;
}

// Walk the dependency graph and return all atoms (hash → content).
export async function collectAtoms(
  rootHash: string,
  readFile: (hash: string) => Promise<string>,
): Promise<Map<string, string>> {
  const collected = new Map<string, string>();
  const queue = [rootHash];
  while (queue.length > 0) {
    const hash = queue.shift()!;
    if (collected.has(hash)) continue;
    const content = await readFile(hash);
    collected.set(hash, content);
    for (const dep of extractDependencies(content)) {
      if (!collected.has(dep)) queue.push(dep);
    }
  }
  return collected;
}

// Build a store-only (STORE, no compression) ZIP from a map of path → bytes.
export function buildZip(files: Map<string, Uint8Array>): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const entries: {
    nameBytes: Uint8Array;
    data: Uint8Array;
    crc: number;
    offset: number;
  }[] = [];
  let offset = 0;

  for (const [name, data] of files) {
    const nameBytes = enc.encode(name);
    const c = crc32(data);
    const local = new Uint8Array(30 + nameBytes.length);
    const v = new DataView(local.buffer);
    v.setUint32(0, 0x04034b50, true); // local file header sig
    v.setUint16(4, 20, true); // version needed
    v.setUint16(6, 0, true); // flags
    v.setUint16(8, 0, true); // compression: STORE
    v.setUint16(10, 0, true); // mod time
    v.setUint16(12, 0, true); // mod date
    v.setUint32(14, c, true); // CRC-32
    v.setUint32(18, data.length, true); // compressed size
    v.setUint32(22, data.length, true); // uncompressed size
    v.setUint16(26, nameBytes.length, true); // filename length
    v.setUint16(28, 0, true); // extra field length
    local.set(nameBytes, 30);

    entries.push({ nameBytes, data, crc: c, offset });
    parts.push(local, data);
    offset += local.length + data.length;
  }

  const centralDirOffset = offset;
  let centralDirSize = 0;
  for (const e of entries) {
    const cd = new Uint8Array(46 + e.nameBytes.length);
    const v = new DataView(cd.buffer);
    v.setUint32(0, 0x02014b50, true); // central dir sig
    v.setUint16(4, 20, true); // version made by
    v.setUint16(6, 20, true); // version needed
    v.setUint16(8, 0, true); // flags
    v.setUint16(10, 0, true); // compression: STORE
    v.setUint16(12, 0, true); // mod time
    v.setUint16(14, 0, true); // mod date
    v.setUint32(16, e.crc, true); // CRC-32
    v.setUint32(20, e.data.length, true); // compressed size
    v.setUint32(24, e.data.length, true); // uncompressed size
    v.setUint16(28, e.nameBytes.length, true); // filename length
    v.setUint16(30, 0, true); // extra field length
    v.setUint16(32, 0, true); // comment length
    v.setUint16(34, 0, true); // disk start
    v.setUint16(36, 0, true); // internal attrs
    v.setUint32(38, 0, true); // external attrs
    v.setUint32(42, e.offset, true); // local header offset
    cd.set(e.nameBytes, 46);
    parts.push(cd);
    centralDirSize += cd.length;
  }

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true); // end-of-central-dir sig
  ev.setUint16(4, 0, true); // disk number
  ev.setUint16(6, 0, true); // start disk
  ev.setUint16(8, entries.length, true); // records on disk
  ev.setUint16(10, entries.length, true); // total records
  ev.setUint32(12, centralDirSize, true); // central dir size
  ev.setUint32(16, centralDirOffset, true); // central dir offset
  ev.setUint16(20, 0, true); // comment length
  parts.push(eocd);

  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

// Parse a store-only ZIP, returning a map of path → bytes.
export function parseZip(data: Uint8Array): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const dec = new TextDecoder();
  let off = 0;

  while (off + 30 <= data.length) {
    if (view.getUint32(off, true) !== 0x04034b50) break;
    const compression = view.getUint16(off + 8, true);
    if (compression !== 0) {
      throw new Error(
        "bundle contains compressed entries; only STORE is supported",
      );
    }
    const compressedSize = view.getUint32(off + 18, true);
    const filenameLen = view.getUint16(off + 26, true);
    const extraLen = view.getUint16(off + 28, true);
    const nameStart = off + 30;
    const name = dec.decode(data.slice(nameStart, nameStart + filenameLen));
    const dataStart = nameStart + filenameLen + extraLen;
    files.set(name, data.slice(dataStart, dataStart + compressedSize));
    off = dataStart + compressedSize;
  }

  return files;
}

// Build a ZIP bundle for rootHash and its transitive dependencies.
// The bundle includes a run.ts entry point and all atoms under a/.
export async function bundleZip(
  rootHash: string,
  readFile: (hash: string) => Promise<string>,
): Promise<Uint8Array> {
  const atoms = await collectAtoms(rootHash, readFile);
  const dir = rootHash.slice(0, 8);
  const enc = new TextEncoder();
  const files = new Map<string, Uint8Array>();

  // Unified entry point — imports root atom's main and calls it with globalThis
  const rootAtomPath = `./a/${rootHash.slice(0, 2)}/${rootHash.slice(2, 4)}/${
    rootHash.slice(4)
  }.ts`;
  const runTs =
    `import { main } from "${rootAtomPath}";\nawait main(globalThis);\n`;
  files.set(`${dir}/run.ts`, enc.encode(runTs));

  for (const [hash, content] of atoms) {
    files.set(
      `${dir}/a/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash.slice(4)}.ts`,
      enc.encode(content),
    );
  }

  return buildZip(files);
}
