/**
 * Checker service — runs test atoms against targets in a sandboxed subprocess.
 * Stateless: no SQLite, no auth, no corpus data.
 *
 * POST /check { serverUrl, targetHash, testHashes }
 *   → 200 { passed, results, durationMs, stderr? }
 *
 * GET /health → 200 "ok"
 */

const TEST_RUNNER = new URL("./test-runner.ts", import.meta.url).pathname;
const PROCESS_TIMEOUT_MS = 10_000;

export { DEFAULT_CHECKER_PORT } from "./config.ts";
import { DEFAULT_CHECKER_PORT } from "./config.ts";

export interface CheckRequest {
  serverUrl: string;
  targetHash: string;
  testHashes: string[];
}

export interface CheckResult {
  passed: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
}

async function handleCheck(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body: CheckRequest;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (!body.serverUrl || !body.targetHash || !body.testHashes?.length) {
    return new Response(
      "Missing required fields: serverUrl, targetHash, testHashes",
      { status: 400 },
    );
  }

  for (const th of body.testHashes) {
    if (!/^[a-z0-9]{25}$/.test(th)) {
      return new Response(`Invalid test hash: ${th}`, { status: 400 });
    }
  }
  if (!/^[a-z0-9]{25}$/.test(body.targetHash)) {
    return new Response("Invalid target hash", { status: 400 });
  }

  const serverHost = new URL(body.serverUrl).host;
  const start = performance.now();

  const child = new Deno.Command(Deno.execPath(), {
    args: [
      "test",
      `--allow-import=${serverHost}`,
      `--allow-net=${serverHost}`,
      "--no-lock",
      TEST_RUNNER,
      "--",
      body.serverUrl,
      body.targetHash,
      body.testHashes.join(","),
    ],
    stdout: "piped",
    stderr: "piped",
  }).spawn();

  let output: { code: number; stdout: Uint8Array; stderr: Uint8Array };
  try {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Test timed out after ${PROCESS_TIMEOUT_MS}ms`)),
        PROCESS_TIMEOUT_MS,
      );
    });
    try {
      const status = await Promise.race([child.status, timeout]);
      clearTimeout(timer!);
      const [stdout, stderr] = await Promise.all([
        new Response(child.stdout).arrayBuffer().then((b) => new Uint8Array(b)),
        new Response(child.stderr).arrayBuffer().then((b) => new Uint8Array(b)),
      ]);
      output = { code: status.code, stdout, stderr };
    } catch (e) {
      clearTimeout(timer!);
      try {
        child.kill();
      } catch { /* already dead */ }
      throw e;
    }
  } catch (e) {
    const durationMs = Math.round(performance.now() - start);
    const result: CheckResult = {
      passed: false,
      durationMs,
      stdout: "",
      stderr: (e as Error).message,
    };
    return new Response(JSON.stringify(result), {
      headers: { "content-type": "application/json" },
    });
  }

  const durationMs = Math.round(performance.now() - start);
  const result: CheckResult = {
    passed: output.code === 0,
    durationMs,
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
  };

  return new Response(JSON.stringify(result), {
    headers: { "content-type": "application/json" },
  });
}

async function handleLint(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  const source = await req.text();
  if (!source) {
    return new Response("Empty source", { status: 400 });
  }

  const lintDir = "/tmp/zts-lint";
  await Deno.mkdir(lintDir, { recursive: true });
  const tmpFile = await Deno.makeTempFile({ suffix: ".ts", dir: lintDir });
  try {
    await Deno.writeTextFile(tmpFile, source);
    const proc = new Deno.Command(Deno.execPath(), {
      args: ["lint", "--compact", tmpFile],
      stdout: "piped",
      stderr: "piped",
    });
    const output = await proc.output();
    const passed = output.code === 0;
    const text = new TextDecoder().decode(output.stdout) +
      new TextDecoder().decode(output.stderr);

    return new Response(JSON.stringify({ passed, diagnostics: text.trim() }), {
      headers: { "content-type": "application/json" },
    });
  } finally {
    await Deno.remove(tmpFile).catch((e) =>
      console.error(`warning: failed to clean up ${tmpFile}: ${e.message}`)
    );
  }
}

async function handleFmt(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  const source = await req.text();
  if (!source) {
    return new Response("Empty source", { status: 400 });
  }

  const tmpFile = await Deno.makeTempFile({ suffix: ".ts" });
  try {
    await Deno.writeTextFile(tmpFile, source);
    const proc = new Deno.Command(Deno.execPath(), {
      args: ["fmt", tmpFile],
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    });
    const output = await proc.output();
    if (!output.success) {
      return new Response(
        JSON.stringify({ formatted: source, changed: false }),
        { headers: { "content-type": "application/json" } },
      );
    }
    const formatted = await Deno.readTextFile(tmpFile);
    return new Response(
      JSON.stringify({ formatted, changed: formatted !== source }),
      { headers: { "content-type": "application/json" } },
    );
  } finally {
    await Deno.remove(tmpFile).catch(() => {});
  }
}

async function handleCheckCoverage(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  let body: CheckRequest;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  if (!body.serverUrl || !body.targetHash || !body.testHashes?.length) {
    return new Response(
      "Missing required fields: serverUrl, targetHash, testHashes",
      { status: 400 },
    );
  }

  const serverHost = new URL(body.serverUrl).host;
  function hashToUrl(hash: string): string {
    return `${body.serverUrl}/a/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${
      hash.slice(4)
    }.ts`;
  }

  // Fetch target source and write locally (coverage only instruments local files)
  const targetUrl = hashToUrl(body.targetHash);
  const targetRes = await fetch(targetUrl);
  if (!targetRes.ok) {
    return new Response(`Failed to fetch target: ${targetRes.status}`, {
      status: 502,
    });
  }
  let targetSource = await targetRes.text();

  // Rewrite relative atom imports to HTTP URLs
  targetSource = targetSource.replace(
    /from\s+"\.\.\/\.\.\/([a-z0-9]{2})\/([a-z0-9]{2})\/([a-z0-9]+\.ts)"/g,
    `from "${body.serverUrl}/a/$1/$2/$3"`,
  );

  const tmpDir = await Deno.makeTempDir({ prefix: "zts-cov-" });
  try {
    const targetFile = `${tmpDir}/target.ts`;
    await Deno.writeTextFile(targetFile, targetSource);

    // Generate a test runner that imports target locally
    const testImports = body.testHashes.map((h, i) =>
      `import { Test as Test${i} } from "${hashToUrl(h)}";`
    ).join("\n");
    const testCalls = body.testHashes.map((_, i) =>
      `Deno.test(Test${i}.name, () => new Test${i}().run(target));`
    ).join("\n");
    const runner = `
import * as mod from "./target.ts";
const target = Object.values(mod).find((v) => v !== undefined)!;
${testImports}
${testCalls}
`;
    const runnerFile = `${tmpDir}/runner_test.ts`;
    await Deno.writeTextFile(runnerFile, runner);

    const covDir = `${tmpDir}/cov`;

    // Run tests with coverage
    const child = new Deno.Command(Deno.execPath(), {
      args: [
        "test",
        `--allow-import=${serverHost}`,
        `--allow-net=${serverHost}`,
        "--no-lock",
        `--coverage=${covDir}`,
        runnerFile,
      ],
      stdout: "piped",
      stderr: "piped",
    });
    const testOutput = await child.output();
    if (!testOutput.success) {
      return new Response(
        JSON.stringify({
          lineCoverage: 0,
          uncoveredLines: "Tests failed:\n" +
            new TextDecoder().decode(testOutput.stderr),
        }),
        { headers: { "content-type": "application/json" } },
      );
    }

    const covEnv = { ...Deno.env.toObject(), NO_COLOR: "1" };

    // Summary report (branch + line percentages)
    const summaryCmd = new Deno.Command(Deno.execPath(), {
      args: ["coverage", covDir],
      stdout: "piped",
      stderr: "piped",
      env: covEnv,
    });
    const summaryOutput = await summaryCmd.output();
    const summaryText = new TextDecoder().decode(summaryOutput.stdout);

    // Detailed report (uncovered lines)
    const detailCmd = new Deno.Command(Deno.execPath(), {
      args: ["coverage", covDir, "--detailed"],
      stdout: "piped",
      stderr: "piped",
      env: covEnv,
    });
    const detailOutput = await detailCmd.output();
    const detailText = new TextDecoder().decode(detailOutput.stdout);

    // Parse summary: find target.ts row in table
    // Format: | target.ts |   50.0 |  60.0 |
    let branchCoverage = 100;
    let lineCoverage = 100;
    for (const line of summaryText.split("\n")) {
      if (line.includes("target.ts")) {
        // Split by | and parse the numeric columns
        const cols = line.split("|").map((c) => c.trim()).filter(Boolean);
        // cols: ["target.ts", "50.0", "60.0"]
        if (cols.length >= 3) {
          const b = parseFloat(cols[1]);
          const l = parseFloat(cols[2]);
          if (!isNaN(b)) branchCoverage = b;
          if (!isNaN(l)) lineCoverage = l;
        }
        break;
      }
    }

    // Parse detailed: uncovered lines after target.ts heading
    const uncoveredLines: string[] = [];
    let inTarget = false;
    for (const line of detailText.split("\n")) {
      if (line.includes("target.ts")) {
        inTarget = true;
        continue;
      }
      if (inTarget) {
        if (line.match(/^\s+\d+\s*\|/)) {
          uncoveredLines.push(line);
        } else if (line.startsWith("cover ") || line.trim() === "") {
          inTarget = false;
        }
      }
    }

    return new Response(
      JSON.stringify({
        lineCoverage: Math.round(lineCoverage * 10) / 10,
        branchCoverage: Math.round(branchCoverage * 10) / 10,
        uncoveredLines: uncoveredLines.join("\n"),
      }),
      { headers: { "content-type": "application/json" } },
    );
  } finally {
    await Deno.remove(tmpDir, { recursive: true }).catch(() => {});
  }
}

async function handleValidateTest(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  const source = await req.text();
  if (!source) {
    return new Response("Empty source", { status: 400 });
  }
  const { isTestAtom, extractTestName } = await import("./validate.ts");
  const valid = isTestAtom(source);
  const testName = valid ? extractTestName(source) : null;
  return new Response(
    JSON.stringify({
      valid,
      testName,
      diagnostics: valid
        ? ""
        : "Not a valid test atom: must export a class named Test",
    }),
    { headers: { "content-type": "application/json" } },
  );
}

function handler(req: Request): Promise<Response> | Response {
  const url = new URL(req.url);
  if (url.pathname === "/health") {
    return new Response("ok\n", {
      headers: { "content-type": "text/plain" },
    });
  }
  if (url.pathname === "/check") {
    return handleCheck(req);
  }
  if (url.pathname === "/lint") {
    return handleLint(req);
  }
  if (url.pathname === "/validate-test") {
    return handleValidateTest(req);
  }
  if (url.pathname === "/fmt") {
    return handleFmt(req);
  }
  if (url.pathname === "/check-coverage") {
    return handleCheckCoverage(req);
  }
  return new Response("Not found", { status: 404 });
}

export interface CheckerConfig {
  port: number;
  hostname?: string;
}

export interface CheckerHandle {
  port: number;
  shutdown(): Promise<void>;
}

export function startChecker(config: CheckerConfig): CheckerHandle {
  const server = Deno.serve({
    port: config.port,
    hostname: config.hostname ?? "0.0.0.0",
  }, handler);
  const actualPort = (server.addr as Deno.NetAddr).port;
  return {
    port: actualPort,
    async shutdown() {
      await server.shutdown();
    },
  };
}

export function serveChecker(port = DEFAULT_CHECKER_PORT): void {
  const handle = startChecker({ port });
  console.log(`Checker listening on http://localhost:${handle.port}`);
  console.log("  POST /check — run tests");
  console.log("  GET  /health — health check");
}
