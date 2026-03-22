import { brotliCompress, constants } from "node:zlib";
import { promisify } from "node:util";
import { keccak_256 } from "@noble/hashes/sha3";
import { bundleZip, extractDependencies } from "./bundle.ts";
import {
  type AuthConfig,
  type AuthTier,
  checkAuth,
  resolveAuthTier,
} from "./auth.ts";
import { AmbiguousHashError, Db } from "./db.ts";
import type { Relationship } from "./db.ts";
import {
  checkEmbeddingService,
  defaultEmbedConfig,
  fetchEmbedding,
} from "./embed.ts";
import { HnswIndex } from "./hnsw.ts";
import { minify } from "./minify.ts";
import { getDefaultPrompt, type PromptName } from "./prompts.ts";
import { validateAtom } from "./validate.ts";

const brotliCompressP = promisify(brotliCompress);

export const DATA_DIR = `${Deno.env.get("HOME")}/.local/share/zettelkasten`;
export const PORT = 8000;

let embedConfig = defaultEmbedConfig();
let embedDim = parseInt(Deno.env.get("ZTS_embedDim") ?? "768");

const KNOWN_RELATIONSHIP_KINDS = new Set(["tests", "imports", "supersedes"]);
const TEST_RUNNER = new URL("./test-runner.ts", import.meta.url).pathname;

const PROCESS_TIMEOUT_MS = 5000; // process lifecycle (startup + import + run)

const ADMIN_ONLY_PROPERTIES = new Set(["starred"]);

const UI_DIR = new URL("../ui/dist", import.meta.url).pathname;
const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

async function serveStatic(filePath: string): Promise<Response | null> {
  try {
    const data = await Deno.readFile(filePath);
    const ext = filePath.substring(filePath.lastIndexOf("."));
    return new Response(data, {
      headers: {
        "content-type": MIME_TYPES[ext] ?? "application/octet-stream",
        "cache-control": "no-cache",
      },
    });
  } catch {
    return null;
  }
}

let db: Db;
let hnswIndex: HnswIndex;
let authConfig: AuthConfig;
let serverPort: number = PORT;

async function gzipSize(text: string): Promise<number> {
  const stream = new CompressionStream("gzip");
  const writer = stream.writable.getWriter();
  writer.write(new TextEncoder().encode(text));
  writer.close();
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream.readable as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return chunks.reduce((n, c) => n + c.length, 0);
}

/** Run test atoms against a target. Records results in test_runs. Returns null on success, or an error Response. */
async function runTests(
  testHashes: string[],
  targetHash: string,
): Promise<Response | null> {
  const serverUrl = `http://localhost:${serverPort}`;
  const start = performance.now();
  const proc = new Deno.Command(Deno.execPath(), {
    args: [
      "test",
      `--allow-import=localhost:${serverPort}`,
      "--allow-env=ZTS_SERVER_URL,ZTS_TARGET,ZTS_TESTS",
      "--no-lock",
      TEST_RUNNER,
    ],
    env: {
      ZTS_SERVER_URL: serverUrl,
      ZTS_TARGET: targetHash,
      ZTS_TESTS: testHashes.join(","),
    },
    stdout: "piped",
    stderr: "piped",
  });
  let output: Deno.CommandOutput;
  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Test timed out after ${PROCESS_TIMEOUT_MS}ms`)),
        PROCESS_TIMEOUT_MS,
      )
    );
    output = await Promise.race([proc.output(), timeout]);
  } catch (e) {
    const durationMs = Math.round(performance.now() - start);
    for (const th of testHashes) {
      db.insertTestRun({
        testAtom: th,
        targetAtom: targetHash,
        runBy: "checker",
        result: "fail",
        durationMs,
        details: (e as Error).message,
      });
    }
    return new Response((e as Error).message, { status: 422 });
  }
  const durationMs = Math.round(performance.now() - start);
  const passed = output.code === 0;
  const text = new TextDecoder().decode(output.stdout) +
    new TextDecoder().decode(output.stderr);

  for (const th of testHashes) {
    db.insertTestRun({
      testAtom: th,
      targetAtom: targetHash,
      runBy: "checker",
      result: passed ? "pass" : "fail",
      durationMs,
      details: passed ? null : text,
    });
  }

  if (!passed) {
    return new Response(text, { status: 422 });
  }
  return null;
}

/** Walk transitive deps of content; return error Response if any lack tests. */
function checkDepsTested(content: string): Response | null {
  const visited = new Set<string>();
  const queue = extractDependencies(content);
  const untested: string[] = [];

  while (queue.length > 0) {
    const dep = queue.shift()!;
    if (visited.has(dep)) continue;
    visited.add(dep);

    const tests = db.queryRelationships({ to: dep, kind: "tests" });
    if (tests.length === 0) untested.push(dep);

    // Walk deeper
    const depSource = db.getSource(dep);
    if (depSource) {
      for (const sub of extractDependencies(depSource)) {
        if (!visited.has(sub)) queue.push(sub);
      }
    }
  }

  if (untested.length > 0) {
    return new Response(`Untested deps: ${untested.join(", ")}`, {
      status: 422,
    });
  }
  return null;
}

// 25 base36 chars = 25 * log2(36) ~ 129.2 bits
const BASE36_LEN = 25;

function contentHash(content: string): string {
  const bytes = new TextEncoder().encode(content);
  const hash = keccak_256(bytes);
  let n = 0n;
  for (const b of hash.slice(0, 17)) n = (n << 8n) | BigInt(b);
  return n.toString(36).padStart(BASE36_LEN, "0").slice(0, BASE36_LEN);
}

export function hashToUrlPath(hash: string): string {
  return `/a/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash.slice(4)}.ts`;
}

function parseHashFromPath(path: string): string | null {
  const match = path.match(
    /^\/a\/([a-z0-9]{2})\/([a-z0-9]{2})\/([a-z0-9]{21})\.ts$/,
  );
  if (!match) return null;
  return match[1] + match[2] + match[3];
}

/** Extract bearer token from Authorization header or zts_token cookie. */
function extractToken(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth) return auth;
  const cookie = req.headers.get("cookie");
  if (cookie) {
    const match = cookie.match(/(?:^|;\s*)zts_token=([^\s;]+)/);
    if (match) return `Bearer ${match[1]}`;
  }
  return null;
}

/** Check auth tier for a request. Returns error Response or null. */
function requireAuth(req: Request, tier: AuthTier): Response | null {
  const resolved = resolveAuthTier(extractToken(req), authConfig);
  return checkAuth(resolved, tier);
}

/** Resolve a hash prefix. Returns full hash or an error Response. */
function resolveHash(prefix: string): string | Response {
  try {
    const hash = db.resolveHash(prefix);
    if (!hash) return new Response("Not found", { status: 404 });
    return hash;
  } catch (e) {
    if (e instanceof AmbiguousHashError) {
      return new Response(e.message, { status: 400 });
    }
    throw e;
  }
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

  // --- Static UI routes ---
  if (req.method === "GET" && path === "/") {
    return (await serveStatic(`${UI_DIR}/index.html`)) ??
      new Response("Not found", { status: 404 });
  }
  if (req.method === "GET" && path === "/ui") {
    return new Response(null, {
      status: 301,
      headers: { location: "/ui/" },
    });
  }
  // POST /ui/login — set auth cookie
  if (req.method === "POST" && path === "/ui/login") {
    const body = await req.json();
    const token = body.token as string;
    if (!token) {
      return new Response("Missing token", { status: 400 });
    }
    const tier = resolveAuthTier(`Bearer ${token}`, authConfig);
    if (!tier) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }
    const cookie =
      `zts_token=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`;
    return new Response(JSON.stringify({ tier }), {
      headers: {
        "content-type": "application/json",
        "set-cookie": cookie,
      },
    });
  }

  // POST /ui/logout — clear auth cookie
  if (req.method === "POST" && path === "/ui/logout") {
    const cookie = "zts_token=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0";
    return new Response(null, {
      status: 204,
      headers: { "set-cookie": cookie },
    });
  }

  // GET /ui/login.html — always accessible (no auth required)
  if (req.method === "GET" && path === "/ui/login.html") {
    return (await serveStatic(`${UI_DIR}/login.html`)) ??
      new Response("Not found", { status: 404 });
  }

  // Static UI files (catch-all) — require auth for app shell
  if (req.method === "GET" && path.startsWith("/ui/")) {
    // Gate the app shell behind auth
    if (path === "/ui/" || path === "/ui/app.html") {
      const token = extractToken(req);
      const tier = resolveAuthTier(token, authConfig);
      if (!tier || tier === "unauthed") {
        return new Response(null, {
          status: 302,
          headers: { location: "/ui/login.html" },
        });
      }
    }
    const rel = path === "/ui/" ? "app.html" : path.slice(4);
    if (rel.includes("..")) return new Response("Forbidden", { status: 403 });
    return (await serveStatic(`${UI_DIR}/${rel}`)) ??
      new Response("Not found", { status: 404 });
  }

  // GET /a/<aa>/<bb>/<rest>.ts — retrieve code by content address
  if (req.method === "GET") {
    const hash = parseHashFromPath(path);
    if (hash) {
      const source = db.getSource(hash);
      if (!source) return new Response("Not found", { status: 404 });
      return new Response(source, {
        headers: { "content-type": "application/typescript" },
      });
    }
  }

  // POST /a — store atom [dev]
  if (req.method === "POST" && path === "/a") {
    const authErr = requireAuth(req, "dev");
    if (authErr) return authErr;
    const description = req.headers.get("x-description");
    const allowNoDesc = req.headers.get("x-allow-no-description");
    if (!description && !allowNoDesc) {
      return new Response(
        "Missing X-Description header. Use X-Allow-No-Description: true to opt out.",
        { status: 400 },
      );
    }
    const goal = req.headers.get("x-goal") || undefined;
    if (goal && !db.goalExists(goal)) {
      return new Response(`Goal not found: ${goal}`, { status: 400 });
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

    // Idempotent: already exists
    if (db.atomExists(hash)) {
      return new Response(`${urlPath}\n`, {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    }

    // Optional: run tests before storing
    const requireTests = req.headers.get("x-require-tests");
    if (requireTests) {
      const testHashes = requireTests.split(",").map((s) => s.trim()).filter(
        Boolean,
      );
      for (const th of testHashes) {
        if (!/^[a-z0-9]{25}$/.test(th)) {
          return new Response(`Invalid test hash: ${th}`, { status: 400 });
        }
        if (!db.atomExists(th)) {
          return new Response(`Test atom not found: ${th}`, { status: 404 });
        }
      }

      // Verify all transitive deps are tested
      const depCheck = checkDepsTested(content);
      if (depCheck) return depCheck;

      const fail = await runTests(testHashes, hash);
      if (fail) return fail;

      // Store atom first (tests need it served for the idempotent case,
      // but we already checked it doesn't exist above)
      const gz = await gzipSize(minify(content));
      db.insertAtom(hash, content, gz, description ?? "", goal);

      // Auto-register test relationships + evaluation metadata
      for (const th of testHashes) {
        db.insertRelationship(th, "tests", hash);
        db.upsertTestEvaluation(th, hash, "pass");
      }

      // Auto-register import relationships
      for (const dep of extractDependencies(content)) {
        db.insertRelationship(hash, "imports", dep);
      }

      db.insertLog({
        op: "atom.create",
        subject: hash,
        detail: JSON.stringify({ gzip_size: gz }),
      });

      // Generate embedding if description provided
      if (description) {
        const vec = await fetchEmbedding(description, embedConfig);
        if (vec) {
          db.upsertEmbedding(hash, vec, description);
          hnswIndex.add(hash, vec);
        }
      }

      return new Response(`${urlPath}\n`, {
        status: 201,
        headers: { "content-type": "text/plain" },
      });
    }

    // No test gate — just store
    const gz = await gzipSize(minify(content));
    db.insertAtom(hash, content, gz, description ?? "", goal);

    // Auto-register import relationships
    for (const dep of extractDependencies(content)) {
      db.insertRelationship(hash, "imports", dep);
    }

    db.insertLog({
      op: "atom.create",
      subject: hash,
      detail: JSON.stringify({ gzip_size: gz }),
    });

    // Generate embedding if description provided
    if (description) {
      const vec = await fetchEmbedding(description, embedConfig);
      if (vec) {
        db.upsertEmbedding(hash, vec, description);
        hnswIndex.add(hash, vec);
      }
    }

    return new Response(`${urlPath}\n`, {
      status: 201,
      headers: { "content-type": "text/plain" },
    });
  }

  // GET /bundle/<hash> — zip of atom and all transitive dependencies
  if (req.method === "GET") {
    const bundleMatch = path.match(/^\/bundle\/([a-z0-9]+)$/);
    if (bundleMatch) {
      const resolved = resolveHash(bundleMatch[1]);
      if (resolved instanceof Response) return resolved;
      const hash = resolved;
      let zip: Uint8Array;
      try {
        zip = await bundleZip(
          hash,
          (h) => {
            const source = db.getSource(h);
            if (!source) throw new Error(`Atom not found: ${h}`);
            return Promise.resolve(source);
          },
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

  // POST /a/<hash>/description — update description [dev]
  if (req.method === "POST") {
    const descMatch = path.match(/^\/a\/([a-z0-9]+)\/description$/);
    if (descMatch) {
      const authErr = requireAuth(req, "dev");
      if (authErr) return authErr;
      const resolved = resolveHash(descMatch[1]);
      if (resolved instanceof Response) return resolved;
      const hash = resolved;
      const description = (await req.text()).trim();
      if (!description) {
        return new Response("Empty description", { status: 400 });
      }
      db.updateDescription(hash, description);
      const vec = await fetchEmbedding(description, embedConfig);
      if (!vec) {
        return new Response(
          JSON.stringify({ error: "embedding service unavailable" }),
          { status: 503, headers: { "content-type": "application/json" } },
        );
      }
      db.upsertEmbedding(hash, vec, description);
      hnswIndex.add(hash, vec);

      db.insertLog({
        op: "atom.describe",
        subject: hash,
      });

      return new Response("ok\n", {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    }
  }

  // GET /a/<hash>/description — retrieve stored description
  if (req.method === "GET") {
    const descMatch = path.match(/^\/a\/([a-z0-9]+)\/description$/);
    if (descMatch) {
      const resolved = resolveHash(descMatch[1]);
      if (resolved instanceof Response) return resolved;
      const desc = db.getDescription(resolved);
      if (!desc) return new Response("Not found", { status: 404 });
      return new Response(desc, { headers: { "content-type": "text/plain" } });
    }
  }

  // GET /search?q=<text>[&k=10] — semantic search
  // GET /search?code=<text>[&k=20] — FTS5 source code search
  if (req.method === "GET" && path === "/search") {
    const code = url.searchParams.get("code")?.trim();
    if (code) {
      const k = Math.min(
        parseInt(url.searchParams.get("k") ?? "20", 10),
        100,
      );
      try {
        const hits = db.searchSource(code, k);
        const body = hits.map(({ hash, snippet }) => ({
          hash,
          url: hashToUrlPath(hash),
          snippet,
          description: db.getDescription(hash) ?? "",
        }));
        return new Response(JSON.stringify(body), {
          headers: { "content-type": "application/json" },
        });
      } catch (e) {
        console.error("[search] FTS error:", e);
        return new Response(
          `Search error: ${e instanceof Error ? e.message : e}`,
          { status: 400 },
        );
      }
    }

    const q = url.searchParams.get("q")?.trim();
    if (!q) return new Response("Missing ?q= or ?code=", { status: 400 });
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
      description: db.getDescription(hash) ?? "",
    }));
    return new Response(JSON.stringify(body), {
      headers: { "content-type": "application/json" },
    });
  }

  // GET /similar/<hash>?k=10 — find similar atoms by embedding
  if (req.method === "GET") {
    const simMatch = path.match(/^\/similar\/([a-z0-9]+)$/);
    if (simMatch) {
      const resolved = resolveHash(simMatch[1]);
      if (resolved instanceof Response) return resolved;
      const embedding = db.getEmbedding(resolved);
      if (!embedding) {
        return new Response("No embedding for this atom", { status: 404 });
      }
      const k = Math.min(
        parseInt(url.searchParams.get("k") ?? "10", 10),
        100,
      );
      const hits = hnswIndex.search(embedding.vector, k + 1)
        .filter((h) => h.hash !== resolved)
        .slice(0, k);
      const body = hits.map(({ hash, score }) => ({
        hash,
        score,
        url: hashToUrlPath(hash),
        description: db.getDescription(hash) ?? "",
      }));
      return new Response(JSON.stringify(body), {
        headers: { "content-type": "application/json" },
      });
    }
  }

  // GET /recent?n=N&goal=G&broken=1&prop=K&all=1 — recent atoms (default 20)
  if (req.method === "GET" && path === "/recent") {
    const n = url.searchParams.get("n");
    const all = url.searchParams.get("all") === "1";
    const goal = url.searchParams.get("goal") ?? undefined;
    const broken = url.searchParams.get("broken") === "1";
    const prop = url.searchParams.get("prop") ?? undefined;
    const limit = all ? undefined : (n ? parseInt(n, 10) : 20);
    const atoms = db.listAtoms({
      recent: limit,
      goal,
      broken,
      prop,
    });
    return new Response(JSON.stringify(atoms), {
      headers: { "content-type": "application/json" },
    });
  }

  // GET /info/<hash-or-prefix> — full atom info in one call
  if (req.method === "GET") {
    const infoMatch = path.match(/^\/info\/([a-z0-9]+)$/);
    if (infoMatch) {
      const resolved = resolveHash(infoMatch[1]);
      if (resolved instanceof Response) return resolved;
      const atom = db.getAtom(resolved);
      if (!atom) return new Response("Not found", { status: 404 });
      const imports = db.queryRelationships({
        from: resolved,
        kind: "imports",
      });
      const importedBy = db.queryRelationships({
        to: resolved,
        kind: "imports",
      });
      const tests = db.queryRelationships({ from: resolved, kind: "tests" });
      const testedBy = db.queryRelationships({ to: resolved, kind: "tests" });
      const properties = db.getProperties(resolved);
      return new Response(
        JSON.stringify({
          hash: atom.hash,
          url: hashToUrlPath(atom.hash),
          source: atom.source,
          description: atom.description,
          gzipSize: atom.gzipSize,
          goal: atom.goal,
          createdAt: atom.createdAt,
          imports: imports.map((r) => r.to),
          importedBy: importedBy.map((r) => r.from),
          tests: tests.map((r) => r.to),
          testedBy: testedBy.map((r) => r.from),
          properties: properties,
        }),
        {
          headers: { "content-type": "application/json" },
        },
      );
    }
  }

  // GET /tops/<hash>?limit=N — navigate supersedes graph to tops
  if (req.method === "GET") {
    const topsMatch = path.match(/^\/tops\/([a-z0-9]+)$/);
    if (topsMatch) {
      const resolved = resolveHash(topsMatch[1]);
      if (resolved instanceof Response) return resolved;
      const limitParam = url.searchParams.get("limit");
      const all = url.searchParams.get("all") === "1";
      const limit = all ? 999999 : (limitParam ? parseInt(limitParam, 10) : 5);
      const tops = db.findTops(resolved, limit);
      return new Response(JSON.stringify(tops), {
        headers: { "content-type": "application/json" },
      });
    }
  }

  // GET /properties?hash=H&key=K — query properties
  if (req.method === "GET" && path === "/properties") {
    const hashParam = url.searchParams.get("hash");
    if (!hashParam) {
      return new Response("Missing ?hash=", { status: 400 });
    }
    const resolved = resolveHash(hashParam);
    if (resolved instanceof Response) return resolved;
    const key = url.searchParams.get("key") ?? undefined;
    const props = db.getProperties(resolved);
    const filtered = key ? props.filter((p) => p.key === key) : props;
    return new Response(JSON.stringify(filtered), {
      headers: { "content-type": "application/json" },
    });
  }

  // POST /properties — set a property [dev, admin for restricted keys]
  if (req.method === "POST" && path === "/properties") {
    let body: { hash?: string; key?: string; value?: string };
    try {
      body = await req.json();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }
    const { key, value } = body;
    if (!body.hash || !key) {
      return new Response("Missing hash or key", { status: 400 });
    }
    const propTier = ADMIN_ONLY_PROPERTIES.has(key) ? "admin" : "dev";
    const authErr = requireAuth(req, propTier as AuthTier);
    if (authErr) return authErr;
    const resolved = resolveHash(body.hash);
    if (resolved instanceof Response) return resolved;
    db.setProperty(resolved, key, value);
    db.insertLog({
      op: "prop.set",
      subject: resolved,
      detail: JSON.stringify({ key, value: value ?? null }),
    });
    return new Response("ok\n", {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  }

  // DELETE /properties — remove a property [dev, admin for restricted keys]
  if (req.method === "DELETE" && path === "/properties") {
    let body: { hash?: string; key?: string };
    try {
      body = await req.json();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }
    if (!body.hash || !body.key) {
      return new Response("Missing hash or key", { status: 400 });
    }
    const propTier = ADMIN_ONLY_PROPERTIES.has(body.key) ? "admin" : "dev";
    const authErr = requireAuth(req, propTier as AuthTier);
    if (authErr) return authErr;
    const resolved = resolveHash(body.hash);
    if (resolved instanceof Response) return resolved;
    const removed = db.unsetProperty(resolved, body.key);
    if (!removed) return new Response("Not found", { status: 404 });
    db.insertLog({
      op: "prop.unset",
      subject: resolved,
      detail: JSON.stringify({ key: body.key }),
    });
    return new Response("ok\n", { headers: { "content-type": "text/plain" } });
  }

  // POST /test-evaluation — set eval metadata [dev]
  if (req.method === "POST" && path === "/test-evaluation") {
    const authErr = requireAuth(req, "dev");
    if (authErr) return authErr;
    let body: {
      test?: string;
      target?: string;
      expected_outcome?: string;
      commentary?: string;
    };
    try {
      body = await req.json();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }
    if (!body.test || !body.target || !body.expected_outcome) {
      return new Response("Missing test, target, or expected_outcome", {
        status: 400,
      });
    }
    if (
      !["pass", "violates_intent", "falls_short"].includes(
        body.expected_outcome,
      )
    ) {
      return new Response(
        "expected_outcome must be pass, violates_intent, or falls_short",
        { status: 400 },
      );
    }
    const testHash = resolveHash(body.test);
    if (testHash instanceof Response) return testHash;
    const targetHash = resolveHash(body.target);
    if (targetHash instanceof Response) return targetHash;

    // For violates_intent: verify test passes against at least one other atom
    if (body.expected_outcome === "violates_intent") {
      const passEvals = db.queryRelationships({ from: testHash, kind: "tests" })
        .filter((r) => r.to !== targetHash)
        .filter((r) => {
          const ev = db.getTestEvaluation(testHash, r.to);
          return !ev || ev.expectedOutcome === "pass";
        });
      if (passEvals.length === 0) {
        return new Response(
          "Cannot mark violates_intent: test must pass against at least one other atom first",
          { status: 422 },
        );
      }

      // Verify the test actually fails against the target
      const fail = await runTests([testHash], targetHash);
      if (!fail) {
        return new Response(
          "Cannot mark violates_intent: test passes against this atom (expected failure)",
          { status: 422 },
        );
      }
    }

    db.upsertTestEvaluation(
      testHash,
      targetHash,
      body.expected_outcome,
      body.commentary,
    );

    // Auto-register supersedes: if violates_intent, the atom(s) that pass
    // this test supersede the broken target
    if (body.expected_outcome === "violates_intent") {
      const passTargets = db.queryRelationships({
        from: testHash,
        kind: "tests",
      })
        .filter((r) => r.to !== targetHash)
        .filter((r) => {
          const ev = db.getTestEvaluation(testHash, r.to);
          return !ev || ev.expectedOutcome === "pass";
        });
      for (const r of passTargets) {
        if (db.insertRelationship(r.to, "supersedes", targetHash)) {
          db.insertLog({
            op: "rel.create",
            subject: `${r.to}:${targetHash}`,
            detail: JSON.stringify({ kind: "supersedes", auto: true }),
          });
        }
      }
    }

    db.insertLog({
      op: "eval.set",
      subject: `${testHash}:${targetHash}`,
      detail: JSON.stringify({
        expected_outcome: body.expected_outcome,
      }),
    });
    return new Response("ok\n", {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  }

  // GET /test-evaluation?test=T&target=A — read eval metadata
  if (req.method === "GET" && path === "/test-evaluation") {
    const testParam = url.searchParams.get("test");
    const targetParam = url.searchParams.get("target");
    if (!testParam || !targetParam) {
      return new Response("Missing ?test= and ?target=", { status: 400 });
    }
    const testHash = resolveHash(testParam);
    if (testHash instanceof Response) return testHash;
    const targetHash = resolveHash(targetParam);
    if (targetHash instanceof Response) return targetHash;
    const ev = db.getTestEvaluation(testHash, targetHash);
    if (!ev) return new Response("Not found", { status: 404 });
    return new Response(JSON.stringify(ev), {
      headers: { "content-type": "application/json" },
    });
  }

  // PATCH /test-evaluation — update commentary
  if (req.method === "PATCH" && path === "/test-evaluation") {
    const authErr = requireAuth(req, "dev");
    if (authErr) return authErr;
    let body: { test?: string; target?: string; commentary?: string };
    try {
      body = await req.json();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }
    if (!body.test || !body.target) {
      return new Response("Missing test or target", { status: 400 });
    }
    const testHash = resolveHash(body.test);
    if (testHash instanceof Response) return testHash;
    const targetHash = resolveHash(body.target);
    if (targetHash instanceof Response) return targetHash;
    const ev = db.getTestEvaluation(testHash, targetHash);
    if (!ev) return new Response("Not found", { status: 404 });
    db.upsertTestEvaluation(
      testHash,
      targetHash,
      ev.expectedOutcome,
      body.commentary,
    );
    return new Response("ok\n", { headers: { "content-type": "text/plain" } });
  }

  // GET /test-runs?target=H&test=H&recent=N — query test run history
  if (req.method === "GET" && path === "/test-runs") {
    const targetParam = url.searchParams.get("target");
    const testParam = url.searchParams.get("test");
    const recentParam = url.searchParams.get("recent");
    const target = targetParam
      ? (() => {
        const r = resolveHash(targetParam);
        return r instanceof Response ? null : r;
      })()
      : undefined;
    if (targetParam && !target) {
      return new Response("Target not found", { status: 404 });
    }
    const test = testParam
      ? (() => {
        const r = resolveHash(testParam);
        return r instanceof Response ? null : r;
      })()
      : undefined;
    if (testParam && !test) {
      return new Response("Test not found", { status: 404 });
    }
    const runs = db.queryTestRuns({
      target: target ?? undefined,
      test: test ?? undefined,
      recent: recentParam ? parseInt(recentParam, 10) : undefined,
    });
    return new Response(JSON.stringify(runs), {
      headers: { "content-type": "application/json" },
    });
  }

  // GET /log?recent=N&op=X&subject=X — query audit log
  if (req.method === "GET" && path === "/log") {
    const recentParam = url.searchParams.get("recent");
    const op = url.searchParams.get("op") ?? undefined;
    const subject = url.searchParams.get("subject") ?? undefined;
    const entries = db.queryLog({
      recent: recentParam ? parseInt(recentParam, 10) : undefined,
      op,
      subject,
    });
    return new Response(JSON.stringify(entries), {
      headers: { "content-type": "application/json" },
    });
  }

  // POST /relationships — add a relationship [dev]
  if (req.method === "POST" && path === "/relationships") {
    const authErr = requireAuth(req, "dev");
    if (authErr) return authErr;
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
    if (!db.atomExists(from)) {
      return new Response(`Atom not found: ${from}`, { status: 404 });
    }
    if (!db.atomExists(to)) {
      return new Response(`Atom not found: ${to}`, { status: 404 });
    }

    if (kind === "tests") {
      const fail = await runTests([from], to);
      if (fail) return fail;
    }

    const isNew = db.insertRelationship(from, kind, to);

    // Record evaluation metadata for test relationships
    if (kind === "tests" && isNew) {
      db.upsertTestEvaluation(from, to, "pass");
    }

    db.insertLog({
      op: "rel.create",
      subject: `${from}:${to}`,
      detail: JSON.stringify({ kind }),
    });

    return new Response("ok\n", {
      status: isNew ? 201 : 200,
      headers: { "content-type": "text/plain" },
    });
  }

  // DELETE /relationships — remove a relationship [dev]
  if (req.method === "DELETE" && path === "/relationships") {
    const authErr = requireAuth(req, "dev");
    if (authErr) return authErr;
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
    const deleted = db.deleteRelationship(from, kind, to);
    if (!deleted) return new Response("Not found", { status: 404 });

    db.insertLog({
      op: "rel.delete",
      subject: `${from}:${to}`,
      detail: JSON.stringify({ kind }),
    });

    return new Response("ok\n", { headers: { "content-type": "text/plain" } });
  }

  // DELETE /a/<hash> — delete an orphan atom [dev]
  if (req.method === "DELETE") {
    const delMatch = path.match(/^\/a\/([a-z0-9]+)$/);
    if (delMatch) {
      const authErr = requireAuth(req, "dev");
      if (authErr) return authErr;
      const resolved = resolveHash(delMatch[1]);
      if (resolved instanceof Response) return resolved;
      const hash = resolved;
      const outgoing = db.queryRelationships({ from: hash });
      if (outgoing.length > 0) {
        return new Response(
          `Has ${outgoing.length} outgoing relationship(s)`,
          { status: 409 },
        );
      }
      const incoming = db.queryRelationships({ to: hash });
      if (incoming.length > 0) {
        return new Response(
          `Has ${incoming.length} incoming relationship(s)`,
          { status: 409 },
        );
      }
      db.deleteEmbedding(hash);
      db.deleteAtom(hash);

      db.insertLog({ op: "atom.delete", subject: hash });

      return new Response(null, { status: 204 });
    }
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
    const rows: Relationship[] = db.queryRelationships({ from, to, kind });
    return new Response(JSON.stringify(rows), {
      headers: { "content-type": "application/json" },
    });
  }

  // GET /status?since=<date> — corpus health summary
  if (req.method === "GET" && path === "/status") {
    const sinceParam = url.searchParams.get("since");
    const since = sinceParam ??
      new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(
        0,
        19,
      ).replace("T", " ");
    const status = db.getStatus(since);
    return new Response(JSON.stringify({ ...status, since }), {
      headers: { "content-type": "application/json" },
    });
  }

  // GET /prompts/<name> — get active prompt (override or default)
  // GET /prompts/<name>?default=1 — get compiled default
  if (req.method === "GET") {
    const promptMatch = path.match(
      /^\/prompts\/(context|iteration|retrospective)$/,
    );
    if (promptMatch) {
      const name = promptMatch[1] as PromptName;
      const wantDefault = url.searchParams.get("default") === "1";
      if (wantDefault) {
        return new Response(getDefaultPrompt(name), {
          headers: { "content-type": "text/plain" },
        });
      }
      const override = db.getPromptOverride(name);
      const body = override ?? getDefaultPrompt(name);
      return new Response(body, {
        headers: {
          "content-type": "text/plain",
          "x-prompt-source": override ? "override" : "default",
        },
      });
    }
  }

  // PUT /prompts/<name> — set prompt override [admin]
  if (req.method === "PUT") {
    const promptMatch = path.match(
      /^\/prompts\/(context|iteration|retrospective)$/,
    );
    if (promptMatch) {
      const authErr = requireAuth(req, "admin");
      if (authErr) return authErr;
      const name = promptMatch[1] as PromptName;
      const body = await req.text();
      if (!body.trim()) {
        return new Response("Empty prompt body", { status: 400 });
      }
      db.setPromptOverride(name, body);
      db.insertLog({ op: "prompt.set", subject: name });
      return new Response("ok\n", {
        headers: { "content-type": "text/plain" },
      });
    }
  }

  // DELETE /prompts/<name> — reset prompt to default [admin]
  if (req.method === "DELETE") {
    const promptMatch = path.match(
      /^\/prompts\/(context|iteration|retrospective)$/,
    );
    if (promptMatch) {
      const authErr = requireAuth(req, "admin");
      if (authErr) return authErr;
      const name = promptMatch[1] as PromptName;
      db.deletePromptOverride(name);
      db.insertLog({ op: "prompt.delete", subject: name });
      return new Response(null, { status: 204 });
    }
  }

  // --- Goals ---

  // GET /goals — list non-done goals
  if (req.method === "GET" && path === "/goals") {
    const done = url.searchParams.get("done") === "1";
    const all = url.searchParams.get("all") === "1";
    const goals = db.listGoals({ done, all });
    return new Response(JSON.stringify(goals), {
      headers: { "content-type": "application/json" },
    });
  }

  // GET /goals/<name> — goal body + comments
  if (req.method === "GET") {
    const goalMatch = path.match(/^\/goals\/([a-zA-Z0-9_-]+)$/);
    if (goalMatch) {
      const goal = db.getGoal(goalMatch[1]);
      if (!goal) return new Response("Goal not found", { status: 404 });
      const comments = db.getGoalComments(goal.name);
      return new Response(JSON.stringify({ ...goal, comments }), {
        headers: { "content-type": "application/json" },
      });
    }
  }

  // GET /goals/<name>/comments?recent=N — read comments
  if (req.method === "GET") {
    const commentMatch = path.match(/^\/goals\/([a-zA-Z0-9_-]+)\/comments$/);
    if (commentMatch) {
      const recentParam = url.searchParams.get("recent");
      const comments = db.getGoalComments(
        commentMatch[1],
        recentParam ? parseInt(recentParam, 10) : undefined,
      );
      return new Response(JSON.stringify(comments), {
        headers: { "content-type": "application/json" },
      });
    }
  }

  // POST /goals — create goal [admin]
  if (req.method === "POST" && path === "/goals") {
    const authErr = requireAuth(req, "admin");
    if (authErr) return authErr;
    let body: { name?: string; weight?: number; body?: string };
    try {
      body = await req.json();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }
    if (!body.name) {
      return new Response("Missing name", { status: 400 });
    }
    if (db.goalExists(body.name)) {
      return new Response("Goal already exists", { status: 409 });
    }
    const goal = db.createGoal(body.name, body.weight, body.body);
    db.insertLog({
      op: "goal.create",
      subject: goal.name,
      detail: JSON.stringify({ weight: goal.weight }),
    });
    return new Response(JSON.stringify(goal), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  }

  // PATCH /goals/<name> — update goal [admin]
  if (req.method === "PATCH") {
    const goalMatch = path.match(/^\/goals\/([a-zA-Z0-9_-]+)$/);
    if (goalMatch) {
      const authErr = requireAuth(req, "admin");
      if (authErr) return authErr;
      let body: { weight?: number; body?: string };
      try {
        body = await req.json();
      } catch {
        return new Response("Invalid JSON", { status: 400 });
      }
      if (!db.updateGoal(goalMatch[1], body)) {
        return new Response("Goal not found", { status: 404 });
      }
      db.insertLog({ op: "goal.update", subject: goalMatch[1] });
      return new Response("ok\n", {
        headers: { "content-type": "text/plain" },
      });
    }
  }

  // DELETE /goals/<name> — delete goal + comments [admin]
  if (req.method === "DELETE") {
    const goalMatch = path.match(/^\/goals\/([a-zA-Z0-9_-]+)$/);
    if (goalMatch) {
      const authErr = requireAuth(req, "admin");
      if (authErr) return authErr;
      if (!db.deleteGoal(goalMatch[1])) {
        return new Response("Goal not found", { status: 404 });
      }
      db.insertLog({ op: "goal.delete", subject: goalMatch[1] });
      return new Response(null, { status: 204 });
    }
  }

  // POST /goals/<name>/done — mark done [dev]
  if (req.method === "POST") {
    const doneMatch = path.match(/^\/goals\/([a-zA-Z0-9_-]+)\/done$/);
    if (doneMatch) {
      const authErr = requireAuth(req, "dev");
      if (authErr) return authErr;
      const goalName = doneMatch[1];
      if (!db.goalExists(goalName)) {
        return new Response("Goal not found", { status: 404 });
      }
      const comments = db.getGoalComments(goalName);
      const last = comments[comments.length - 1];
      if (!last || !last.body.startsWith("DONE: ")) {
        return new Response(
          'Cannot mark done: the last comment must start with "DONE: " summarising how it was ' +
            "done and what exists that satisfies the goal. " +
            "Include concrete `zts exec <hash>` commands to demonstrate the result, if appropriate.",
          { status: 422 },
        );
      }
      if (!db.markGoalDone(goalName)) {
        return new Response("Goal not found", { status: 404 });
      }
      db.insertLog({ op: "goal.done", subject: goalName });
      return new Response("ok\n", {
        headers: { "content-type": "text/plain" },
      });
    }
  }

  // POST /goals/<name>/undone — mark undone [dev]
  if (req.method === "POST") {
    const undoneMatch = path.match(/^\/goals\/([a-zA-Z0-9_-]+)\/undone$/);
    if (undoneMatch) {
      const authErr = requireAuth(req, "dev");
      if (authErr) return authErr;
      if (!db.markGoalUndone(undoneMatch[1])) {
        return new Response("Goal not found", { status: 404 });
      }
      db.insertLog({ op: "goal.undone", subject: undoneMatch[1] });
      return new Response("ok\n", {
        headers: { "content-type": "text/plain" },
      });
    }
  }

  // POST /goals/<name>/comments — append comment [dev]
  if (req.method === "POST") {
    const commentMatch = path.match(
      /^\/goals\/([a-zA-Z0-9_-]+)\/comments$/,
    );
    if (commentMatch) {
      const authErr = requireAuth(req, "dev");
      if (authErr) return authErr;
      const body = (await req.text()).trim();
      if (!body) return new Response("Empty comment", { status: 400 });
      if (!db.addGoalComment(commentMatch[1], body)) {
        return new Response("Goal not found", { status: 404 });
      }
      db.insertLog({ op: "goal.comment", subject: commentMatch[1] });
      return new Response("ok\n", {
        status: 201,
        headers: { "content-type": "text/plain" },
      });
    }
  }

  // DELETE /goals/<name>/comments/<id> — delete comment [dev]
  if (req.method === "DELETE") {
    const delComment = path.match(
      /^\/goals\/([a-zA-Z0-9_-]+)\/comments\/(\d+)$/,
    );
    if (delComment) {
      const authErr = requireAuth(req, "admin");
      if (authErr) return authErr;
      if (!db.deleteGoalComment(parseInt(delComment[2], 10))) {
        return new Response("Comment not found", { status: 404 });
      }
      db.insertLog({
        op: "goal.comment.delete",
        subject: delComment[1],
      });
      return new Response(null, { status: 204 });
    }
  }

  return new Response("Not found", { status: 404 });
}

export interface ServerConfig {
  port: number;
  hostname?: string;
  dbPath: string;
  devToken?: string;
  adminToken?: string;
  skipEmbedCheck?: boolean;
  embedUrl?: string;
  embedModel?: string;
  embedDim?: number;
}

export interface ServerHandle {
  port: number;
  shutdown(): Promise<void>;
}

export function startServer(config: ServerConfig): ServerHandle {
  authConfig = {
    devToken: config.devToken,
    adminToken: config.adminToken,
  };

  if (config.embedUrl || config.embedModel) {
    embedConfig = {
      url: config.embedUrl ?? embedConfig.url,
      model: config.embedModel ?? embedConfig.model,
    };
  }
  if (config.embedDim) embedDim = config.embedDim;

  db = new Db(config.dbPath);
  const allVecs = db.getAllEmbeddings();
  hnswIndex = HnswIndex.create(
    embedDim,
    Math.max(allVecs.size * 2, 1024),
  );
  for (const [hash, vec] of allVecs) hnswIndex.add(hash, vec);
  if (allVecs.size > 0) {
    console.log(`Loaded ${hnswIndex.size} embeddings into HNSW index`);
  }

  if (!config.skipEmbedCheck) {
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
  }

  const server = Deno.serve({
    port: config.port,
    hostname: config.hostname ?? "0.0.0.0",
  }, handler);
  const actualPort = (server.addr as Deno.NetAddr).port;
  serverPort = actualPort;

  return {
    port: actualPort,
    async shutdown() {
      await server.shutdown();
      db.close();
    },
  };
}

export async function serve(): Promise<void> {
  try {
    await Deno.stat(`${UI_DIR}/app.html`);
  } catch {
    console.error("error: UI has not been built.");
    console.error("  Run:  cd ui && npm install && npm run build");
    Deno.exit(1);
  }

  await Deno.mkdir(DATA_DIR, { recursive: true });

  const handle = startServer({
    port: PORT,
    dbPath: `${DATA_DIR}/zts.db`,
    devToken: Deno.env.get("ZTS_DEV_TOKEN") || undefined,
    adminToken: Deno.env.get("ZTS_ADMIN_TOKEN") || undefined,
  });

  console.log(`Listening on http://localhost:${handle.port}`);
  console.log(
    "  POST /a                          — store atom (requires X-Description header)",
  );
  console.log(
    "  GET  /a/<aa>/<bb>/<rest>.ts      — retrieve code by content address",
  );
  console.log(
    "  GET  /bundle/<hash>              — download zip bundle of atom + dependencies",
  );
  console.log(
    "  GET  /recent?n=N&goal=G&all=1    — recent atoms (default 20)",
  );
  console.log(
    "  GET  /info/<hash>                — full atom info (source, rels, tests)",
  );
  console.log(
    "  POST /a/<hash>/description       — update description for an atom",
  );
  console.log(
    "  GET  /a/<hash>/description       — retrieve description",
  );
  console.log(
    "  GET  /search?q=<text>[&k=10]     — semantic nearest-neighbor search",
  );
  console.log(
    "  GET  /similar/<hash>[?k=10]      — find similar atoms by embedding",
  );
  console.log(
    "  Hash prefixes accepted everywhere (e.g. /info/3ax9 instead of full 25-char hash)",
  );
}
