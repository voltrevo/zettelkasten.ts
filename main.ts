import { parseArgs } from "@std/cli/parse-args";
import { PORT, serve } from "./src/server.ts";

const BASE_URL = Deno.env.get("ZTS_URL") ?? `http://localhost:${PORT}`;

const UNIT_NAME = "zettelkasten";
const UNIT_DIR = `${Deno.env.get("HOME")}/.config/systemd/user`;
const UNIT_FILE = `${UNIT_DIR}/${UNIT_NAME}.service`;

const args = parseArgs(Deno.args, {
  string: ["m"],
  alias: { m: "message" },
});

const [command, ...rest] = args._ as string[];

switch (command) {
  case "run":
    await serve();
    break;

  case "start":
    await daemonStart();
    break;

  case "stop":
    await daemonStop();
    break;

  case "restart":
    await systemctl("restart", UNIT_NAME);
    break;

  case "get":
    await cmdGet(rest);
    break;

  case "post":
    await cmdPost(rest);
    break;

  default:
    console.error("usage: zts <command> [options]");
    console.error("  run                          run server in foreground");
    console.error(
      "  start                        install and start daemon (enable on boot)",
    );
    console.error(
      "  stop                         stop daemon and disable on boot",
    );
    console.error("  restart                      restart the daemon");
    console.error(
      "  get <path|hash>              retrieve code by content address",
    );
    console.error(
      "  post -m <message> [file]     store code (stdin if no file)",
    );
    Deno.exit(command ? 1 : 0);
}

async function systemctl(...cmd: string[]): Promise<void> {
  const proc = new Deno.Command("systemctl", {
    args: ["--user", ...cmd],
    stdout: "inherit",
    stderr: "inherit",
  });
  const { code } = await proc.output();
  if (code !== 0) throw new Error(`systemctl exited with code ${code}`);
}

async function daemonStart(): Promise<void> {
  const denoExec = Deno.execPath();
  const scriptPath = new URL(import.meta.url).pathname;
  const unit = [
    "[Unit]",
    "Description=Zettelkasten atom server",
    "",
    "[Service]",
    `ExecStart=${denoExec} run --allow-net --allow-read --allow-write --allow-env --allow-run=git ${scriptPath} run`,
    "Restart=on-failure",
    "",
    "[Install]",
    "WantedBy=default.target",
  ].join("\n") + "\n";

  await Deno.mkdir(UNIT_DIR, { recursive: true });
  await Deno.writeTextFile(UNIT_FILE, unit);
  await systemctl("daemon-reload");
  await systemctl("enable", "--now", UNIT_NAME);
  console.log("Service enabled and started.");
}

async function daemonStop(): Promise<void> {
  await systemctl("disable", "--now", UNIT_NAME);
  console.log("Service stopped and disabled.");
}

async function cmdGet(rest: string[]): Promise<void> {
  const ref = rest[0];
  if (!ref) {
    console.error("usage: zts get <path|hash>");
    Deno.exit(1);
  }
  const url = ref.startsWith("/")
    ? `${BASE_URL}${ref}`
    : `${BASE_URL}/a/${ref.slice(0, 2)}/${ref.slice(2, 4)}/${ref.slice(4)}.ts`;

  const res = await fetch(url);
  if (!res.ok) {
    console.error(`error: ${res.status} ${res.statusText}`);
    Deno.exit(1);
  }
  await res.body!.pipeTo(Deno.stdout.writable);
}

async function cmdPost(rest: string[]): Promise<void> {
  const message = args.m;
  if (!message) {
    console.error("usage: zts post -m <message> [file]");
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
