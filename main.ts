import { keccak_256 } from "@noble/hashes/sha3";

const STORAGE_DIR = `${Deno.env.get("HOME")}/.local/share/zettelkasten`;

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

async function initRepo() {
  await Deno.mkdir(STORAGE_DIR, { recursive: true });
  try {
    await git("rev-parse", "--git-dir");
  } catch {
    await git("init");
    await git("commit", "--allow-empty", "-m", "init");
  }
}

await initRepo();

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
  return `/h/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash.slice(4)}.ts`;
}

function hashToFilePath(hash: string): string {
  return `${STORAGE_DIR}/h/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash.slice(4)}.ts`;
}

Deno.serve({ port: 8000 }, async (req: Request) => {
  const url = new URL(req.url);
  const path = url.pathname;

  // GET /h/<aa>/<bb>/<rest>.ts — retrieve code by content address
  if (req.method === "GET") {
    const match = path.match(/^\/h\/([a-z0-9]{2})\/([a-z0-9]{2})\/([a-z0-9]+)\.ts$/);
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

  // POST /h — store code, returns content address URL
  if (req.method === "POST" && path === "/h") {
    const message = req.headers.get("x-commit-message");
    if (!message) {
      return new Response("Missing X-Commit-Message header", { status: 400 });
    }
    const content = await req.text();
    if (!content) {
      return new Response("Empty content", { status: 400 });
    }

    const hash = contentHash(content);
    const urlPath = hashToUrlPath(hash);
    const filePath = hashToFilePath(hash);

    await Deno.mkdir(filePath.replace(/\/[^/]+$/, ""), { recursive: true });
    await Deno.writeTextFile(filePath, content);

    await git("add", `h/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash.slice(4)}.ts`);
    await git("commit", "--allow-empty", "-m", `${hash.slice(0, 8)}: ${message}`);

    return new Response(`${urlPath}\n`, {
      status: 201,
      headers: { "content-type": "text/plain" },
    });
  }

  return new Response("Not found", { status: 404 });
});

console.log("Listening on http://localhost:8000");
console.log("  POST /h                        — store code (requires X-Commit-Message header)");
console.log("  GET  /h/<aa>/<bb>/<rest>.ts    — retrieve code by content address");
