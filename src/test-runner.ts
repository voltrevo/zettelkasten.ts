// Invoked as a test file:
//   deno test --allow-import=<host> --allow-env src/test-runner.ts
//
// Config passed via environment:
//   ZTS_SERVER_URL  — base URL of the atom server
//   ZTS_TARGET      — hash of the target atom
//   ZTS_TESTS       — comma-separated list of test atom hashes

const serverUrl = Deno.env.get("ZTS_SERVER_URL") ?? "http://localhost:8000";
const targetHash = Deno.env.get("ZTS_TARGET") ?? "";
const testHashesRaw = Deno.env.get("ZTS_TESTS") ?? "";

if (!targetHash || !testHashesRaw) {
  throw new Error("ZTS_TARGET and ZTS_TESTS env vars are required");
}

const testHashes = testHashesRaw.split(",").filter(Boolean);

function hashToUrl(base: string, hash: string): string {
  return `${base}/a/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${
    hash.slice(4)
  }.ts`;
}

const targetUrl = hashToUrl(serverUrl, targetHash);
const targetMod = await import(targetUrl);
// Atoms have exactly one value export; extract it.
const target = Object.values(targetMod).find((v) => v !== undefined);

for (const testHash of testHashes) {
  const testUrl = hashToUrl(serverUrl, testHash);
  const { Test } = await import(testUrl) as {
    Test: {
      name: string;
      new (): { run(target: unknown): void | Promise<void> };
    };
  };
  Deno.test(Test.name, () => new Test().run(target));
}
