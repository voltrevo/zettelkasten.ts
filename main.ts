import { parseArgs } from "@std/cli/parse-args";
import { parseZip } from "./src/bundle.ts";
import { minify } from "./src/minify.ts";
import { MAX_GZIP_BYTES } from "./src/validate.ts";
import { serve } from "./src/server.ts";
import { serveChecker } from "./src/checker.ts";
import {
  configPath,
  type ConfigRole,
  DEFAULT_DATA_DIR,
  initConfig,
  loadConfig,
  type ZtsConfig,
} from "./src/config.ts";
import {
  runWorker,
  setupWorkspace,
  stopWorker,
  type WorkerConfig,
} from "./src/worker.ts";
import { ApiError, createBearerClient } from "./src/api-client.ts";

const args = parseArgs(Deno.args, {
  string: [
    "config",
    "port",
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
    "targets",
    "prompt-file",
    "retrospective-prompt",
  ],
  boolean: [
    "f",
    "no-description",
    "broken",
    "all",
    "done",
    "once",
    "dangerously-skip-permissions",
    "raw",
    "this-code-is-readable",
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

// ---- Config & client setup ----

const dataDir = DEFAULT_DATA_DIR;
const cfgPath = args.config ?? configPath(dataDir);

// Commands that don't need config
const NO_CONFIG_COMMANDS = new Set(["init", "size"]);
const [command, ...rest] = args._ as string[];
const needsConfig = command && !NO_CONFIG_COMMANDS.has(command) && !args.h &&
  !args.help;

let cfg!: ZtsConfig;
let client!: ReturnType<typeof createBearerClient>;

if (needsConfig) {
  const role: ConfigRole = command === "server"
    ? "server"
    : command === "checker"
    ? "checker"
    : "client";
  cfg = await loadConfig(cfgPath, dataDir, role);
  client = createBearerClient(cfg.serverUrl, {
    dev: cfg.devToken || undefined,
    admin: cfg.adminToken || undefined,
  }, Deno);
}

// ---- Derived constants ----

const SERVER_UNIT = "zts-server";
const CHECKER_UNIT = "zts-checker";
const LOGROTATE_UNIT = "zts-logrotate";
const UNIT_DIR = `${Deno.env.get("HOME")}/.config/systemd/user`;
const SERVER_LOG = `${dataDir}/server.log`;
const CHECKER_LOG = `${dataDir}/checker.log`;
const LOGROTATE_CONF = `${dataDir}/logrotate.conf`;
const LOGROTATE_STATE = `${dataDir}/logrotate.status`;

const SUBCOMMAND_HELP: Record<string, string> = {
  init: `zts init
  Create config.json5 in ${DEFAULT_DATA_DIR}/ with random auth tokens.
  Edit the file to customize settings before starting services.`,

  server: `zts server <run|start|stop|restart|log>
  run       start server in foreground
  start     install systemd user service and start
  stop      stop and disable
  restart   restart the daemon
  log       show process log (-f to follow, -n <lines>)

  Reads config from ${DEFAULT_DATA_DIR}/config.json5.
  Override with --config <path>.`,

  checker: `zts checker <run|start|stop|restart|log>
  run       start checker in foreground
  start     install systemd user service and start
  stop      stop and disable
  restart   restart the daemon
  log       show process log (-f to follow, -n <lines>)

  Port configured via checkerPort in config.json5.`,

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

  draft: `zts draft <file>
  Upload an atom as a draft. Validates structure, lint, and size.
  Returns the content hash. Drafts are served over HTTP for exploration.`,

  "add-test": `zts add-test <file> --targets <hash1>,<hash2>,...
  Upload a test atom and run it against targets immediately.
  Works with both draft and published targets.`,

  publish: `zts publish <hash> -d <description> [-g <goal>]
  Promote a draft to a published atom. Requires:
  - All imported atoms to be published
  - At least one test (unless it's a test atom itself)
  Associated test drafts are auto-published.
  -d <desc>   description (required, ASCII only)
  -g <goal>   tag with a goal`,

  archive: `zts archive <hash>
  Archive a draft. Cascades to orphaned test drafts.
  Unarchived drafts are cleaned up automatically after a day.`,

  drafts: `zts drafts
  List current draft atoms.`,

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
  Delete an orphan atom (admin only). Returns 409 if atom has relationships.`,

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
zts goal done <name>                  mark complete (last comment must start with "DONE:")
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

  "show-prompt": `zts show-prompt <prompt|retrospective> [--raw]
  Print the active agent prompt with templates expanded.
  --raw    show raw template without expansion
  Shows DB override if one exists, otherwise the compiled default.`,

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

  script: `zts script '<inline code>'
  zts script -f <file.ts>
  zts script --types

  Type-check and run TypeScript with a pre-configured ZtsClient available
  as the global 'zts'. No imports needed — types are injected automatically.

  Examples:
    zts script 'console.log(await zts.recent({ n: 5 }))'
    zts script -f myscript.ts
    zts script --types    # print ZtsClient type definitions`,
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

// ---- Service definitions ----

interface ServiceDef {
  unitName: string;
  description: string;
  command: string;
  logFile: string;
  perms: string;
}

const SERVER_DEF: ServiceDef = {
  unitName: SERVER_UNIT,
  description: "Zettelkasten atom server",
  command: "server run",
  logFile: SERVER_LOG,
  perms:
    "--allow-net --allow-read --allow-write --allow-env --allow-ffi --allow-import",
};

const CHECKER_DEF: ServiceDef = {
  unitName: CHECKER_UNIT,
  description: "Zettelkasten test checker",
  command: "checker run",
  logFile: CHECKER_LOG,
  perms:
    "--allow-net --allow-run --allow-read --allow-env --allow-write=/tmp --allow-ffi",
};

async function installService(def: ServiceDef): Promise<void> {
  const denoExec = Deno.execPath();
  const scriptPath = new URL(import.meta.url).pathname;
  const projectDir = new URL(".", import.meta.url).pathname;

  const unit = [
    "[Unit]",
    `Description=${def.description}`,
    "",
    "[Service]",
    `WorkingDirectory=${projectDir}`,
    `ExecStart=${denoExec} run ${def.perms} ${scriptPath} ${def.command}`,
    `StandardOutput=append:${def.logFile}`,
    `StandardError=append:${def.logFile}`,
    "Restart=on-failure",
    "",
    "[Install]",
    "WantedBy=default.target",
  ].join("\n") + "\n";

  await Deno.mkdir(UNIT_DIR, { recursive: true });
  await Deno.mkdir(dataDir, { recursive: true });
  await Deno.writeTextFile(`${UNIT_DIR}/${def.unitName}.service`, unit);

  const logrotateConf = [
    `${SERVER_LOG} ${CHECKER_LOG} {`,
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
    "Description=Rotate zettelkasten logs",
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

async function startService(def: ServiceDef): Promise<void> {
  const check = new Deno.Command("systemctl", {
    args: ["--user", "is-active", "--quiet", def.unitName],
  });
  const { code } = await check.output();
  if (code === 0) {
    console.error(
      `error: ${def.unitName} is already running (use 'zts ${
        def.unitName.replace("zts-", "")
      } restart')`,
    );
    Deno.exit(1);
  }
  await installService(def);
  await systemctl("enable", "--now", def.unitName);
  await systemctl("enable", "--now", `${LOGROTATE_UNIT}.timer`);
  console.log(`${def.unitName} enabled and started.`);
  console.log(`Logs: ${def.logFile}`);
}

async function stopService(def: ServiceDef): Promise<void> {
  await systemctl("disable", "--now", def.unitName);
  console.log(`${def.unitName} stopped and disabled.`);
}

async function showLog(logFile: string): Promise<void> {
  const lines = args.n ?? "50";
  const follow = args.f;
  const tailArgs = follow
    ? ["-f", "-n", lines, logFile]
    : ["-n", lines, logFile];
  const proc = new Deno.Command("tail", {
    args: tailArgs,
    stdout: "inherit",
    stderr: "inherit",
  });
  const { code } = await proc.output();
  if (code !== 0) Deno.exit(code);
}

// ---- Command dispatch ----

switch (command) {
  case "server": {
    const sub = rest[0];
    if (sub === "run") {
      await serve({
        port: cfg.serverPort,
        serverUrl: cfg.serverUrl,
        dataDir: cfg.dataDir,
        devToken: cfg.devToken,
        adminToken: cfg.adminToken,
        checkerUrl: cfg.checkerUrl,
        embedUrl: cfg.embedUrl,
        embedModel: cfg.embedModel,
        embedDim: cfg.embedDim,
      });
    } else if (sub === "start") {
      await startService(SERVER_DEF);
    } else if (sub === "stop") {
      await stopService(SERVER_DEF);
    } else if (sub === "restart") {
      await installService(SERVER_DEF);
      await systemctl("restart", SERVER_UNIT);
    } else if (sub === "log") {
      await showLog(SERVER_LOG);
    } else {
      console.error("usage: zts server <run|start|stop|restart|log>");
      Deno.exit(1);
    }
    break;
  }

  case "checker": {
    const sub = rest[0];
    if (sub === "run") {
      serveChecker(cfg.checkerPort);
    } else if (sub === "start") {
      await startService(CHECKER_DEF);
    } else if (sub === "stop") {
      await stopService(CHECKER_DEF);
    } else if (sub === "restart") {
      await installService(CHECKER_DEF);
      await systemctl("restart", CHECKER_UNIT);
    } else if (sub === "log") {
      await showLog(CHECKER_LOG);
    } else {
      console.error("usage: zts checker <run|start|stop|restart|log>");
      Deno.exit(1);
    }
    break;
  }

  case "log":
    await cmdAuditLog();
    break;

  case "runs":
    await cmdRuns(rest);
    break;

  case "get":
    await cmdGet(rest);
    break;

  case "draft":
    await cmdDraft(rest);
    break;

  case "add-test":
    await cmdAddTest(rest);
    break;

  case "publish":
    await cmdPublish(rest);
    break;

  case "archive":
    await cmdArchive(rest);
    break;

  case "drafts":
    await cmdDrafts();
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

  case "script": {
    if (args.types) {
      console.log(await client.scriptTypes());
      break;
    }
    const code = rest.join(" ").trim();
    if (!code) {
      console.error("usage: zts script '<inline code>'");
      console.error("       zts script -f <file.ts>");
      console.error("       zts script --types");
      Deno.exit(1);
    }
    const isFile = !!args.f;
    const result = await client.script(
      isFile ? code : code,
      { file: isFile },
    );
    if (result.code !== 0) {
      Deno.exit(result.code);
    }
    break;
  }

  case "init": {
    const path = await initConfig(dataDir);
    console.log(`Created ${path}`);
    console.log("Edit it to configure tokens and settings, then:");
    console.log("  zts checker run   # start checker");
    console.log("  zts server run    # start server");
    break;
  }

  default:
    console.error(`usage: zts <command> [options]

Corpus:
  draft <file>                 upload atom as draft
  add-test <file> --targets <h1>,<h2>
                               add test, run immediately
  publish <hash> -d <desc> [-g <goal>]
                               promote draft to published
  archive <hash>               archive a draft
  drafts                       list current drafts
  get <hash>                   retrieve source
  delete <hash>                delete orphan atom (admin only)
  recent [-n N] [--goal G] [--broken] [--all]
                               recent published atoms (default 20)
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
  relate <from> <kind> <to>    add relationship (e.g. A supersedes B)
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
  goal done <name>             mark complete (last comment must start with "DONE:")
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
  show-prompt <name>           show agent prompt (prompt/retrospective)

Agent loop:
  worker setup                 create workspace for a channel
  worker [run]                 start the agent loop
  worker stop                  stop a running worker

Scripting:
  script '<code>'              type-check and run inline TypeScript with zts client
  script -f <file.ts>          run script from file
  script --types               print ZtsClient type definitions

Setup:
  init                         create config.json5 with random tokens

Server:
  server run                   start server in foreground
  server start                 install + start daemon
  server stop                  stop + disable daemon
  server restart               restart daemon
  server log [-f] [-n <lines>] show server process log

Checker:
  checker run                  start checker in foreground
  checker start                install + start daemon
  checker stop                 stop + disable daemon
  checker restart              restart daemon
  checker log [-f] [-n <lines>] show checker process log

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

async function cmdAuditLog(): Promise<void> {
  try {
    const entries = await client.getLog({
      recent: args.recent ? parseInt(args.recent, 10) : undefined,
      op: args.op,
      subject: args.subject,
    });
    if (entries.length === 0) {
      console.log("no log entries");
      return;
    }
    for (const e of entries) {
      const detail = e.detail ? `  ${e.detail}` : "";
      console.log(`${e.op}  ${e.subject ?? ""}${detail}  ${e.createdAt}`);
    }
  } catch (e) {
    if (e instanceof ApiError) {
      console.error(`error: ${e.status} ${e.message}`);
      Deno.exit(1);
    }
    throw e;
  }
}

async function cmdRuns(rest: string[]): Promise<void> {
  const hash = rest[0];
  if (!hash) {
    console.error("usage: zts runs <hash> [--recent N]");
    Deno.exit(1);
  }
  try {
    const runs = await client.getTestRuns({
      target: hash,
      recent: args.recent ? parseInt(args.recent, 10) : undefined,
    });
    if (runs.length === 0) {
      console.log("no test runs");
      return;
    }
    for (const r of runs) {
      const ms = r.durationMs !== null ? `${r.durationMs}ms` : "?ms";
      console.log(
        `${r.testAtom}  ${r.result}  ${ms}  ${r.runBy}  ${r.ranAt}`,
      );
    }
  } catch (e) {
    if (e instanceof ApiError) {
      console.error(`error: ${e.status} ${e.message}`);
      Deno.exit(1);
    }
    throw e;
  }
}

async function cmdGet(rest: string[]): Promise<void> {
  const ref = rest[0];
  if (!ref) {
    console.error("usage: zts get <path|hash>");
    Deno.exit(1);
  }
  try {
    const source = await client.getAtom(ref);
    await Deno.stdout.write(new TextEncoder().encode(source));
  } catch (e) {
    if (e instanceof ApiError) {
      console.error(`error: ${e.status} ${e.message}`);
      Deno.exit(1);
    }
    throw e;
  }
}

async function cmdDraft(rest: string[]): Promise<void> {
  const file = rest[0];
  const readable = !!args["this-code-is-readable"];
  if (!file) {
    console.error("usage: zts draft <file>");
    Deno.exit(1);
  }
  const content = await Deno.readTextFile(file);
  try {
    const result = await client.draft(content, { readable });
    console.log(result.hash);
    console.log(result.httpUrl);
    if (result.existing) console.error("(existing draft)");
  } catch (e) {
    if (e instanceof ApiError) {
      console.error(`error: ${e.status} ${e.message}`);
      Deno.exit(1);
    }
    throw e;
  }
}

async function cmdAddTest(rest: string[]): Promise<void> {
  const file = rest[0];
  const targets = args.targets ?? args.t;
  if (!file || !targets) {
    console.error("usage: zts add-test <file> --targets <hash1>,<hash2>");
    Deno.exit(1);
  }
  const content = await Deno.readTextFile(file);
  const targetList = targets.split(",").map((s: string) => s.trim()).filter(
    Boolean,
  );
  try {
    const result = await client.addTest(content, targetList);
    console.log(result.hash);
    if (result.testName) console.log(`  ${result.testName}`);
    for (const r of result.results) {
      console.log(`  ${r.target}: ${r.passed ? "PASS" : "FAIL"}`);
    }
  } catch (e) {
    if (e instanceof ApiError) {
      console.error(`error: ${e.status} ${e.message}`);
      Deno.exit(1);
    }
    throw e;
  }
}

async function cmdPublish(rest: string[]): Promise<void> {
  const hash = rest[0];
  const description = args.d;
  if (!hash || !description) {
    console.error('usage: zts publish <hash> -d "<description>" [-g <goal>]');
    Deno.exit(1);
  }
  try {
    const result = await client.publish(hash, {
      description,
      goal: args.g || undefined,
    });
    console.log(result.hash);
    console.log(result.httpUrl);
    if (result.autoPublished.length > 0) {
      console.log(
        `  auto-published ${result.autoPublished.length} test(s)`,
      );
    }
  } catch (e) {
    if (e instanceof ApiError) {
      console.error(`error: ${e.status} ${e.message}`);
      Deno.exit(1);
    }
    throw e;
  }
}

async function cmdArchive(rest: string[]): Promise<void> {
  const hash = rest[0];
  if (!hash) {
    console.error("usage: zts archive <hash>");
    Deno.exit(1);
  }
  try {
    await client.archive(hash);
    console.log("archived");
  } catch (e) {
    if (e instanceof ApiError) {
      console.error(`error: ${e.status} ${e.message}`);
      Deno.exit(1);
    }
    throw e;
  }
}

async function cmdDrafts(): Promise<void> {
  const drafts = await client.listDrafts();
  if (drafts.length === 0) {
    console.log("no drafts");
    return;
  }
  for (const d of drafts) {
    console.log(
      `${d.hash}  ${d.createdAt}  ${d.description || "(no description)"}`,
    );
  }
}

async function cmdDelete(rest: string[]): Promise<void> {
  const hash = rest[0];
  if (!hash) {
    console.error("usage: zts delete <hash>");
    Deno.exit(1);
  }
  try {
    await client.deleteAtom(hash);
    console.log("deleted");
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 404) {
        console.error("error: atom not found");
      } else {
        console.error(`error: ${e.message}`);
      }
      Deno.exit(1);
    }
    throw e;
  }
}

async function cmdRecent(): Promise<void> {
  try {
    const atoms = await client.recent({
      n: args.n ? parseInt(args.n, 10) : undefined,
      goal: args.goal,
      broken: args.broken,
      prop: args.prop,
      all: args.all,
    });
    if (atoms.length === 0) {
      console.log("no atoms");
      return;
    }
    for (const a of atoms) {
      const goal = a.goal ? ` [${a.goal}]` : "";
      console.log(`${a.hash}  ${a.description}${goal}`);
    }
  } catch (e) {
    if (e instanceof ApiError) {
      console.error(`error: ${e.status} ${e.message}`);
      Deno.exit(1);
    }
    throw e;
  }
}

async function cmdInfo(rest: string[]): Promise<void> {
  const hash = rest[0];
  if (!hash) {
    console.error("usage: zts info <hash>");
    Deno.exit(1);
  }
  try {
    const info = await client.info(hash);
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
  } catch (e) {
    if (e instanceof ApiError) {
      console.error(`error: ${e.status} ${e.message}`);
      Deno.exit(1);
    }
    throw e;
  }
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
    try {
      await client.setProperty(hash, key, value);
      console.log("ok");
    } catch (e) {
      if (e instanceof ApiError) {
        console.error(`error: ${e.status} ${e.message}`);
        Deno.exit(1);
      }
      throw e;
    }
  } else if (sub === "unset") {
    const hash = rest[1];
    const key = rest[2];
    if (!hash || !key) {
      console.error("usage: zts prop unset <hash> <key>");
      Deno.exit(1);
    }
    try {
      await client.unsetProperty(hash, key);
      console.log("removed");
    } catch (e) {
      if (e instanceof ApiError) {
        console.error(`error: ${e.status} ${e.message}`);
        Deno.exit(1);
      }
      throw e;
    }
  } else if (sub === "list") {
    const hash = rest[1];
    if (!hash) {
      console.error("usage: zts prop list <hash>");
      Deno.exit(1);
    }
    try {
      const props = await client.listProperties(hash);
      if (props.length === 0) {
        console.log("no properties");
        return;
      }
      for (const p of props) {
        console.log(p.value ? `${p.key}=${p.value}` : p.key);
      }
    } catch (e) {
      if (e instanceof ApiError) {
        console.error(`error: ${e.status} ${e.message}`);
        Deno.exit(1);
      }
      throw e;
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
  try {
    await client.setTestEvaluation({
      test: testHash,
      target: targetHash,
      expectedOutcome: "violates_intent",
    });
    console.log("registered: violates_intent");
  } catch (e) {
    if (e instanceof ApiError) {
      console.error(`error: ${e.status} ${e.message}`);
      Deno.exit(1);
    }
    throw e;
  }
}

async function cmdFallsShort(rest: string[]): Promise<void> {
  const testHash = rest[0];
  const targetHash = rest[1];
  if (!testHash || !targetHash) {
    console.error("usage: zts falls_short <test-hash> <atom-hash>");
    Deno.exit(1);
  }
  try {
    await client.setTestEvaluation({
      test: testHash,
      target: targetHash,
      expectedOutcome: "falls_short",
    });
    console.log("registered: falls_short");
  } catch (e) {
    if (e instanceof ApiError) {
      console.error(`error: ${e.status} ${e.message}`);
      Deno.exit(1);
    }
    throw e;
  }
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
    try {
      const ev = await client.getTestEvaluation(testHash, targetHash);
      if (!ev) {
        console.error("error: 404 not found");
        Deno.exit(1);
      }
      console.log(`test:     ${ev.testAtom}`);
      console.log(`target:   ${ev.targetAtom}`);
      console.log(`expected: ${ev.expectedOutcome}`);
      if (ev.commentary) console.log(`comment:  ${ev.commentary}`);
    } catch (e) {
      if (e instanceof ApiError) {
        console.error(`error: ${e.status} ${e.message}`);
        Deno.exit(1);
      }
      throw e;
    }
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
    try {
      await client.setTestEvaluation({
        test: testHash,
        target: targetHash,
        expectedOutcome: expected,
        commentary: args.commentary,
      });
      console.log("ok");
    } catch (e) {
      if (e instanceof ApiError) {
        console.error(`error: ${e.status} ${e.message}`);
        Deno.exit(1);
      }
      throw e;
    }
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
  try {
    const tops = await client.tops(hash, {
      limit: args.limit ? parseInt(args.limit, 10) : undefined,
      all: args.all,
    }) as Array<{ hash: string; depth: number; description: string }>;
    if (tops.length === 1 && (tops[0] as { depth: number }).depth === 0) {
      console.log(
        `${tops[0].hash} is already a top — not superseded by anything.`,
      );
      return;
    }
    console.log(`${tops.length} top(s) found.\n`);
    let currentDepth = -1;
    for (
      const t of tops as Array<
        { hash: string; depth: number; description: string }
      >
    ) {
      if (t.depth !== currentDepth) {
        currentDepth = t.depth;
        console.log(`Depth ${currentDepth}:`);
      }
      console.log(`  ${t.hash}  ${t.description}`);
    }
  } catch (e) {
    if (e instanceof ApiError) {
      console.error(`error: ${e.status} ${e.message}`);
      Deno.exit(1);
    }
    throw e;
  }
}

async function cmdGoal(rest: string[]): Promise<void> {
  const sub = rest[0];
  if (sub === "pick") {
    const n = args.n ?? "1";
    try {
      // goal pick uses listGoals — the pick param is passed as a query,
      // but the client doesn't support pick directly, so we list active goals
      // and do client-side weighted random selection
      const goals = await client.listGoals() as Array<{
        name: string;
        weight: number;
        body: string | null;
      }>;
      if (goals.length === 0) {
        console.log("no active goals");
        return;
      }
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
    } catch (e) {
      if (e instanceof ApiError) {
        console.error(`error: ${e.status} ${e.message}`);
        Deno.exit(1);
      }
      throw e;
    }
  } else if (sub === "show") {
    const name = rest[1];
    if (!name) {
      console.error("usage: zts goal show <name>");
      Deno.exit(1);
    }
    try {
      const goal = await client.getGoal(name);
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
    } catch (e) {
      if (e instanceof ApiError) {
        console.error(`error: ${e.status} ${e.message}`);
        Deno.exit(1);
      }
      throw e;
    }
  } else if (sub === "list") {
    try {
      const goals = await client.listGoals({
        done: args.done,
        all: args.all,
      });
      if (goals.length === 0) {
        console.log("no goals");
        return;
      }
      for (const g of goals) {
        const status = g.done ? " [done]" : "";
        const firstLine = g.body ? g.body.split("\n")[0] : "";
        console.log(`${g.name}  weight=${g.weight}${status}  ${firstLine}`);
      }
    } catch (e) {
      if (e instanceof ApiError) {
        console.error(`error: ${e.status} ${e.message}`);
        Deno.exit(1);
      }
      throw e;
    }
  } else if (sub === "done") {
    const name = rest[1];
    if (!name) {
      console.error("usage: zts goal done <name>");
      Deno.exit(1);
    }
    try {
      await client.markGoalDone(name);
      console.log("done");
    } catch (e) {
      if (e instanceof ApiError) {
        console.error(`error: ${e.status} ${e.message}`);
        Deno.exit(1);
      }
      throw e;
    }
  } else if (sub === "undone") {
    const name = rest[1];
    if (!name) {
      console.error("usage: zts goal undone <name>");
      Deno.exit(1);
    }
    try {
      await client.markGoalUndone(name);
      console.log("undone");
    } catch (e) {
      if (e instanceof ApiError) {
        console.error(`error: ${e.status} ${e.message}`);
        Deno.exit(1);
      }
      throw e;
    }
  } else if (sub === "comment") {
    const name = rest[1];
    const text = rest[2];
    if (!name || !text) {
      console.error('usage: zts goal comment <name> "text"');
      Deno.exit(1);
    }
    try {
      await client.addGoalComment(name, text);
      console.log("ok");
    } catch (e) {
      if (e instanceof ApiError) {
        console.error(`error: ${e.status} ${e.message}`);
        Deno.exit(1);
      }
      throw e;
    }
  } else if (sub === "comments") {
    const name = rest[1];
    if (!name) {
      console.error("usage: zts goal comments <name> [--recent N]");
      Deno.exit(1);
    }
    try {
      const comments = await client.getGoalComments(name, {
        recent: args.recent ? parseInt(args.recent, 10) : undefined,
      });
      if (comments.length === 0) {
        console.log("no comments");
        return;
      }
      for (const c of comments) {
        console.log(`[${c.createdAt}] ${c.body}`);
      }
    } catch (e) {
      if (e instanceof ApiError) {
        console.error(`error: ${e.status} ${e.message}`);
        Deno.exit(1);
      }
      throw e;
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
    try {
      const goal = await client.createGoal(name, {
        weight: args.weight ? parseFloat(args.weight) : undefined,
        body: args.body,
      });
      console.log(`created: ${goal.name} (weight ${goal.weight})`);
    } catch (e) {
      if (e instanceof ApiError) {
        console.error(`error: ${e.status} ${e.message}`);
        Deno.exit(1);
      }
      throw e;
    }
  } else if (sub === "set") {
    const name = rest[2];
    if (!name) {
      console.error(
        'usage: zts admin goal set <name> [--weight N] [--body "text"]',
      );
      Deno.exit(1);
    }
    try {
      await client.updateGoal(name, {
        weight: args.weight ? parseFloat(args.weight) : undefined,
        body: args.body,
      });
      console.log("ok");
    } catch (e) {
      if (e instanceof ApiError) {
        console.error(`error: ${e.status} ${e.message}`);
        Deno.exit(1);
      }
      throw e;
    }
  } else if (sub === "delete") {
    const name = rest[2];
    if (!name) {
      console.error("usage: zts admin goal delete <name>");
      Deno.exit(1);
    }
    try {
      await client.deleteGoal(name);
      console.log("deleted");
    } catch (e) {
      if (e instanceof ApiError) {
        console.error(`error: ${e.status} ${e.message}`);
        Deno.exit(1);
      }
      throw e;
    }
  } else {
    console.error("usage: zts admin goal <add|set|delete> ...");
    Deno.exit(1);
  }
}

async function cmdStatus(): Promise<void> {
  try {
    const s = await client.getStatus(args.since) as {
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
  } catch (e) {
    if (e instanceof ApiError) {
      console.error(`error: ${e.status} ${e.message}`);
      Deno.exit(1);
    }
    throw e;
  }
}

function workerConfig(): WorkerConfig {
  return {
    channel: args.channel ?? "default",
    workspacesDir: args["workspaces-dir"] ?? "./workspaces",
    maxTurns: parseInt(args["max-turns"] ?? "100", 10),
    maxIters: parseInt(args["max-iters"] ?? "0", 10),
    once: args.once ?? false,
    dangerouslySkipPermissions: args["dangerously-skip-permissions"] ?? false,
    model: args.model,
    serverUrl: cfg.serverUrl,
    devToken: cfg.devToken,
    promptFile: args["prompt-file"],
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
  if (!name || !["prompt", "retrospective"].includes(name)) {
    console.error(
      "usage: zts show-prompt <prompt|retrospective> [--raw]",
    );
    Deno.exit(1);
  }
  try {
    const result = await client.getPrompt(name);
    if (result.source === "override") {
      console.error(
        `(using override — pass --default to see compiled default)\n`,
      );
    }
    let text = result.text;
    if (!args.raw) {
      // Expand static templates
      const helpProc = new Deno.Command(Deno.execPath(), {
        args: ["run", "--allow-all", new URL(import.meta.url).pathname, "-h"],
        stdout: "piped",
        stderr: "piped",
      });
      const helpOutput = await helpProc.output();
      const cliHelp = new TextDecoder().decode(helpOutput.stderr) +
        new TextDecoder().decode(helpOutput.stdout);
      text = text
        .replace(/\{\{cli-help\}\}/g, cliHelp.trim())
        .replace(/\{\{server-url\}\}/g, cfg.serverUrl);
    }
    console.log(text);
  } catch (e) {
    if (e instanceof ApiError) {
      console.error(`error: ${e.status} ${e.message}`);
      Deno.exit(1);
    }
    throw e;
  }
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
  try {
    const rels = await client.queryRelationships({ from, to, kind });
    if (rels.length === 0) {
      console.log("no relationships found");
      return;
    }
    for (const r of rels) {
      console.log(`${r.from}  --${r.kind}-->  ${r.to}`);
    }
  } catch (e) {
    if (e instanceof ApiError) {
      console.error(`error: ${e.status} ${e.message}`);
      Deno.exit(1);
    }
    throw e;
  }
}

async function cmdDependents(rest: string[]): Promise<void> {
  const hash = rest[0];
  if (!hash) {
    console.error("usage: zts dependents <hash>");
    Deno.exit(1);
  }
  try {
    const rels = await client.queryRelationships({
      to: hash,
      kind: "imports",
    });
    if (rels.length === 0) {
      console.log("no dependents");
      return;
    }
    for (const r of rels) {
      console.log(r.from);
    }
  } catch (e) {
    if (e instanceof ApiError) {
      console.error(`error: ${e.status} ${e.message}`);
      Deno.exit(1);
    }
    throw e;
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
  try {
    const result = await client.addRelationship(from, kind, to);
    console.log(result === "created" ? "created" : "already exists");
  } catch (e) {
    if (e instanceof ApiError) {
      console.error(`error: ${e.status} ${e.message}`);
      Deno.exit(1);
    }
    throw e;
  }
}

async function cmdUnrelate(rest: string[]): Promise<void> {
  const from = rest[0];
  const kind = rest[1];
  const to = rest[2];
  if (!from || !kind || !to) {
    console.error("usage: zts unrelate <from> <kind> <to>");
    Deno.exit(1);
  }
  try {
    await client.removeRelationship(from, kind, to);
    console.log("removed");
  } catch (e) {
    if (e instanceof ApiError) {
      console.error(`error: ${e.status} ${e.message}`);
      Deno.exit(1);
    }
    throw e;
  }
}

async function cmdExec(rest: string[]): Promise<void> {
  const ref = rest[0];
  if (!ref) {
    console.error("usage: zts exec <hash|file.zip>");
    Deno.exit(1);
  }

  try {
    let result;
    if (ref.endsWith(".zip")) {
      const zipData = await Deno.readFile(ref);
      result = await client.execBundle(zipData);
    } else {
      result = await client.exec(ref, rest.slice(1));
    }
    if (result.code !== 0) Deno.exit(result.code);
  } catch (e) {
    if (e instanceof ApiError) {
      console.error(`error: ${e.status} ${e.message}`);
      Deno.exit(1);
    }
    throw e;
  }
}

async function cmdBundle(rest: string[]): Promise<void> {
  const hash = rest[0];
  if (!hash) {
    console.error("usage: zts bundle <hash> [-o <dir>]");
    Deno.exit(1);
  }
  const outDir = args.o;
  if (outDir) {
    try {
      const zipData = await client.getBundle(hash);
      const zip = parseZip(zipData);
      for (const [path, data] of zip) {
        const fullPath = `${outDir}/${path}`;
        await Deno.mkdir(fullPath.replace(/\/[^/]+$/, ""), {
          recursive: true,
        });
        await Deno.writeFile(fullPath, data);
      }
    } catch (e) {
      if (e instanceof ApiError) {
        console.error(`error: ${e.status} ${e.message}`);
        Deno.exit(1);
      }
      throw e;
    }
  } else {
    try {
      const zipData = await client.getBundle(hash);
      await Deno.stdout.write(zipData);
    } catch (e) {
      if (e instanceof ApiError) {
        console.error(`error: ${e.status} ${e.message}`);
        Deno.exit(1);
      }
      throw e;
    }
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
  try {
    if (description) {
      await client.describeUpdate(hash, description);
      console.log("ok");
    } else {
      const text = await client.describeRead(hash);
      console.log(text);
    }
  } catch (e) {
    if (e instanceof ApiError) {
      console.error(`error: ${e.status} ${e.message}`);
      Deno.exit(1);
    }
    throw e;
  }
}

async function cmdSimilar(rest: string[]): Promise<void> {
  const hash = rest[0];
  if (!hash) {
    console.error("usage: zts similar <hash> [-k <n>]");
    Deno.exit(1);
  }
  try {
    const hits = await client.similar(
      hash,
      args.k ? parseInt(args.k, 10) : 10,
    );
    if (hits.length === 0) {
      console.log("no similar atoms");
      return;
    }
    for (const hit of hits) {
      const score = hit.score.toFixed(3);
      console.log(`${hit.hash}  ${score}  ${hit.description}`);
    }
  } catch (e) {
    if (e instanceof ApiError) {
      console.error(`error: ${e.status} ${e.message}`);
      Deno.exit(1);
    }
    throw e;
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
  const k = parseInt(args.k ?? (isCode ? "20" : "10"), 10);
  try {
    if (isCode) {
      const hits = await client.searchCode(query, k);
      if (hits.length === 0) {
        console.log("no results");
        return;
      }
      for (const hit of hits) {
        console.log(`${hit.hash}  ${hit.description}`);
        console.log(`  ${hit.snippet}`);
      }
    } else {
      const hits = await client.search(query, k);
      if (hits.length === 0) {
        console.log("no results");
        return;
      }
      for (const hit of hits) {
        const score = hit.score.toFixed(3);
        console.log(`${hit.hash}  ${score}  ${hit.description}`);
      }
    }
  } catch (e) {
    if (e instanceof ApiError) {
      console.error(`error: ${e.status} ${e.message}`);
      Deno.exit(1);
    }
    throw e;
  }
}

async function cmdTest(rest: string[]): Promise<void> {
  const hash = rest[0];
  if (!hash) {
    console.error("usage: zts test <hash>");
    Deno.exit(1);
  }
  try {
    const results = await client.runTests(hash);
    if (results.length === 0) {
      console.log("no tests registered for " + hash);
      return;
    }
    const allPassed = results.every((r) => r.passed);
    for (const r of results) {
      console.log(`${r.testAtom}  ${r.passed ? "pass" : "FAIL"}`);
      if (r.error) console.error(r.error);
    }
    if (!allPassed) Deno.exit(1);
  } catch (e) {
    if (e instanceof ApiError) {
      console.error(`error: ${e.status} ${e.message}`);
      Deno.exit(1);
    }
    throw e;
  }
}
