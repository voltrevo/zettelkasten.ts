import { brotliCompress, constants } from "node:zlib";
import { promisify } from "node:util";
import { keccak_256 } from "@noble/hashes/sha3";
import { bundleZip } from "./bundle.ts";
import { EmbeddingStore, RelationshipStore } from "./db.ts";
import type { Relationship } from "./db.ts";
import {
  checkEmbeddingService,
  defaultEmbedConfig,
  fetchEmbedding,
} from "./embed.ts";
import { HnswIndex } from "./hnsw.ts";
import { validateAtom } from "./validate.ts";

const brotliCompressP = promisify(brotliCompress);

export const STORAGE_DIR = `${Deno.env.get("HOME")}/.local/share/zettelkasten`;
export const PORT = 8000;

const embedConfig = defaultEmbedConfig();
const EMBED_DIM = parseInt(Deno.env.get("ZTS_EMBED_DIM") ?? "768");

const KNOWN_RELATIONSHIP_KINDS = new Set(["tests"]);
const TEST_RUNNER = new URL("./test-runner.ts", import.meta.url).pathname;

let embedStore: EmbeddingStore;
let hnswIndex: HnswIndex;
let relStore: RelationshipStore;

async function git(...args: string[]): Promise<string> {
  const cmd = new Deno.Command("git", {
    args,
    cwd: STORAGE_DIR,
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await cmd.output();
  if (code !== 0) {
    throw new Error(new TextDecoder().decode(stderr));
  }
  return new TextDecoder().decode(stdout).trim();
}

async function initRepo(): Promise<void> {
  await Deno.mkdir(STORAGE_DIR, { recursive: true });
  try {
    await git("rev-parse", "--git-dir");
  } catch {
    await git("init");
    await git("commit", "--allow-empty", "-m", "init");
  }
}

// 25 base36 chars = 25 * log2(36) ≈ 129.2 bits
const BASE36_LEN = 25;

function contentHash(content: string): string {
  const bytes = new TextEncoder().encode(content);
  const hash = keccak_256(bytes);
  // encode first 17 bytes as big-endian bigint → base36, pad to fixed length
  let n = 0n;
  for (const b of hash.slice(0, 17)) n = (n << 8n) | BigInt(b);
  return n.toString(36).padStart(BASE36_LEN, "0").slice(0, BASE36_LEN);
}

function hashToUrlPath(hash: string): string {
  return `/a/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash.slice(4)}.ts`;
}

function hashToFilePath(hash: string): string {
  return `${STORAGE_DIR}/a/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${
    hash.slice(4)
  }.ts`;
}

async function handler(req: Request): Promise<Response> {
  const start = performance.now();
  const res = await route(req);
  const ms = (performance.now() - start).toFixed(1);
  const url = new URL(req.url);
  console.log(
    `${
      new Date().toISOString()
    } ${req.method} ${url.pathname} ${res.status} ${ms}ms`,
  );
  return res;
}

async function route(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  // GET /a/<aa>/<bb>/<rest>.ts — retrieve code by content address
  if (req.method === "GET") {
    const match = path.match(
      /^\/a\/([a-z0-9]{2})\/([a-z0-9]{2})\/([a-z0-9]+)\.ts$/,
    );
    if (match) {
      const filePath = `${STORAGE_DIR}${path}`;
      try {
        const content = await Deno.readTextFile(filePath);
        return new Response(content, {
          headers: { "content-type": "application/typescript" },
        });
      } catch {
        return new Response("Not found", { status: 404 });
      }
    }
  }

  // POST /a — store atom, returns content address URL
  if (req.method === "POST" && path === "/a") {
    const message = req.headers.get("x-commit-message");
    if (!message) {
      return new Response("Missing X-Commit-Message header", { status: 400 });
    }
    const content = await req.text();
    if (!content) {
      return new Response("Empty content", { status: 400 });
    }

    const validationError = await validateAtom(content);
    if (validationError) {
      return new Response(validationError.message, { status: 422 });
    }

    const hash = contentHash(content);
    const urlPath = hashToUrlPath(hash);
    const filePath = hashToFilePath(hash);

    try {
      await Deno.stat(filePath);
      // already exists — idempotent, no commit needed
      return new Response(`${urlPath}\n`, {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    } catch { /* not found, proceed */ }

    await Deno.mkdir(filePath.replace(/\/[^/]+$/, ""), { recursive: true });
    await Deno.writeTextFile(filePath, content);

    await git(
      "add",
      `a/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash.slice(4)}.ts`,
    );
    await git("commit", "-m", `${hash.slice(0, 8)}: ${message}`);

    return new Response(`${urlPath}\n`, {
      status: 201,
      headers: { "content-type": "text/plain" },
    });
  }

  // GET /bundle/<hash> — zip of atom and all transitive dependencies
  if (req.method === "GET") {
    const bundleMatch = path.match(/^\/bundle\/([a-z0-9]{25})$/);
    if (bundleMatch) {
      const hash = bundleMatch[1];
      let zip: Uint8Array;
      try {
        zip = await bundleZip(
          hash,
          (h) => Deno.readTextFile(hashToFilePath(h)),
        );
      } catch (e) {
        return new Response((e as Error).message, { status: 404 });
      }
      const accept = req.headers.get("accept-encoding") ?? "";
      if (accept.includes("br")) {
        const compressed = await brotliCompressP(zip, {
          params: { [constants.BROTLI_PARAM_QUALITY]: 5 },
        }) as Uint8Array;
        const compressedBuf = compressed.buffer.slice(
          compressed.byteOffset,
          compressed.byteOffset + compressed.byteLength,
        );
        return new Response(new Blob([compressedBuf as ArrayBuffer]), {
          headers: {
            "content-type": "application/zip",
            "content-encoding": "br",
            "content-disposition": `attachment; filename="${
              hash.slice(0, 8)
            }.zip"`,
          },
        });
      }
      return new Response(new Blob([zip.buffer as ArrayBuffer]), {
        headers: {
          "content-type": "application/zip",
          "content-disposition": `attachment; filename="${
            hash.slice(0, 8)
          }.zip"`,
        },
      });
    }
  }

  // POST /a/<hash>/description — store a searchable description for an atom
  if (req.method === "POST") {
    const descMatch = path.match(/^\/a\/([a-z0-9]{25})\/description$/);
    if (descMatch) {
      const hash = descMatch[1];
      // Verify atom exists
      try {
        await Deno.stat(hashToFilePath(hash));
      } catch {
        return new Response("Atom not found", { status: 404 });
      }
      const description = (await req.text()).trim();
      if (!description) {
        return new Response("Empty description", { status: 400 });
      }
      const vec = await fetchEmbedding(description, embedConfig);
      if (!vec) {
        return new Response(
          JSON.stringify({ error: "embedding service unavailable" }),
          { status: 503, headers: { "content-type": "application/json" } },
        );
      }
      const isNew = !embedStore.hasHash(hash);
      embedStore.upsert(hash, description, vec);
      hnswIndex.add(hash, vec);
      return new Response("ok\n", {
        status: isNew ? 201 : 200,
        headers: { "content-type": "text/plain" },
      });
    }
  }

  // GET /a/<hash>/description — retrieve stored description
  if (req.method === "GET") {
    const descMatch = path.match(/^\/a\/([a-z0-9]{25})\/description$/);
    if (descMatch) {
      const desc = embedStore.getDescription(descMatch[1]);
      if (!desc) return new Response("Not found", { status: 404 });
      return new Response(desc, { headers: { "content-type": "text/plain" } });
    }
  }

  // GET /search?q=<text>[&k=10] — semantic nearest-neighbor search
  if (req.method === "GET" && path === "/search") {
    const q = url.searchParams.get("q")?.trim();
    if (!q) return new Response("Missing ?q=", { status: 400 });
    const k = Math.min(
      parseInt(url.searchParams.get("k") ?? "10", 10),
      100,
    );
    if (isNaN(k) || k < 1) return new Response("Invalid k", { status: 400 });

    const queryVec = await fetchEmbedding(q, embedConfig);
    if (!queryVec) {
      return new Response(
        JSON.stringify({ error: "embedding service unavailable" }),
        { status: 503, headers: { "content-type": "application/json" } },
      );
    }

    const hits = hnswIndex.search(queryVec, k);
    const body = hits.map(({ hash, score }) => ({
      hash,
      score,
      url: hashToUrlPath(hash),
      description: embedStore.getDescription(hash) ?? "",
    }));
    return new Response(JSON.stringify(body), {
      headers: { "content-type": "application/json" },
    });
  }

  // POST /relationships — add a relationship between two atoms
  if (req.method === "POST" && path === "/relationships") {
    let body: { kind?: string; from?: string; to?: string };
    try {
      body = await req.json();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }
    const { kind, from, to } = body;
    if (!kind || !from || !to) {
      return new Response("Missing kind, from, or to", { status: 400 });
    }
    if (!KNOWN_RELATIONSHIP_KINDS.has(kind)) {
      return new Response(
        `Unknown relationship kind "${kind}". Known kinds: ${
          [...KNOWN_RELATIONSHIP_KINDS].join(", ")
        }`,
        { status: 400 },
      );
    }
    if (!/^[a-z0-9]{25}$/.test(from) || !/^[a-z0-9]{25}$/.test(to)) {
      return new Response("Invalid hash format", { status: 400 });
    }
    try {
      await Deno.stat(hashToFilePath(from));
    } catch {
      return new Response(`Atom not found: ${from}`, { status: 404 });
    }
    try {
      await Deno.stat(hashToFilePath(to));
    } catch {
      return new Response(`Atom not found: ${to}`, { status: 404 });
    }

    if (kind === "tests") {
      const serverUrl = `http://localhost:${PORT}`;
      const proc = new Deno.Command(Deno.execPath(), {
        args: [
          "test",
          `--allow-import=localhost:${PORT}`,
          "--allow-env=ZTS_SERVER_URL,ZTS_TARGET,ZTS_TESTS",
          "--no-lock",
          TEST_RUNNER,
        ],
        env: {
          ZTS_SERVER_URL: serverUrl,
          ZTS_TARGET: to,
          ZTS_TESTS: from,
        },
        stdout: "piped",
        stderr: "piped",
      });
      let output: Deno.CommandOutput;
      try {
        const timeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Test timed out after 2s")), 2000)
        );
        output = await Promise.race([proc.output(), timeout]);
      } catch (e) {
        return new Response((e as Error).message, { status: 422 });
      }
      if (output.code !== 0) {
        const text = new TextDecoder().decode(output.stdout) +
          new TextDecoder().decode(output.stderr);
        return new Response(text, { status: 422 });
      }
    }

    const isNew = relStore.insert(from, kind, to);
    return new Response("ok\n", {
      status: isNew ? 201 : 200,
      headers: { "content-type": "text/plain" },
    });
  }

  // DELETE /relationships — remove a relationship
  if (req.method === "DELETE" && path === "/relationships") {
    let body: { kind?: string; from?: string; to?: string };
    try {
      body = await req.json();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }
    const { kind, from, to } = body;
    if (!kind || !from || !to) {
      return new Response("Missing kind, from, or to", { status: 400 });
    }
    const deleted = relStore.delete(from, kind, to);
    if (!deleted) return new Response("Not found", { status: 404 });
    return new Response("ok\n", { headers: { "content-type": "text/plain" } });
  }

  // GET /relationships?from=&to=&kind= — query relationships
  if (req.method === "GET" && path === "/relationships") {
    const from = url.searchParams.get("from") ?? undefined;
    const to = url.searchParams.get("to") ?? undefined;
    const kind = url.searchParams.get("kind") ?? undefined;
    if (!from && !to && !kind) {
      return new Response("At least one of from, to, kind is required", {
        status: 400,
      });
    }
    const rows: Relationship[] = relStore.query({ from, to, kind });
    return new Response(JSON.stringify(rows), {
      headers: { "content-type": "application/json" },
    });
  }

  return new Response("Not found", { status: 404 });
}

export async function serve(): Promise<void> {
  await initRepo();

  embedStore = new EmbeddingStore(`${STORAGE_DIR}/zts.db`);
  relStore = new RelationshipStore(`${STORAGE_DIR}/zts.db`);
  const allVecs = embedStore.getAll();
  hnswIndex = HnswIndex.create(
    EMBED_DIM,
    Math.max(allVecs.size * 2, 1024),
  );
  for (const [hash, vec] of allVecs) hnswIndex.add(hash, vec);
  if (allVecs.size > 0) {
    console.log(`Loaded ${hnswIndex.size} embeddings into HNSW index`);
  }

  // Warn if embedding service is unreachable (non-blocking)
  checkEmbeddingService(embedConfig).then((ok) => {
    if (!ok) {
      console.warn(
        `warning: embedding service not reachable at ${embedConfig.url}`,
      );
      console.warn(
        "  POST /a/<hash>/description and GET /search will return 503",
      );
      console.warn(
        "  Existing embeddings are still indexed and searchable if present",
      );
    }
  });

  Deno.serve({ port: PORT }, handler);
  console.log(`Listening on http://localhost:${PORT}`);
  console.log(
    "  POST /a                          — store atom (requires X-Commit-Message header)",
  );
  console.log(
    "  GET  /a/<aa>/<bb>/<rest>.ts      — retrieve code by content address",
  );
  console.log(
    "  GET  /bundle/<hash>              — download zip bundle of atom + dependencies",
  );
  console.log(
    "  POST /a/<hash>/description       — store searchable description for an atom",
  );
  console.log(
    "  GET  /a/<hash>/description       — retrieve description",
  );
  console.log(
    "  GET  /search?q=<text>[&k=10]     — semantic nearest-neighbor search",
  );
}
