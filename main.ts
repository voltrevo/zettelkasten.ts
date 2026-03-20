import { parseArgs } from "@std/cli/parse-args";
import { parseZip } from "./src/bundle.ts";
import { DATA_DIR, PORT, serve } from "./src/server.ts";

const BASE_URL = Deno.env.get("ZTS_URL") ?? `http://localhost:${PORT}`;

const UNIT_NAME = "zettelkasten";
const LOGROTATE_UNIT = "zts-logrotate";
const UNIT_DIR = `${Deno.env.get("HOME")}/.config/systemd/user`;
const UNIT_FILE = `${UNIT_DIR}/${UNIT_NAME}.service`;
const LOG_FILE = `${DATA_DIR}/server.log`;
const LOGROTATE_CONF = `${DATA_DIR}/logrotate.conf`;
const LOGROTATE_STATE = `${DATA_DIR}/logrotate.status`;

const args = parseArgs(Deno.args, {
  string: ["d", "m", "n", "o", "k", "t"],
  boolean: ["f", "no-description"],
  alias: {
    d: "description",
    f: "follow",
    n: "lines",
    o: "output",
    t: "tests",
  },
});

const RUN_TS = new URL("./run.ts", import.meta.url).pathname;
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
    await daemonInstall();
    await systemctl("restart", UNIT_NAME);
    break;

  case "log":
    await cmdLog();
    break;

  case "get":
    await cmdGet(rest);
    break;

  case "post":
    await cmdPost(rest);
    break;

  case "exec":
    await cmdExec(Deno.args.slice(1)); // use raw args to preserve numeric-looking strings
    break;

  case "bundle":
    await cmdBundle(rest);
    break;

  case "describe":
    await cmdDescribe(rest);
    break;

  case "search":
    await cmdSearch(rest);
    break;

  case "test":
    await cmdTest(rest);
    break;

  case "delete":
    await cmdDelete(rest);
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
    console.error("  log [-f] [-n <lines>]        show server log");
    console.error(
      "  get <path|hash>              retrieve code by content address",
    );
    console.error(
      "  post -d <desc> [-t <tests>] [file]  store code, optionally gated on tests",
    );
    console.error(
      "  exec <hash|file.zip>         execute root atom's main(globalThis)",
    );
    console.error(
      "  bundle <hash> [-o <dir>]     download zip bundle (or extract to dir)",
    );
    console.error(
      "  describe <hash> [-d <text>]  set or read description for an atom",
    );
    console.error(
      "  search <query> [-k <n>]      semantic search (default k=10)",
    );
    console.error(
      "  test <hash>                  run all registered tests for an atom",
    );
    console.error(
      "  delete <hash>                delete an orphan atom (no relationships)",
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

async function daemonInstall(): Promise<void> {
  const denoExec = Deno.execPath();
  const scriptPath = new URL(import.meta.url).pathname;
  const projectDir = new URL(".", import.meta.url).pathname;

  const unit = [
    "[Unit]",
    "Description=Zettelkasten atom server",
    "",
    "[Service]",
    `WorkingDirectory=${projectDir}`,
    `ExecStart=${denoExec} run --allow-net --allow-read --allow-write --allow-env --allow-run=${denoExec} --allow-ffi ${scriptPath} run`,
    `StandardOutput=append:${LOG_FILE}`,
    `StandardError=append:${LOG_FILE}`,
    "Restart=on-failure",
    "",
    "[Install]",
    "WantedBy=default.target",
  ].join("\n") + "\n";

  const logrotateConf = [
    `${LOG_FILE} {`,
    "    rotate 14",
    "    daily",
    "    compress",
    "    missingok",
    "    notifempty",
    "    copytruncate",
    "    maxsize 50M",
    "}",
  ].join("\n") + "\n";

  const logrotateService = [
    "[Unit]",
    "Description=Rotate zettelkasten server logs",
    "",
    "[Service]",
    "Type=oneshot",
    `ExecStart=logrotate --state ${LOGROTATE_STATE} ${LOGROTATE_CONF}`,
  ].join("\n") + "\n";

  const logrotateTimer = [
    "[Unit]",
    "Description=Daily zettelkasten log rotation",
    "",
    "[Timer]",
    "OnCalendar=daily",
    "Persistent=true",
    "",
    "[Install]",
    "WantedBy=timers.target",
  ].join("\n") + "\n";

  await Deno.mkdir(UNIT_DIR, { recursive: true });
  await Deno.mkdir(DATA_DIR, { recursive: true });
  await Deno.writeTextFile(UNIT_FILE, unit);
  await Deno.writeTextFile(LOGROTATE_CONF, logrotateConf);
  await Deno.writeTextFile(
    `${UNIT_DIR}/${LOGROTATE_UNIT}.service`,
    logrotateService,
  );
  await Deno.writeTextFile(
    `${UNIT_DIR}/${LOGROTATE_UNIT}.timer`,
    logrotateTimer,
  );
  await systemctl("daemon-reload");
}

async function daemonStart(): Promise<void> {
  const check = new Deno.Command("systemctl", {
    args: ["--user", "is-active", "--quiet", UNIT_NAME],
  });
  const { code } = await check.output();
  if (code === 0) {
    console.error("error: service is already running (use 'zts restart')");
    Deno.exit(1);
  }
  await daemonInstall();
  await systemctl("enable", "--now", UNIT_NAME);
  await systemctl("enable", "--now", `${LOGROTATE_UNIT}.timer`);
  console.log("Service enabled and started.");
  console.log(`Logs: ${LOG_FILE}`);
}

async function daemonStop(): Promise<void> {
  await systemctl("disable", "--now", UNIT_NAME);
  try {
    await systemctl("disable", "--now", `${LOGROTATE_UNIT}.timer`);
  } catch { /* timer may not exist */ }
  console.log("Service stopped and disabled.");
}

async function cmdLog(): Promise<void> {
  const lines = args.n ?? "50";
  const follow = args.f;
  const tailArgs = follow
    ? ["-f", "-n", lines, LOG_FILE]
    : ["-n", lines, LOG_FILE];
  const proc = new Deno.Command("tail", {
    args: tailArgs,
    stdout: "inherit",
    stderr: "inherit",
  });
  const { code } = await proc.output();
  if (code !== 0) Deno.exit(code);
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
  const description = args.d;
  const noDescription = args["no-description"];
  if (!description && !noDescription) {
    console.error(
      "usage: zts post -d <description> [-t <test1,test2,...>] [-g <goal>] [file]",
    );
    console.error("  use --no-description to opt out of required description");
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

  const headers: Record<string, string> = {};
  if (description) {
    headers["x-description"] = description;
  } else {
    headers["x-allow-no-description"] = "true";
  }
  if (args.t) {
    headers["x-require-tests"] = args.t;
  }

  const res = await fetch(`${BASE_URL}/a`, {
    method: "POST",
    headers,
    body: content,
  });
  if (!res.ok) {
    console.error(`error: ${res.status} ${await res.text()}`);
    Deno.exit(1);
  }
  console.log((await res.text()).trim());
}

async function cmdDelete(rest: string[]): Promise<void> {
  const hash = rest[0];
  if (!hash) {
    console.error("usage: zts delete <hash>");
    Deno.exit(1);
  }
  const res = await fetch(`${BASE_URL}/a/${hash}`, { method: "DELETE" });
  if (res.status === 204) {
    console.log("deleted");
  } else if (res.status === 409) {
    console.error(`error: ${await res.text()}`);
    Deno.exit(1);
  } else if (res.status === 404) {
    console.error("error: atom not found");
    Deno.exit(1);
  } else {
    console.error(`error: ${res.status} ${await res.text()}`);
    Deno.exit(1);
  }
}

async function spawnRun(
  scriptPath: string,
  atomUrl: string,
  ...scriptArgs: string[]
): Promise<void> {
  const proc = new Deno.Command(Deno.execPath(), {
    args: ["run", "--allow-all", "--no-lock", scriptPath, ...scriptArgs],
    env: { ...Deno.env.toObject(), ZTS_EXEC_URL: atomUrl },
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  const { code } = await proc.output();
  if (code !== 0) Deno.exit(code);
}

async function cmdExec(rest: string[]): Promise<void> {
  const ref = rest[0];
  if (!ref) {
    console.error("usage: zts exec <hash|file.zip>");
    Deno.exit(1);
  }

  if (ref.endsWith(".zip")) {
    await execBundle(ref);
  } else {
    const url = `${BASE_URL}/a/${ref.slice(0, 2)}/${ref.slice(2, 4)}/${
      ref.slice(4)
    }.ts`;
    await spawnRun(RUN_TS, url, ...rest.slice(1));
  }
}

async function execBundle(zipFile: string): Promise<void> {
  const zipData = await Deno.readFile(zipFile);
  const files = parseZip(zipData);

  const tmpDir = await Deno.makeTempDir({ prefix: "zts-" });
  try {
    for (const [path, data] of files) {
      const fullPath = `${tmpDir}/${path}`;
      await Deno.mkdir(fullPath.replace(/\/[^/]+$/, ""), { recursive: true });
      await Deno.writeFile(fullPath, data);
    }

    const runTsRel = [...files.keys()].find((p) => p.endsWith("/run.ts"));
    if (!runTsRel) {
      console.error("error: bundle has no run.ts entry point");
      Deno.exit(1);
    }

    await spawnRun(`${tmpDir}/${runTsRel}`, "");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
}

async function cmdBundle(rest: string[]): Promise<void> {
  const hash = rest[0];
  if (!hash) {
    console.error("usage: zts bundle <hash> [-o <dir>]");
    Deno.exit(1);
  }
  const res = await fetch(`${BASE_URL}/bundle/${hash}`);
  if (!res.ok) {
    console.error(`error: ${res.status} ${await res.text()}`);
    Deno.exit(1);
  }
  const outDir = args.o;
  if (outDir) {
    const zip = parseZip(await readAll(res.body!));
    for (const [path, data] of zip) {
      const fullPath = `${outDir}/${path}`;
      await Deno.mkdir(fullPath.replace(/\/[^/]+$/, ""), { recursive: true });
      await Deno.writeFile(fullPath, data);
    }
  } else {
    await res.body!.pipeTo(Deno.stdout.writable);
  }
}

async function cmdDescribe(rest: string[]): Promise<void> {
  const hash = rest[0];
  if (!hash) {
    console.error("usage: zts describe <hash> [-d <description>]");
    console.error("  without -d: reads back the current description");
    Deno.exit(1);
  }
  const description = args.d;
  if (description) {
    // Write description
    const res = await fetch(
      `${BASE_URL}/a/${hash}/description`,
      {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: description,
      },
    );
    if (!res.ok) {
      console.error(`error: ${res.status} ${await res.text()}`);
      Deno.exit(1);
    }
    console.log("ok");
  } else {
    // Read description
    const res = await fetch(`${BASE_URL}/a/${hash}/description`);
    if (!res.ok) {
      console.error(`error: ${res.status} ${await res.text()}`);
      Deno.exit(1);
    }
    console.log(await res.text());
  }
}

async function cmdSearch(rest: string[]): Promise<void> {
  const query = rest.join(" ").trim();
  if (!query) {
    console.error("usage: zts search <query> [-k <n>]");
    Deno.exit(1);
  }
  const k = args.k ?? "10";
  const url = new URL(`${BASE_URL}/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("k", k);
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`error: ${res.status} ${await res.text()}`);
    Deno.exit(1);
  }
  const hits = await res.json() as Array<{
    hash: string;
    score: number;
    url: string;
    description: string;
  }>;
  if (hits.length === 0) {
    console.log("no results");
    return;
  }
  for (const hit of hits) {
    const score = hit.score.toFixed(3);
    console.log(`${hit.hash}  ${score}  ${hit.description}`);
  }
}

async function cmdTest(rest: string[]): Promise<void> {
  const hash = rest[0];
  if (!hash) {
    console.error("usage: zts test <hash>");
    Deno.exit(1);
  }
  const url = new URL(`${BASE_URL}/relationships`);
  url.searchParams.set("to", hash);
  url.searchParams.set("kind", "tests");
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`error: ${res.status} ${await res.text()}`);
    Deno.exit(1);
  }
  const rels = await res.json() as Array<
    { from: string; kind: string; to: string }
  >;
  if (rels.length === 0) {
    console.log("no tests registered for " + hash);
    return;
  }
  const testHashes = rels.map((r) => r.from);
  const serverHost = new URL(BASE_URL).host;
  const runnerPath = new URL("./src/test-runner.ts", import.meta.url).pathname;
  const proc = new Deno.Command(Deno.execPath(), {
    args: [
      "test",
      `--allow-import=${serverHost}`,
      "--allow-env=ZTS_SERVER_URL,ZTS_TARGET,ZTS_TESTS",
      "--no-lock",
      runnerPath,
    ],
    env: {
      ...Deno.env.toObject(),
      ZTS_SERVER_URL: BASE_URL,
      ZTS_TARGET: hash,
      ZTS_TESTS: testHashes.join(","),
    },
    stdout: "inherit",
    stderr: "inherit",
  });
  const { code } = await proc.output();
  Deno.exit(code);
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
