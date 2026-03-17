import { brotliCompress, constants } from "node:zlib";
import { promisify } from "node:util";
import { keccak_256 } from "@noble/hashes/sha3";
import { bundleZip } from "./bundle.ts";
import { validateAtom } from "./validate.ts";

const brotliCompressP = promisify(brotliCompress);

export const STORAGE_DIR = `${Deno.env.get("HOME")}/.local/share/zettelkasten`;
export const PORT = 8000;

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

  return new Response("Not found", { status: 404 });
}

export async function serve(): Promise<void> {
  await initRepo();
  Deno.serve({ port: PORT }, handler);
  console.log(`Listening on http://localhost:${PORT}`);
  console.log(
    "  POST /a                        — store atom (requires X-Commit-Message header)",
  );
  console.log(
    "  GET  /a/<aa>/<bb>/<rest>.ts    — retrieve code by content address",
  );
  console.log(
    "  GET  /bundle/<hash>            — download zip bundle of atom + dependencies",
  );
}
