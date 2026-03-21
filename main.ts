import { parseArgs } from "@std/cli/parse-args";
import { parseZip } from "./src/bundle.ts";
import { minify } from "./src/minify.ts";
import { MAX_GZIP_BYTES } from "./src/validate.ts";
import { DATA_DIR, PORT, serve } from "./src/server.ts";
import {
  runWorker,
  setupWorkspace,
  stopWorker,
  type WorkerConfig,
} from "./src/worker.ts";

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
    "channel",
    "workspaces-dir",
    "max-turns",
    "max-iters",
    "model",
    "context-prompt",
    "iteration-prompt",
    "retrospective-prompt",
  ],
  boolean: [
    "f",
    "no-description",
    "no-tests",
    "broken",
    "all",
    "done",
    "once",
    "dangerously-skip-permissions",
    "h",
    "help",
  ],
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

const SUBCOMMAND_HELP: Record<string, string> = {
  run: `zts run
  Start the server in foreground. Requires ZTS_DEV_TOKEN and ZTS_ADMIN_TOKEN.`,

  start: `zts start
  Install systemd user service and start the daemon.
  Tokens are saved to ${DATA_DIR}/env and loaded by the service.
  Requires ZTS_DEV_TOKEN and ZTS_ADMIN_TOKEN in environment.`,

  stop: `zts stop
  Stop and disable the systemd daemon.`,

  restart: `zts restart
  Restart the systemd daemon.`,

  "server-log": `zts server-log [-f] [-n <lines>]
  Show the server process log (tail).
  -f          follow (live output)
  -n <lines>  number of lines (default: 50)`,

  log: `zts log [--recent N] [--op X] [--subject X]
  Query the structured audit log.
  --recent N      last N entries
  --op X          filter by operation (atom.create, rel.create, goal.done, etc.)
  --subject X     filter by subject (hash or goal name)`,

  runs: `zts runs <hash> [--recent N]
  Show test run history for an atom.
  --recent N   last N runs`,

  get: `zts get <hash>
  Retrieve and print atom source code. Hash prefixes accepted.`,

  post:
    `zts post -d <description> -t <test-hashes> [-g <goal>] [--no-tests] [--no-description] <file>
  Store a new atom.
  -d <desc>          description (required unless --no-description)
  -t <hash,hash,...> test hashes to run before storing (required unless --no-tests)
  -g <goal>          tag atom with a goal
  --no-tests         skip test requirement
  --no-description   skip description requirement`,

  exec: `zts exec <hash|file.zip> [args...]
  Execute an atom's main(globalThis) in an isolated Deno subprocess.
  Pass a hash to fetch from server, or a .zip bundle file.`,

  bundle: `zts bundle <hash> [-o <dir>]
  Download a ZIP bundle of an atom and all transitive dependencies.
  -o <dir>   extract to directory instead of writing ZIP to stdout`,

  describe: `zts describe <hash> [-d <text>]
  Without -d: read back the current description.
  With -d:    update the description.`,

  search: `zts search <query> [-k N]
zts search --code <query> [-k N]
  Semantic search on descriptions (default), or FTS5 search on source code.
  -k N       max results (default: 10 for semantic, 20 for code)
  --code     search source code instead of descriptions`,

  similar: `zts similar <hash> [-k N]
  Find atoms with similar descriptions using stored embeddings.
  Skips the embedding step — uses the atom's existing embedding vector.
  Returns 404 if the atom has no description/embedding.
  -k N       max results (default: 10)`,

  test: `zts test <hash>
  Run all applicable tests (expected_outcome=pass) for an atom.`,

  delete: `zts delete <hash>
  Delete an orphan atom (no relationships). Returns 409 if atom has relationships.`,

  recent: `zts recent [-n N] [--goal G] [--broken] [--prop K] [--all]
  Show recent atoms (default 20).
  -n N         number of atoms to show (default 20)
  --goal G     filter by goal name
  --broken     only atoms with BROKEN: prefix in description
  --prop K     only atoms with property K set
  --all        show all atoms (no limit)`,

  info: `zts info <hash>
  Full atom info: source, description, gzip size, goal, creation date,
  imports, imported-by, tests, tested-by, properties.`,

  size: `zts size <file>
  Estimate gzip size (client-side minify + compress). Shows whether the
  atom fits within the ${MAX_GZIP_BYTES}-byte limit.`,

  rels: `zts rels [--from H] [--to H] [--kind K]
  Query relationships. At least one filter required.
  --from H    relationships from this atom
  --to H      relationships to this atom
  --kind K    filter by kind (imports, tests, supersedes)`,

  dependents: `zts dependents <hash>
  List atoms that import this one (shorthand for rels --to <hash> --kind imports).`,

  relate: `zts relate <from> <kind> <to>
  Add a relationship. Reads naturally: "A tests B", "A supersedes B".
  kind: imports, tests, supersedes
  For kind=tests, the test is run before the relationship is stored.`,

  unrelate: `zts unrelate <from> <kind> <to>
  Remove a relationship.`,

  prop: `zts prop set <hash> <key> [value]
zts prop unset <hash> <key>
zts prop list <hash>
  Manage properties on atoms. Admin-only keys (e.g. starred) require ZTS_ADMIN_TOKEN.`,

  violates_intent: `zts violates_intent <test-hash> <atom-hash>
  Mark a correctness defect. The test must already pass against at least one
  other atom. The server verifies the test actually fails against the target.
  Auto-registers kind=supersedes from the passing atom to the broken one.`,

  falls_short: `zts falls_short <test-hash> <atom-hash>
  Mark a quality gap. The atom doesn't meet some bar the test expresses.
  Not broken — just outclassed on some dimension.`,

  eval: `zts eval show <test> <target>
  Read evaluation metadata for a test-target pair.

zts eval set <test> <target> --expected <outcome> [--commentary <text>]
  Set evaluation metadata.
  --expected    pass, violates_intent, or falls_short
  --commentary  free-text explanation`,

  tops: `zts tops <hash> [--limit N] [--all]
  Navigate the supersedes graph upward from <hash> to find current best
  alternatives (tops = atoms not themselves superseded).
  --limit N   max tops to show (default: 5, level-complete)
  --all       show all tops`,

  goal:
    `zts goal pick [--n N]                weighted random sample of active goals
zts goal show <name>                  full body + all comments
zts goal list [--done] [--all]        list goals
zts goal done <name>                  mark complete
zts goal undone <name>                revert completion
zts goal comment <name> <text>        append observation
zts goal comments <name> [--recent N] read observations`,

  admin: `zts admin goal add <name> [--weight N] [--body <text>]
  Create a goal. Requires ZTS_ADMIN_TOKEN.

zts admin goal set <name> [--weight N] [--body <text>]
  Update a goal's weight or body.

zts admin goal delete <name>
  Delete a goal and all its comments.`,

  status: `zts status [--since YYYY-MM-DD]
  Corpus health summary: total atoms, defects, superseded, recent activity,
  per-goal stats. Default window: last 7 days.`,

  "show-prompt": `zts show-prompt <context|iteration|retrospective>
  Print the active agent prompt. Shows DB override if one exists,
  otherwise the compiled default.`,

  worker: `zts worker [run] [flags]     start the agent loop
zts worker setup [flags]     create workspace for a channel
zts worker stop [flags]      stop a running worker

Flags:
  --channel <name>             channel name (default: default)
  --workspaces-dir <path>      workspaces root (default: ./workspaces)
  --max-turns <N>              agent turns per iteration (default: 100)
  --max-iters <N>              max iterations, 0=infinite (default: 0)
  --once                       run one iteration then exit
  --model <model>              agent model (e.g. sonnet, opus)
  --dangerously-skip-permissions  skip agent permission prompts
  --context-prompt <file>      override context prompt from file
  --iteration-prompt <file>    override iteration prompt from file
  --retrospective-prompt <file>  override retrospective prompt from file`,
};

// Check for per-subcommand help
if (
  command &&
  (args.h || args.help || rest.includes("-h") || rest.includes("--help"))
) {
  const help = SUBCOMMAND_HELP[command];
  if (help) {
    console.log(help);
    Deno.exit(0);
  }
}

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

  case "similar":
    await cmdSimilar(rest);
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

  case "recent":
    await cmdRecent();
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

  case "worker":
    await cmdWorker(rest);
    break;

  default:
    console.error(`usage: zts <command> [options]

Corpus:
  post -d <desc> -t <tests> [-g <goal>] <file>
                               store atom (tests required, --no-tests to skip)
  get <hash>                   retrieve source
  delete <hash>                delete orphan atom
  recent [-n N] [--goal G] [--broken] [--all]
                               recent atoms (default 20)
  info <hash>                  source, description, relationships, properties
  describe <hash> [-d <text>]  read or update description
  search <query> [-k N]        semantic search on descriptions
  similar <hash> [-k N]        find similar atoms by embedding
  search --code <query> [-k N] full-text search on source
  size <file>                  estimate gzip size (client-side)
  exec <hash|file.zip> [args]  run atom's main(globalThis)
  bundle <hash> [-o <dir>]     download or extract zip bundle

Relationships:
  rels [--from H] [--to H] [--kind K]
                               query relationships
  dependents <hash>            atoms that import this one
  relate <from> <kind> <to>    add relationship (e.g. A tests B)
  unrelate <from> <kind> <to>  remove relationship
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

Agent loop:
  worker setup                 create workspace for a channel
  worker [run]                 start the agent loop
  worker stop                  stop a running worker

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
  const noTests = args["no-tests"];
  if (!description && !noDescription) {
    console.error(
      "usage: zts post -d <description> -t <test1,test2,...> [-g <goal>] [file]",
    );
    console.error("  --no-description   opt out of required description");
    console.error("  --no-tests         opt out of required tests");
    Deno.exit(1);
  }
  if (!args.t && !noTests) {
    console.error(
      "error: -t <test-hashes> is required. Use --no-tests to opt out.",
    );
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

async function cmdRecent(): Promise<void> {
  const url = new URL(`${BASE_URL}/recent`);
  if (args.n) url.searchParams.set("n", args.n);
  if (args.all) url.searchParams.set("all", "1");
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

const ADMIN_ONLY_PROPS = new Set(["starred"]);

function propHeaders(
  key: string,
  extra?: Record<string, string>,
): Record<string, string> {
  return ADMIN_ONLY_PROPS.has(key) ? adminHeaders(extra) : devHeaders(extra);
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
      headers: propHeaders(key, { "content-type": "application/json" }),
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
      headers: propHeaders(key, { "content-type": "application/json" }),
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

function workerConfig(): WorkerConfig {
  const devToken = Deno.env.get("ZTS_DEV_TOKEN");
  if (!devToken) {
    console.error(
      "error: ZTS_DEV_TOKEN is not set. Export it to run the worker.",
    );
    Deno.exit(1);
  }
  return {
    channel: args.channel ?? "default",
    workspacesDir: args["workspaces-dir"] ?? "./workspaces",
    maxTurns: parseInt(args["max-turns"] ?? "100", 10),
    maxIters: parseInt(args["max-iters"] ?? "0", 10),
    once: args.once ?? false,
    dangerouslySkipPermissions: args["dangerously-skip-permissions"] ?? false,
    model: args.model,
    serverUrl: BASE_URL,
    devToken,
    contextPromptFile: args["context-prompt"],
    iterationPromptFile: args["iteration-prompt"],
    retrospectivePromptFile: args["retrospective-prompt"],
  };
}

async function cmdWorker(rest: string[]): Promise<void> {
  const sub = rest[0];
  if (sub === "setup") {
    try {
      await setupWorkspace(workerConfig());
    } catch (e) {
      console.error(`error: ${(e as Error).message}`);
      Deno.exit(1);
    }
  } else if (sub === "stop") {
    await stopWorker(workerConfig());
  } else if (!sub || sub === "run") {
    await runWorker(workerConfig());
  } else {
    console.error("usage: zts worker [setup|stop|run]");
    console.error(
      "  setup                        create workspace for channel",
    );
    console.error(
      "  stop                         stop running worker on channel",
    );
    console.error(
      "  run (default)                start the agent loop",
    );
    console.error("");
    console.error("flags:");
    console.error(
      "  --channel <name>             channel name (default: default)",
    );
    console.error(
      "  --workspaces-dir <path>      workspaces root (default: ./workspaces)",
    );
    console.error(
      "  --max-turns <N>              agent turns per iteration (default: 100)",
    );
    console.error(
      "  --max-iters <N>              max iterations, 0=infinite (default: 0)",
    );
    console.error("  --once                       run one iteration then exit");
    console.error(
      "  --model <model>              agent model (e.g. sonnet, opus)",
    );
    console.error(
      "  --dangerously-skip-permissions  skip agent permission prompts",
    );
    console.error(
      "  --context-prompt <file>      override context prompt from file",
    );
    console.error(
      "  --iteration-prompt <file>    override iteration prompt from file",
    );
    console.error(
      "  --retrospective-prompt <file>  override retrospective prompt from file",
    );
    Deno.exit(1);
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
  const kind = rest[1];
  const to = rest[2];
  if (!from || !kind || !to) {
    console.error("usage: zts relate <from> <kind> <to>");
    console.error("  e.g. zts relate <test> tests <target>");
    console.error("       zts relate <new> supersedes <old>");
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
  const kind = rest[1];
  const to = rest[2];
  if (!from || !kind || !to) {
    console.error("usage: zts unrelate <from> <kind> <to>");
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

async function cmdSimilar(rest: string[]): Promise<void> {
  const hash = rest[0];
  if (!hash) {
    console.error("usage: zts similar <hash> [-k <n>]");
    Deno.exit(1);
  }
  const k = args.k ?? "10";
  const url = new URL(`${BASE_URL}/similar/${hash}`);
  url.searchParams.set("k", k);
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`error: ${res.status} ${await res.text()}`);
    Deno.exit(1);
  }
  const hits = await res.json() as Array<{
    hash: string;
    score: number;
    description: string;
  }>;
  if (hits.length === 0) {
    console.log("no similar atoms");
    return;
  }
  for (const hit of hits) {
    const score = hit.score.toFixed(3);
    console.log(`${hit.hash}  ${score}  ${hit.description}`);
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
