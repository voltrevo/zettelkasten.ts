import { parseArgs } from "@std/cli/parse-args";
import { parseZip } from "./src/bundle.ts";
import { minify } from "./src/minify.ts";
import { MAX_GZIP_BYTES } from "./src/validate.ts";
import { DATA_DIR, PORT, serve } from "./src/server.ts";

const BASE_URL = Deno.env.get("ZTS_URL") ?? `http://localhost:${PORT}`;

function checkServerEnv(): void {
  const missing: string[] = [];
  if (!Deno.env.get("ZTS_DEV_TOKEN")) missing.push("ZTS_DEV_TOKEN");
  if (!Deno.env.get("ZTS_ADMIN_TOKEN")) missing.push("ZTS_ADMIN_TOKEN");
  if (missing.length > 0) {
    console.error(
      `error: required environment variables not set: ${missing.join(", ")}`,
    );
    console.error(
      "Set them in your environment or in " + ENV_FILE,
    );
    Deno.exit(1);
  }
}

async function writeEnvFile(): Promise<void> {
  const lines: string[] = [];
  const devToken = Deno.env.get("ZTS_DEV_TOKEN");
  const adminToken = Deno.env.get("ZTS_ADMIN_TOKEN");
  if (devToken) lines.push(`ZTS_DEV_TOKEN=${devToken}`);
  if (adminToken) lines.push(`ZTS_ADMIN_TOKEN=${adminToken}`);
  if (lines.length > 0) {
    await Deno.mkdir(DATA_DIR, { recursive: true });
    await Deno.writeTextFile(ENV_FILE, lines.join("\n") + "\n");
  }
}

function devHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = Deno.env.get("ZTS_DEV_TOKEN");
  if (!token) {
    console.error(
      "error: ZTS_DEV_TOKEN is not set. Export it to use write commands.",
    );
    Deno.exit(1);
  }
  return { authorization: `Bearer ${token}`, ...extra };
}

function adminHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = Deno.env.get("ZTS_ADMIN_TOKEN");
  if (!token) {
    console.error(
      "error: ZTS_ADMIN_TOKEN is not set. Export it to use admin commands.",
    );
    Deno.exit(1);
  }
  return { authorization: `Bearer ${token}`, ...extra };
}

const UNIT_NAME = "zettelkasten";
const LOGROTATE_UNIT = "zts-logrotate";
const UNIT_DIR = `${Deno.env.get("HOME")}/.config/systemd/user`;
const UNIT_FILE = `${UNIT_DIR}/${UNIT_NAME}.service`;
const LOG_FILE = `${DATA_DIR}/server.log`;
const ENV_FILE = `${DATA_DIR}/env`;
const LOGROTATE_CONF = `${DATA_DIR}/logrotate.conf`;
const LOGROTATE_STATE = `${DATA_DIR}/logrotate.status`;

const args = parseArgs(Deno.args, {
  string: [
    "d",
    "m",
    "n",
    "o",
    "k",
    "t",
    "g",
    "recent",
    "goal",
    "prop",
    "from",
    "to",
    "kind",
    "expected",
    "commentary",
    "op",
    "subject",
    "limit",
    "code",
    "weight",
    "body",
    "since",
  ],
  boolean: ["f", "no-description", "broken", "all", "done"],
  alias: {
    d: "description",
    f: "follow",
    n: "lines",
    o: "output",
    t: "tests",
    g: "goal",
  },
});

const RUN_TS = new URL("./run.ts", import.meta.url).pathname;
const [command, ...rest] = args._ as string[];

switch (command) {
  case "run":
    checkServerEnv();
    await serve();
    break;

  case "start":
    checkServerEnv();
    await writeEnvFile();
    await daemonStart();
    break;

  case "stop":
    await daemonStop();
    break;

  case "restart":
    await daemonInstall();
    await systemctl("restart", UNIT_NAME);
    break;

  case "server-log":
    await cmdServerLog();
    break;

  case "log":
    await cmdAuditLog();
    break;

  case "runs":
    await cmdRuns(rest);
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

  case "list":
    await cmdList();
    break;

  case "info":
    await cmdInfo(rest);
    break;

  case "size":
    await cmdSize(rest);
    break;

  case "rels":
    await cmdRels();
    break;

  case "dependents":
    await cmdDependents(rest);
    break;

  case "relate":
    await cmdRelate(rest);
    break;

  case "unrelate":
    await cmdUnrelate(rest);
    break;

  case "prop":
    await cmdProp(rest);
    break;

  case "violates_intent":
    await cmdViolatesIntent(rest);
    break;

  case "falls_short":
    await cmdFallsShort(rest);
    break;

  case "eval":
    await cmdEval(rest);
    break;

  case "tops":
    await cmdTops(rest);
    break;

  case "goal":
    await cmdGoal(rest);
    break;

  case "admin":
    await cmdAdmin(rest);
    break;

  case "status":
    await cmdStatus();
    break;

  case "show-prompt":
    await cmdShowPrompt(rest);
    break;

  default:
    console.error(`usage: zts <command> [options]

Corpus:
  post -d <desc> [-t <tests>] [-g <goal>] <file>
                               store atom
  get <hash>                   retrieve source
  delete <hash>                delete orphan atom
  list [--recent N] [--goal G] [--broken] [--prop K]
                               list atoms
  info <hash>                  source, description, relationships, properties
  describe <hash> [-d <text>]  read or update description
  search <query> [-k N]        semantic search on descriptions
  search --code <query> [-k N] full-text search on source
  size <file>                  estimate gzip size (client-side)
  exec <hash|file.zip> [args]  run atom's main(globalThis)
  bundle <hash> [-o <dir>]     download or extract zip bundle

Relationships:
  rels [--from H] [--to H] [--kind K]
                               query relationships
  dependents <hash>            atoms that import this one
  relate <from> <to> [kind]    add relationship (default: imports)
  unrelate <from> <to> [kind]  remove relationship
  tops <hash> [--limit N] [--all]
                               navigate supersedes graph to best

Testing:
  test <hash>                  run applicable tests
  violates_intent <test> <atom>  mark correctness defect
  falls_short <test> <atom>    mark quality gap
  eval show <test> <target>    read evaluation metadata
  eval set <test> <target> --expected <outcome> [--commentary <text>]
                               set evaluation metadata
  runs <hash> [--recent N]     test run history

Properties:
  prop set <hash> <key> [val]  set a property
  prop unset <hash> <key>      remove a property
  prop list <hash>             list properties on an atom

Goals:
  goal pick [--n N]            weighted random sample
  goal show <name>             body + comments
  goal list [--done] [--all]   list goals
  goal done <name>             mark complete
  goal undone <name>           revert
  goal comment <name> <text>   append observation
  goal comments <name> [--recent N]
                               read observations

Admin:
  admin goal add <name> [--weight N] [--body <text>]
                               create goal
  admin goal set <name> [--weight N] [--body <text>]
                               update goal
  admin goal delete <name>     delete goal

Status & logs:
  status [--since YYYY-MM-DD]  corpus health summary
  log [--recent N] [--op X] [--subject X]
                               query audit log
  show-prompt <name>           show agent prompt (context/iteration/retrospective)

Server:
  run                          start server in foreground
  start                        install + start daemon
  stop                         stop + disable daemon
  restart                      restart daemon
  server-log [-f] [-n <lines>] show server process log

Hash prefixes work everywhere (e.g. zts info 3ax9).
Use <command> -h for detailed help on a specific command.`);
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
    `EnvironmentFile=${ENV_FILE}`,
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

async function cmdServerLog(): Promise<void> {
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

async function cmdAuditLog(): Promise<void> {
  const url = new URL(`${BASE_URL}/log`);
  if (args.recent) url.searchParams.set("recent", args.recent);
  if (args.op) url.searchParams.set("op", args.op);
  if (args.subject) url.searchParams.set("subject", args.subject);
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`error: ${res.status} ${await res.text()}`);
    Deno.exit(1);
  }
  const entries = await res.json() as Array<{
    id: number;
    op: string;
    subject: string | null;
    detail: string | null;
    actor: string | null;
    createdAt: string;
  }>;
  if (entries.length === 0) {
    console.log("no log entries");
    return;
  }
  for (const e of entries) {
    const detail = e.detail ? `  ${e.detail}` : "";
    console.log(`${e.op}  ${e.subject ?? ""}${detail}  ${e.createdAt}`);
  }
}

async function cmdRuns(rest: string[]): Promise<void> {
  const hash = rest[0];
  if (!hash) {
    console.error("usage: zts runs <hash> [--recent N]");
    Deno.exit(1);
  }
  const url = new URL(`${BASE_URL}/test-runs`);
  url.searchParams.set("target", hash);
  if (args.recent) url.searchParams.set("recent", args.recent);
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`error: ${res.status} ${await res.text()}`);
    Deno.exit(1);
  }
  const runs = await res.json() as Array<{
    testAtom: string;
    result: string;
    durationMs: number | null;
    runBy: string;
    ranAt: string;
  }>;
  if (runs.length === 0) {
    console.log("no test runs");
    return;
  }
  for (const r of runs) {
    const ms = r.durationMs !== null ? `${r.durationMs}ms` : "?ms";
    console.log(`${r.testAtom}  ${r.result}  ${ms}  ${r.runBy}  ${r.ranAt}`);
  }
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

  const headers: Record<string, string> = devHeaders();
  if (description) {
    headers["x-description"] = description;
  } else {
    headers["x-allow-no-description"] = "true";
  }
  if (args.t) {
    headers["x-require-tests"] = args.t;
  }
  if (args.g) {
    headers["x-goal"] = args.g;
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
  const res = await fetch(`${BASE_URL}/a/${hash}`, {
    method: "DELETE",
    headers: devHeaders(),
  });
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

async function cmdList(): Promise<void> {
  const url = new URL(`${BASE_URL}/list`);
  if (args.recent) url.searchParams.set("recent", args.recent);
  if (args.goal) url.searchParams.set("goal", args.goal);
  if (args.broken) url.searchParams.set("broken", "1");
  if (args.prop) url.searchParams.set("prop", args.prop);
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`error: ${res.status} ${await res.text()}`);
    Deno.exit(1);
  }
  const atoms = await res.json() as Array<{
    hash: string;
    description: string;
    goal: string | null;
    gzipSize: number;
    createdAt: string;
  }>;
  if (atoms.length === 0) {
    console.log("no atoms");
    return;
  }
  for (const a of atoms) {
    const goal = a.goal ? ` [${a.goal}]` : "";
    console.log(`${a.hash}  ${a.description}${goal}`);
  }
}

async function cmdInfo(rest: string[]): Promise<void> {
  const hash = rest[0];
  if (!hash) {
    console.error("usage: zts info <hash>");
    Deno.exit(1);
  }
  const res = await fetch(`${BASE_URL}/info/${hash}`);
  if (!res.ok) {
    console.error(`error: ${res.status} ${await res.text()}`);
    Deno.exit(1);
  }
  const info = await res.json() as {
    hash: string;
    url: string;
    source: string;
    description: string;
    gzipSize: number;
    goal: string | null;
    createdAt: string;
    imports: string[];
    importedBy: string[];
    tests: string[];
    testedBy: string[];
    properties: { key: string; value: string | null }[];
  };
  console.log(`hash:        ${info.hash}`);
  console.log(`url:         ${info.url}`);
  console.log(`description: ${info.description}`);
  console.log(`size:        ${info.gzipSize} bytes (min+gz)`);
  if (info.goal) console.log(`goal:        ${info.goal}`);
  console.log(`created:     ${info.createdAt}`);
  if (info.imports.length > 0) {
    console.log(`imports:     ${info.imports.join(", ")}`);
  }
  if (info.importedBy.length > 0) {
    console.log(`imported by: ${info.importedBy.join(", ")}`);
  }
  if (info.testedBy.length > 0) {
    console.log(`tested by:   ${info.testedBy.join(", ")}`);
  }
  if (info.properties.length > 0) {
    const propStr = info.properties.map((p) =>
      p.value ? `${p.key}=${p.value}` : p.key
    ).join(", ");
    console.log(`properties:  ${propStr}`);
  }
  if (info.tests.length > 0) {
    console.log(`tests:       ${info.tests.join(", ")}`);
  }
  console.log("---");
  console.log(info.source);
}

async function cmdProp(rest: string[]): Promise<void> {
  const sub = rest[0];
  if (sub === "set") {
    const hash = rest[1];
    const key = rest[2];
    const value = rest[3]; // may be undefined
    if (!hash || !key) {
      console.error("usage: zts prop set <hash> <key> [value]");
      Deno.exit(1);
    }
    const res = await fetch(`${BASE_URL}/properties`, {
      method: "POST",
      headers: devHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({ hash, key, value }),
    });
    if (!res.ok) {
      console.error(`error: ${res.status} ${await res.text()}`);
      Deno.exit(1);
    }
    console.log("ok");
  } else if (sub === "unset") {
    const hash = rest[1];
    const key = rest[2];
    if (!hash || !key) {
      console.error("usage: zts prop unset <hash> <key>");
      Deno.exit(1);
    }
    const res = await fetch(`${BASE_URL}/properties`, {
      method: "DELETE",
      headers: devHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({ hash, key }),
    });
    if (!res.ok) {
      console.error(`error: ${res.status} ${await res.text()}`);
      Deno.exit(1);
    }
    console.log("removed");
  } else if (sub === "list") {
    const hash = rest[1];
    if (!hash) {
      console.error("usage: zts prop list <hash>");
      Deno.exit(1);
    }
    const url = new URL(`${BASE_URL}/properties`);
    url.searchParams.set("hash", hash);
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`error: ${res.status} ${await res.text()}`);
      Deno.exit(1);
    }
    const props = await res.json() as Array<
      { key: string; value: string | null }
    >;
    if (props.length === 0) {
      console.log("no properties");
      return;
    }
    for (const p of props) {
      console.log(p.value ? `${p.key}=${p.value}` : p.key);
    }
  } else {
    console.error("usage: zts prop <set|unset|list> ...");
    Deno.exit(1);
  }
}

async function cmdViolatesIntent(rest: string[]): Promise<void> {
  const testHash = rest[0];
  const targetHash = rest[1];
  if (!testHash || !targetHash) {
    console.error("usage: zts violates_intent <test-hash> <atom-hash>");
    Deno.exit(1);
  }
  const res = await fetch(`${BASE_URL}/test-evaluation`, {
    method: "POST",
    headers: devHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({
      test: testHash,
      target: targetHash,
      expected_outcome: "violates_intent",
    }),
  });
  if (!res.ok) {
    console.error(`error: ${res.status} ${await res.text()}`);
    Deno.exit(1);
  }
  console.log("registered: violates_intent");
}

async function cmdFallsShort(rest: string[]): Promise<void> {
  const testHash = rest[0];
  const targetHash = rest[1];
  if (!testHash || !targetHash) {
    console.error("usage: zts falls_short <test-hash> <atom-hash>");
    Deno.exit(1);
  }
  const res = await fetch(`${BASE_URL}/test-evaluation`, {
    method: "POST",
    headers: devHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({
      test: testHash,
      target: targetHash,
      expected_outcome: "falls_short",
    }),
  });
  if (!res.ok) {
    console.error(`error: ${res.status} ${await res.text()}`);
    Deno.exit(1);
  }
  console.log("registered: falls_short");
}

async function cmdEval(rest: string[]): Promise<void> {
  const sub = rest[0];
  if (sub === "show") {
    const testHash = rest[1];
    const targetHash = rest[2];
    if (!testHash || !targetHash) {
      console.error("usage: zts eval show <test> <target>");
      Deno.exit(1);
    }
    const url = new URL(`${BASE_URL}/test-evaluation`);
    url.searchParams.set("test", testHash);
    url.searchParams.set("target", targetHash);
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`error: ${res.status} ${await res.text()}`);
      Deno.exit(1);
    }
    const ev = await res.json() as {
      testAtom: string;
      targetAtom: string;
      expectedOutcome: string;
      commentary: string | null;
    };
    console.log(`test:     ${ev.testAtom}`);
    console.log(`target:   ${ev.targetAtom}`);
    console.log(`expected: ${ev.expectedOutcome}`);
    if (ev.commentary) console.log(`comment:  ${ev.commentary}`);
  } else if (sub === "set") {
    const testHash = rest[1];
    const targetHash = rest[2];
    if (!testHash || !targetHash) {
      console.error(
        "usage: zts eval set <test> <target> --expected <outcome> [--commentary <text>]",
      );
      Deno.exit(1);
    }
    const expected = args.expected;
    if (!expected) {
      console.error(
        "error: --expected is required (pass/violates_intent/falls_short)",
      );
      Deno.exit(1);
    }
    const res = await fetch(`${BASE_URL}/test-evaluation`, {
      method: "POST",
      headers: devHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({
        test: testHash,
        target: targetHash,
        expected_outcome: expected,
        commentary: args.commentary,
      }),
    });
    if (!res.ok) {
      console.error(`error: ${res.status} ${await res.text()}`);
      Deno.exit(1);
    }
    console.log("ok");
  } else {
    console.error("usage: zts eval <show|set> ...");
    Deno.exit(1);
  }
}

async function cmdTops(rest: string[]): Promise<void> {
  const hash = rest[0];
  if (!hash) {
    console.error("usage: zts tops <hash> [--limit N] [--all]");
    Deno.exit(1);
  }
  const url = new URL(`${BASE_URL}/tops/${hash}`);
  if (args.limit) url.searchParams.set("limit", args.limit);
  if (args.all) url.searchParams.set("all", "1");
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`error: ${res.status} ${await res.text()}`);
    Deno.exit(1);
  }
  const tops = await res.json() as Array<{
    hash: string;
    depth: number;
    description: string;
  }>;
  if (tops.length === 1 && tops[0].depth === 0) {
    console.log(
      `${tops[0].hash} is already a top — not superseded by anything.`,
    );
    return;
  }
  console.log(`${tops.length} top(s) found.\n`);
  let currentDepth = -1;
  for (const t of tops) {
    if (t.depth !== currentDepth) {
      currentDepth = t.depth;
      console.log(`Depth ${currentDepth}:`);
    }
    console.log(`  ${t.hash}  ${t.description}`);
  }
}

async function cmdGoal(rest: string[]): Promise<void> {
  const sub = rest[0];
  if (sub === "pick") {
    const n = args.n ?? "1";
    const url = new URL(`${BASE_URL}/goals`);
    url.searchParams.set("pick", n);
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`error: ${res.status} ${await res.text()}`);
      Deno.exit(1);
    }
    const goals = await res.json() as Array<{
      name: string;
      weight: number;
      body: string;
    }>;
    if (goals.length === 0) {
      console.log("no active goals");
      return;
    }
    // Client-side weighted random pick from the returned list
    const remaining = [...goals];
    const count = Math.min(parseInt(n, 10), remaining.length);
    for (let i = 0; i < count; i++) {
      const totalWeight = remaining.reduce((s, g) => s + g.weight, 0);
      let r = Math.random() * totalWeight;
      let idx = 0;
      for (; idx < remaining.length - 1; idx++) {
        r -= remaining[idx].weight;
        if (r <= 0) break;
      }
      const picked = remaining.splice(idx, 1)[0];
      console.log(`${picked.name} (weight ${picked.weight})`);
      if (picked.body) console.log(`  ${picked.body.split("\n")[0]}`);
    }
  } else if (sub === "show") {
    const name = rest[1];
    if (!name) {
      console.error("usage: zts goal show <name>");
      Deno.exit(1);
    }
    const res = await fetch(`${BASE_URL}/goals/${name}`);
    if (!res.ok) {
      console.error(`error: ${res.status} ${await res.text()}`);
      Deno.exit(1);
    }
    const goal = await res.json() as {
      name: string;
      weight: number;
      done: boolean;
      body: string;
      comments: Array<{ body: string; createdAt: string }>;
    };
    console.log(
      `${goal.name} (weight ${goal.weight}${goal.done ? ", done" : ""})`,
    );
    if (goal.body) console.log(goal.body);
    if (goal.comments.length > 0) {
      console.log("\n--- comments ---");
      for (const c of goal.comments) {
        console.log(`[${c.createdAt}] ${c.body}`);
      }
    }
  } else if (sub === "list") {
    const url = new URL(`${BASE_URL}/goals`);
    if (args.done) url.searchParams.set("done", "1");
    if (args.all) url.searchParams.set("all", "1");
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`error: ${res.status} ${await res.text()}`);
      Deno.exit(1);
    }
    const goals = await res.json() as Array<{
      name: string;
      weight: number;
      done: boolean;
      body: string;
    }>;
    if (goals.length === 0) {
      console.log("no goals");
      return;
    }
    for (const g of goals) {
      const status = g.done ? " [done]" : "";
      const firstLine = g.body ? g.body.split("\n")[0] : "";
      console.log(`${g.name}  weight=${g.weight}${status}  ${firstLine}`);
    }
  } else if (sub === "done") {
    const name = rest[1];
    if (!name) {
      console.error("usage: zts goal done <name>");
      Deno.exit(1);
    }
    const res = await fetch(`${BASE_URL}/goals/${name}/done`, {
      method: "POST",
      headers: devHeaders(),
    });
    if (!res.ok) {
      console.error(`error: ${res.status} ${await res.text()}`);
      Deno.exit(1);
    }
    console.log("done");
  } else if (sub === "undone") {
    const name = rest[1];
    if (!name) {
      console.error("usage: zts goal undone <name>");
      Deno.exit(1);
    }
    const res = await fetch(`${BASE_URL}/goals/${name}/undone`, {
      method: "POST",
      headers: devHeaders(),
    });
    if (!res.ok) {
      console.error(`error: ${res.status} ${await res.text()}`);
      Deno.exit(1);
    }
    console.log("undone");
  } else if (sub === "comment") {
    const name = rest[1];
    const text = rest[2];
    if (!name || !text) {
      console.error('usage: zts goal comment <name> "text"');
      Deno.exit(1);
    }
    const res = await fetch(`${BASE_URL}/goals/${name}/comments`, {
      method: "POST",
      headers: devHeaders({ "content-type": "text/plain" }),
      body: text,
    });
    if (!res.ok) {
      console.error(`error: ${res.status} ${await res.text()}`);
      Deno.exit(1);
    }
    console.log("ok");
  } else if (sub === "comments") {
    const name = rest[1];
    if (!name) {
      console.error("usage: zts goal comments <name> [--recent N]");
      Deno.exit(1);
    }
    const url = new URL(`${BASE_URL}/goals/${name}/comments`);
    if (args.recent) url.searchParams.set("recent", args.recent);
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`error: ${res.status} ${await res.text()}`);
      Deno.exit(1);
    }
    const comments = await res.json() as Array<{
      body: string;
      createdAt: string;
    }>;
    if (comments.length === 0) {
      console.log("no comments");
      return;
    }
    for (const c of comments) {
      console.log(`[${c.createdAt}] ${c.body}`);
    }
  } else {
    console.error(
      "usage: zts goal <pick|show|list|done|undone|comment|comments> ...",
    );
    Deno.exit(1);
  }
}

async function cmdAdmin(rest: string[]): Promise<void> {
  const resource = rest[0];
  const sub = rest[1];
  if (resource !== "goal") {
    console.error("usage: zts admin goal <add|set|delete> ...");
    Deno.exit(1);
  }
  if (sub === "add") {
    const name = rest[2];
    if (!name) {
      console.error(
        'usage: zts admin goal add <name> [--weight N] [--body "text"]',
      );
      Deno.exit(1);
    }
    const payload: { name: string; weight?: number; body?: string } = { name };
    if (args.weight) payload.weight = parseFloat(args.weight);
    if (args.body) payload.body = args.body;
    const res = await fetch(`${BASE_URL}/goals`, {
      method: "POST",
      headers: adminHeaders({ "content-type": "application/json" }),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error(`error: ${res.status} ${await res.text()}`);
      Deno.exit(1);
    }
    const goal = await res.json();
    console.log(`created: ${goal.name} (weight ${goal.weight})`);
  } else if (sub === "set") {
    const name = rest[2];
    if (!name) {
      console.error(
        'usage: zts admin goal set <name> [--weight N] [--body "text"]',
      );
      Deno.exit(1);
    }
    const payload: { weight?: number; body?: string } = {};
    if (args.weight) payload.weight = parseFloat(args.weight);
    if (args.body) payload.body = args.body;
    const res = await fetch(`${BASE_URL}/goals/${name}`, {
      method: "PATCH",
      headers: adminHeaders({ "content-type": "application/json" }),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error(`error: ${res.status} ${await res.text()}`);
      Deno.exit(1);
    }
    console.log("ok");
  } else if (sub === "delete") {
    const name = rest[2];
    if (!name) {
      console.error("usage: zts admin goal delete <name>");
      Deno.exit(1);
    }
    const res = await fetch(`${BASE_URL}/goals/${name}`, {
      method: "DELETE",
      headers: adminHeaders(),
    });
    if (res.status === 204) {
      console.log("deleted");
    } else {
      console.error(`error: ${res.status} ${await res.text()}`);
      Deno.exit(1);
    }
  } else {
    console.error("usage: zts admin goal <add|set|delete> ...");
    Deno.exit(1);
  }
}

async function cmdStatus(): Promise<void> {
  const url = new URL(`${BASE_URL}/status`);
  if (args.since) url.searchParams.set("since", args.since);
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`error: ${res.status} ${await res.text()}`);
    Deno.exit(1);
  }
  const s = await res.json() as {
    totalAtoms: number;
    defects: number;
    superseded: number;
    recentAtoms: number;
    recentRelationships: number;
    recentGoalsDone: number;
    since: string;
    goalStats: {
      name: string;
      total: number;
      recent: number;
      commentCount: number;
    }[];
    activeGoals: { name: string; weight: number }[];
  };
  console.log(
    `Corpus: ${s.totalAtoms} atoms (${s.defects} defects, ${s.superseded} superseded)`,
  );
  console.log(
    `\nRecent (since ${s.since}):  +${s.recentAtoms} atoms  +${s.recentRelationships} relationships  +${s.recentGoalsDone} goals completed`,
  );
  if (s.goalStats.length > 0) {
    console.log("\nGoals (active):");
    for (const g of s.goalStats) {
      const recentStr = g.recent > 0 ? ` (${g.recent} new)` : "";
      console.log(
        `  ${g.name}  ${g.total} atoms${recentStr}  ${g.commentCount} comments`,
      );
    }
  }
}

async function cmdShowPrompt(rest: string[]): Promise<void> {
  const name = rest[0];
  if (!name || !["context", "iteration", "retrospective"].includes(name)) {
    console.error(
      "usage: zts show-prompt <context|iteration|retrospective>",
    );
    Deno.exit(1);
  }
  const res = await fetch(`${BASE_URL}/prompts/${name}`);
  if (!res.ok) {
    console.error(`error: ${res.status} ${await res.text()}`);
    Deno.exit(1);
  }
  const source = res.headers.get("x-prompt-source");
  if (source === "override") {
    console.error(
      `(using override — run with ?default=1 to see compiled default)\n`,
    );
  }
  console.log(await res.text());
}

async function cmdSize(rest: string[]): Promise<void> {
  const file = rest[0];
  if (!file) {
    console.error("usage: zts size <file>");
    Deno.exit(1);
  }
  const source = await Deno.readTextFile(file);
  const minified = minify(source);
  const stream = new CompressionStream("gzip");
  const writer = stream.writable.getWriter();
  writer.write(new TextEncoder().encode(minified));
  writer.close();
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream.readable as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  const size = chunks.reduce((n, c) => n + c.length, 0);
  const status = size <= MAX_GZIP_BYTES ? "within" : "EXCEEDS";
  console.log(
    `${size} bytes (min+gz) — ${status} ${MAX_GZIP_BYTES} byte limit`,
  );
}

async function cmdRels(): Promise<void> {
  const from = args.from;
  const to = args.to;
  const kind = args.kind;
  if (!from && !to && !kind) {
    console.error(
      "usage: zts rels [--from <hash>] [--to <hash>] [--kind <kind>]",
    );
    console.error("  at least one filter required");
    Deno.exit(1);
  }
  const url = new URL(`${BASE_URL}/relationships`);
  if (from) url.searchParams.set("from", from);
  if (to) url.searchParams.set("to", to);
  if (kind) url.searchParams.set("kind", kind);
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`error: ${res.status} ${await res.text()}`);
    Deno.exit(1);
  }
  const rels = await res.json() as Array<{
    from: string;
    kind: string;
    to: string;
    createdAt: string;
  }>;
  if (rels.length === 0) {
    console.log("no relationships found");
    return;
  }
  for (const r of rels) {
    console.log(`${r.from}  --${r.kind}-->  ${r.to}`);
  }
}

async function cmdDependents(rest: string[]): Promise<void> {
  const hash = rest[0];
  if (!hash) {
    console.error("usage: zts dependents <hash>");
    Deno.exit(1);
  }
  const url = new URL(`${BASE_URL}/relationships`);
  url.searchParams.set("to", hash);
  url.searchParams.set("kind", "imports");
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`error: ${res.status} ${await res.text()}`);
    Deno.exit(1);
  }
  const rels = await res.json() as Array<{
    from: string;
    kind: string;
    to: string;
  }>;
  if (rels.length === 0) {
    console.log("no dependents");
    return;
  }
  for (const r of rels) {
    console.log(r.from);
  }
}

async function cmdRelate(rest: string[]): Promise<void> {
  const from = rest[0];
  const to = rest[1];
  const kind = rest[2] ?? "imports";
  if (!from || !to) {
    console.error("usage: zts relate <from> <to> [kind]");
    console.error("  kind defaults to 'imports'");
    Deno.exit(1);
  }
  const res = await fetch(`${BASE_URL}/relationships`, {
    method: "POST",
    headers: devHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ from, to, kind }),
  });
  if (!res.ok) {
    console.error(`error: ${res.status} ${await res.text()}`);
    Deno.exit(1);
  }
  console.log(res.status === 201 ? "created" : "already exists");
}

async function cmdUnrelate(rest: string[]): Promise<void> {
  const from = rest[0];
  const to = rest[1];
  const kind = rest[2] ?? "imports";
  if (!from || !to) {
    console.error("usage: zts unrelate <from> <to> [kind]");
    console.error("  kind defaults to 'imports'");
    Deno.exit(1);
  }
  const res = await fetch(`${BASE_URL}/relationships`, {
    method: "DELETE",
    headers: devHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ from, to, kind }),
  });
  if (!res.ok) {
    console.error(`error: ${res.status} ${await res.text()}`);
    Deno.exit(1);
  }
  console.log("removed");
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
        headers: devHeaders({ "content-type": "text/plain" }),
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
  const isCode = args.code !== undefined;
  // For --code, the query is in args.code (string flag value)
  // For normal search, query is the positional args
  const query = isCode
    ? (typeof args.code === "string" ? args.code : "")
    : rest.join(" ").trim();
  if (!query) {
    console.error("usage: zts search <query> [-k <n>]");
    console.error("       zts search --code <query> [-k <n>]");
    Deno.exit(1);
  }
  const k = args.k ?? (isCode ? "20" : "10");
  const url = new URL(`${BASE_URL}/search`);
  if (isCode) {
    url.searchParams.set("code", query);
  } else {
    url.searchParams.set("q", query);
  }
  url.searchParams.set("k", k);
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`error: ${res.status} ${await res.text()}`);
    Deno.exit(1);
  }
  if (isCode) {
    const hits = await res.json() as Array<{
      hash: string;
      snippet: string;
      description: string;
    }>;
    if (hits.length === 0) {
      console.log("no results");
      return;
    }
    for (const hit of hits) {
      console.log(`${hit.hash}  ${hit.description}`);
      console.log(`  ${hit.snippet}`);
    }
  } else {
    const hits = await res.json() as Array<{
      hash: string;
      score: number;
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
