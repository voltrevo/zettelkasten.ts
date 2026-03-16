import { parseArgs } from "@std/cli/parse-args";

const BASE_URL = Deno.env.get("ZK_URL") ?? "http://localhost:8000";

const args = parseArgs(Deno.args, {
  string: ["m"],
  alias: { m: "message" },
});

const [command, ...rest] = args._ as string[];

switch (command) {
  case "get": {
    const ref = rest[0];
    if (!ref) {
      console.error("usage: zk get <path|hash>");
      Deno.exit(1);
    }
    // accept full path (/a/1l/15/xxx.ts) or bare 25-char hash
    const url = ref.startsWith("/")
      ? `${BASE_URL}${ref}`
      : `${BASE_URL}/a/${ref.slice(0, 2)}/${ref.slice(2, 4)}/${
        ref.slice(4)
      }.ts`;

    const res = await fetch(url);
    if (!res.ok) {
      console.error(`error: ${res.status} ${res.statusText}`);
      Deno.exit(1);
    }
    await res.body!.pipeTo(Deno.stdout.writable);
    break;
  }

  case "post": {
    const message = args.m;
    if (!message) {
      console.error("usage: zk post -m <message> [file]");
      Deno.exit(1);
    }
    const file = rest[0];
    const content = file
      ? await Deno.readTextFile(file)
      : new TextDecoder().decode(await readAll(Deno.stdin.readable));

    if (!content) {
      console.error("error: empty content");
      Deno.exit(1);
    }

    const res = await fetch(`${BASE_URL}/a`, {
      method: "POST",
      headers: { "x-commit-message": message },
      body: content,
    });
    if (!res.ok) {
      console.error(`error: ${res.status} ${await res.text()}`);
      Deno.exit(1);
    }
    console.log((await res.text()).trim());
    break;
  }

  default:
    console.error("usage: zk <get|post> [options]");
    console.error("  get <path|hash>         retrieve code by content address");
    console.error("  post -m <message> [file] store code (stdin if no file)");
    Deno.exit(1);
}

async function readAll(
  readable: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of readable) chunks.push(chunk);
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
