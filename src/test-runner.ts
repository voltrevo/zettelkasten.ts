// Invoked as a test file:
//   deno test --allow-import=<host> src/test-runner.ts -- <server-url> <target-hash> <test1,test2,...>
//
// All config passed via CLI args (no env vars needed).

const args = Deno.args;
const dashdash = args.indexOf("--");
const positional = dashdash >= 0 ? args.slice(dashdash + 1) : args;

const [serverUrl, targetHash, testHashesRaw] = positional;

if (!serverUrl || !targetHash || !testHashesRaw) {
  throw new Error(
    "usage: deno test ... src/test-runner.ts -- <server-url> <target-hash> <test-hashes>",
  );
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
