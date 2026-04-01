/**
 * Agent loop worker. Manages the iteration lifecycle:
 * Summary promotion, prompt assembly, agent invocation, output capture.
 */

import { createBearerClient } from "./api-client.ts";

const RETROSPECTIVE_INTERVAL = 30;

export interface WorkerConfig {
  channel: string;
  workspacesDir: string;
  maxTurns: number;
  maxIters: number; // 0 = infinite
  once: boolean;
  dangerouslySkipPermissions: boolean;
  serverUrl: string;
  devToken: string;
  model?: string; // agent model (e.g. "sonnet", "opus")
  summaryModel?: string; // model for log summaries (default "haiku")
  // Override prompt files (read from disk instead of server)
  promptFile?: string;
  retrospectivePromptFile?: string;
}

export function channelDir(config: WorkerConfig): string {
  return `${config.workspacesDir}/${config.channel}`;
}

/** Create the workspace directory structure for a channel. */
export async function setupWorkspace(config: WorkerConfig): Promise<void> {
  const dir = channelDir(config);

  // Check if already exists
  try {
    await Deno.stat(dir);
    throw new Error(
      `Channel directory already exists: ${dir}\nUse a different --channel name.`,
    );
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }

  // Create structure
  await Deno.mkdir(`${dir}/summary/history`, { recursive: true });
  await Deno.mkdir(`${dir}/notes`, { recursive: true });
  await Deno.mkdir(`${dir}/retrospectives`, { recursive: true });
  await Deno.mkdir(`${dir}/logs`, { recursive: true });
  await Deno.mkdir(`${dir}/tmp`, { recursive: true });

  // Seed files
  await Deno.writeTextFile(`${dir}/.iteration`, "0");

  await Deno.writeTextFile(
    `${dir}/notes/current.md`,
    `# Notes — ${config.channel}

Rolling notes for this channel. Update as you learn things worth
carrying forward across iterations.
`,
  );

  console.log(`Created workspace: ${dir}/`);
  console.log("  notes/current.md");
  console.log("  retrospectives/");
  console.log("  logs/");
  console.log("  tmp/");
  console.log("  .iteration");
}

/** Check for a running worker on this channel. Returns the PID if found. */
export async function checkLock(config: WorkerConfig): Promise<number | null> {
  const pidFile = `${channelDir(config)}/.worker.pid`;
  try {
    const content = await Deno.readTextFile(pidFile);
    const pid = parseInt(content.trim(), 10);
    if (isNaN(pid)) return null;

    // Check if process is alive via /proc
    try {
      await Deno.stat(`/proc/${pid}`);
      return pid; // process exists
    } catch {
      // Process doesn't exist — stale PID file
      console.warn(
        `warning: stale .worker.pid (PID ${pid} no longer running), cleaning up`,
      );
      await Deno.remove(pidFile);
      return null;
    }
  } catch {
    return null; // no PID file
  }
}

/** Write the PID lock file. */
export async function writeLock(config: WorkerConfig): Promise<void> {
  await Deno.writeTextFile(
    `${channelDir(config)}/.worker.pid`,
    String(Deno.pid),
  );
}

/** Remove the PID lock file. */
export async function removeLock(config: WorkerConfig): Promise<void> {
  try {
    await Deno.remove(`${channelDir(config)}/.worker.pid`);
  } catch { /* ignore */ }
}

/** Read the iteration counter. */
export async function readIteration(config: WorkerConfig): Promise<number> {
  try {
    const content = await Deno.readTextFile(
      `${channelDir(config)}/.iteration`,
    );
    return parseInt(content.trim(), 10) || 0;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return 0;
    throw e;
  }
}

/** Write the iteration counter. */
export async function writeIteration(
  config: WorkerConfig,
  n: number,
): Promise<void> {
  await Deno.writeTextFile(`${channelDir(config)}/.iteration`, String(n));
}

/** Fetch the active prompt from the server, or read from override file. */
/** Capability interface for prompt building — inject real I/O or test stubs. */
export interface PromptCap {
  readTextFile(path: string): Promise<string>;
  readDir(path: string): AsyncIterable<{ name: string }>;
  fetchPrompt(name: string): Promise<string>;
}

export interface BuildPromptOpts {
  rawPrompt: string;
  serverUrl: string;
  workspaceDir: string;
  goalText: string;
  taskText: string;
  iter: number;
  channel: string;
  isRetrospective: boolean;
}

/** Build the fully expanded prompt for an iteration. */
export async function buildPrompt(
  cap: PromptCap,
  opts: BuildPromptOpts,
): Promise<string> {
  const { serverUrl, workspaceDir, goalText, iter, channel, isRetrospective } =
    opts;
  const iterPad = String(iter).padStart(4, "0");

  // Count summary history files
  let historyCount = 0;
  try {
    for await (const e of cap.readDir(`${workspaceDir}/summary/history`)) {
      if (e.name.endsWith(".md")) historyCount++;
    }
  } catch { /* empty */ }
  const summaryRef = historyCount > 0
    ? `To this end, for your interest, historical summaries are available at` +
      ` \`${workspaceDir}/summary/history/\` (${historyCount} files, named by iteration number).`
    : "(First iteration — no prior summaries exist.)";

  // Expand template variables
  let prompt = opts.rawPrompt
    .replace(/\{\{server-url\}\}/g, serverUrl)
    .replace(/\{\{workspace\}\}/g, workspaceDir)
    .replace(/\{\{summary\}\}/g, summaryRef)
    .replace(/\{\{goal\}\}/g, goalText)
    .replace(/\{\{task\}\}/g, opts.taskText);

  prompt += `\n\nCurrent iteration: ${iter}\nChannel: ${channel}\n`;
  if (isRetrospective) {
    prompt +=
      `Write your retrospective to: retrospectives/retro-${iterPad}.md\n`;
  }

  // Build retrospective context
  if (isRetrospective) {
    let retroCtx = "";

    // Recent summaries
    const historyFiles: string[] = [];
    try {
      for await (
        const entry of cap.readDir(`${workspaceDir}/summary/history`)
      ) {
        if (entry.name.endsWith(".md")) historyFiles.push(entry.name);
      }
    } catch { /* no history */ }
    historyFiles.sort((a, b) => parseInt(a) - parseInt(b));
    const recentHistory = historyFiles.slice(-30);
    if (recentHistory.length > 0) {
      retroCtx += "# Recent summary history\n\n";
      for (const f of recentHistory) {
        const content = await cap.readTextFile(
          `${workspaceDir}/summary/history/${f}`,
        );
        retroCtx += `--- iteration ${f.replace(".md", "")} ---\n${content}\n\n`;
      }
    }

    // Past retrospectives
    const retroFiles: string[] = [];
    try {
      for await (const entry of cap.readDir(`${workspaceDir}/retrospectives`)) {
        if (entry.name.startsWith("retro-") && entry.name.endsWith(".md")) {
          retroFiles.push(entry.name);
        }
      }
    } catch { /* none */ }
    retroFiles.sort().reverse();
    const recentRetros = retroFiles.slice(0, 3).reverse();
    if (recentRetros.length > 0) {
      const parts: string[] = [];
      for (const f of recentRetros) {
        const content = await cap.readTextFile(
          `${workspaceDir}/retrospectives/${f}`,
        );
        parts.push(`--- ${f} ---\n${content}`);
      }
      retroCtx += "\n# Recent retrospectives\n\n" + parts.join("\n\n");
    }

    prompt = prompt.replace(
      /\{\{retrospective-context\}\}/g,
      retroCtx || "(No prior context available.)",
    );
  }

  return prompt;
}

/** Build the goal text for inlining into the prompt. */
export function formatGoalText(
  goal: {
    name: string;
    weight: number;
    body: string | null;
    hasFiles?: boolean;
  },
): string {
  let text = `**${goal.name}** (weight ${goal.weight})\n\n${goal.body ?? ""}`;
  if (goal.hasFiles) {
    text += "\n\n*This is a directory goal with additional files." +
      ` Use \`zts goal files ${goal.name}\` to list them` +
      ` and \`zts goal file ${goal.name} <path>\` to read specific sections.*`;
  }
  return text;
}

/** Real PromptCap backed by Deno I/O and server fetch. */
function realPromptCap(serverUrl: string): PromptCap {
  return {
    readTextFile: (p) => Deno.readTextFile(p),
    readDir: (p) => Deno.readDir(p),
    fetchPrompt: async (name) => {
      const res = await fetch(`${serverUrl}/prompts/${name}`);
      if (!res.ok) {
        throw new Error(`Failed to fetch ${name} prompt: ${res.status}`);
      }
      return res.text();
    },
  };
}

/** Run the agent loop. */
// --- Pretty-print helpers for stream output ---

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

function midTrunc(s: string, max: number): string {
  if (s.length <= max) return s;
  const half = Math.floor((max - 3) / 2);
  return s.slice(0, half) + "..." + s.slice(s.length - half);
}

function createPrettyEmitter(prettyPath: string) {
  const enc = new TextEncoder();
  function emit(s: string) {
    Deno.stdout.writeSync(enc.encode(s));
    Deno.writeFileSync(prettyPath, enc.encode(s), { append: true });
  }
  function emitLn(s: string) {
    emit(s + "\n");
  }
  function emitResult(content: string, isError: boolean) {
    const color = isError ? C.red : C.gray;
    const lines = content.split("\n");
    if (lines.length > 10) {
      for (const l of lines.slice(0, 2)) {
        emitLn(`  ${color}→ ${midTrunc(l, 120)}${C.reset}`);
      }
      emitLn(
        `  ${color}  ... ${lines.length - 4} more lines ...${C.reset}`,
      );
      for (const l of lines.slice(-2)) {
        emitLn(`  ${color}→ ${midTrunc(l, 120)}${C.reset}`);
      }
    } else {
      for (const l of lines) {
        emitLn(`  ${color}→ ${midTrunc(l, 120)}${C.reset}`);
      }
    }
  }
  return { emit, emitLn, emitResult };
}

export async function runWorker(config: WorkerConfig): Promise<void> {
  const dir = channelDir(config);

  // Verify workspace exists
  try {
    await Deno.stat(`${dir}/summary`);
  } catch {
    console.error(
      `error: workspace not found at ${dir}. Run: zts worker setup --channel ${config.channel}`,
    );
    Deno.exit(1);
  }

  // Check lock
  const existingPid = await checkLock(config);
  if (existingPid !== null) {
    console.error(
      `error: channel "${config.channel}" already has a running worker (PID ${existingPid}).`,
    );
    console.error(
      "Use a different --channel or stop the existing worker with: zts worker stop --channel " +
        config.channel,
    );
    Deno.exit(1);
  }

  // Write lock
  await writeLock(config);

  const maxIters = config.once ? 1 : config.maxIters;

  // Handle graceful shutdown
  let stopping = false;
  Deno.addSignalListener("SIGINT", () => {
    if (stopping) Deno.exit(1); // second ctrl+c force-kills
    console.log("\n[worker] SIGINT received, finishing current iteration...");
    stopping = true;
  });
  Deno.addSignalListener("SIGTERM", () => {
    stopping = true;
  });

  try {
    let iter = await readIteration(config);

    const client = createBearerClient(config.serverUrl, {
      dev: config.devToken,
    });

    while (!stopping && (maxIters === 0 || iter < maxIters)) {
      // Pick a goal for this iteration
      let goalText = "(No open goals)";
      let goalName = "";
      let goals;
      try {
        goals = await client.listGoals();
      } catch (e) {
        console.warn(
          `[worker] server unreachable: ${
            (e as Error).message
          }, backing off 30s`,
        );
        await new Promise((r) => setTimeout(r, 30_000));
        continue;
      }
      if (goals.length === 0) {
        console.log("[worker] No open goals, stopping.");
        break;
      }
      // Weighted random pick
      const totalWeight = goals.reduce((s, g) => s + g.weight, 0);
      let r = Math.random() * totalWeight;
      let picked = goals[0];
      for (const g of goals) {
        r -= g.weight;
        if (r <= 0) {
          picked = g;
          break;
        }
      }
      goalName = picked.name;
      try {
        const detail = await client.getGoal(goalName);
        goalText = formatGoalText(detail);
      } catch (e) {
        console.warn(
          `[worker] failed to fetch goal "${goalName}": ${
            (e as Error).message
          }, backing off 30s`,
        );
        await new Promise((r) => setTimeout(r, 30_000));
        continue;
      }

      // Pick task (or set planning mode)
      let taskText: string;
      try {
        const task = await client.pickTask(goalName);
        if (task) {
          taskText =
            `**${task.id}: ${task.title}**\n\n` +
            (task.description
              ? task.description + "\n\n"
              : "") +
            `Complete this task. Draft, test, and publish the atom(s) needed,` +
            ` then mark it done with \`zts task done ${task.id}\`.\n\n` +
            `One atom at a time. Never have more than two unpublished drafts.` +
            ` If this task requires changing multiple atoms in a dependency` +
            ` chain, build from the leaves up.\n\n` +
            `Use \`zts task list ${goalName}\` to see the full task tree.`;
        } else {
          // No tasks yet — agent should create the breakdown
          taskText =
            `No tasks exist for this goal yet.\n\n` +
            `Your job this iteration is to **plan**: read the goal spec,` +
            ` check current coverage (\`zts goal coverage ${goalName}` +
            ` --entries <hash>\`), and break the remaining work into ordered` +
            ` tasks using \`zts task add\`.\n\n` +
            `Keep each task small enough to draft-test-publish in a single` +
            ` iteration. Order them so leaves come before parents. Nest` +
            ` related tasks with \`--parent <id>\`.\n\n` +
            `Do not draft or publish atoms this iteration — just plan.`;
        }
      } catch {
        taskText = "(task system unavailable)";
      }

      iter++;
      const isRetrospective = iter > 0 && iter % RETROSPECTIVE_INTERVAL === 0;
      const mode = isRetrospective ? "retrospective" : "build";

      // Reset terminal state before each iteration
      Deno.stdout.writeSync(new TextEncoder().encode(
        "\x1b[0m" + // reset SGR (bold, color, etc.)
          "\x1b[?25h" + // show cursor
          "\x1b[?7h" + // re-enable line wrap
          "\x1b[?1000l" + // disable mouse reporting
          "\x1b[?2004l" + // disable bracketed paste
          "\x1b(B", // reset character set to ASCII
      ));
      // Reset terminal attributes (echo, raw mode, etc.)
      try {
        await new Deno.Command("stty", { args: ["sane"], stdin: "inherit" })
          .output();
      } catch { /* not a TTY or stty unavailable */ }
      console.log(
        `[iter ${iter}] ${mode}${goalName ? ` — goal: ${goalName}` : ""}`,
      );

      // Fetch prompt template from server (checks DB override, then disk default)
      const pCap = realPromptCap(config.serverUrl);
      const overrideFile = isRetrospective
        ? config.retrospectivePromptFile
        : config.promptFile;
      const rawPrompt = overrideFile
        ? await pCap.readTextFile(overrideFile)
        : await pCap.fetchPrompt(
          isRetrospective ? "retrospective" : "prompt",
        );

      const absDir = dir.startsWith("/") ? dir : `${Deno.cwd()}/${dir}`;

      // Build the fully expanded prompt
      const prompt = await buildPrompt(pCap, {
        rawPrompt,
        serverUrl: config.serverUrl,
        workspaceDir: absDir,
        goalText,
        taskText,
        iter,
        channel: config.channel,
        isRetrospective,
      });

      // Create log dir for this iteration
      const iterLogDir = `${dir}/logs/iter-${String(iter).padStart(4, "0")}`;
      await Deno.mkdir(iterLogDir, { recursive: true });

      // Build claude args
      const claudeArgs: string[] = [];
      if (config.dangerouslySkipPermissions) {
        claudeArgs.push("--dangerously-skip-permissions");
      } else {
        // Allow tool access to the workspace dir
        const absDir = dir.startsWith("/") ? dir : `${Deno.cwd()}/${dir}`;
        claudeArgs.push("--add-dir", absDir);
        claudeArgs.push("--permission-mode", "acceptEdits");
      }
      if (config.model) {
        claudeArgs.push("--model", config.model);
      }
      // Write prompt to file to avoid E2BIG on large retrospective prompts
      await Deno.writeTextFile(`${iterLogDir}/prompt.md`, prompt);

      claudeArgs.push(
        "--max-turns",
        String(config.maxTurns),
        "--output-format",
        "stream-json",
        "--verbose",
        "-p",
        `Follow the instructions in ${iterLogDir}/prompt.md`,
      );

      // Spawn agent — always capture stream-json, show parsed output
      const agentEnv = {
        ...Deno.env.toObject(),
        ZTS_CHANNEL: config.channel,
        ZTS_SUMMARY_DIR: `${dir}/summary`,
        ZTS_SERVER_URL: config.serverUrl,
        ZTS_DEV_TOKEN: config.devToken,
      };
      const child = new Deno.Command("claude", {
        args: claudeArgs,
        cwd: dir,
        env: agentEnv,
        stdout: "piped",
        stderr: "inherit",
        stdin: config.dangerouslySkipPermissions ? "null" : "inherit",
      }).spawn();

      const start = performance.now();
      const streamPath = `${iterLogDir}/stream.jsonl`;
      const prettyPath = `${iterLogDir}/pretty.log`;
      const streamFile = await Deno.open(streamPath, {
        write: true,
        create: true,
        truncate: true,
      });
      const enc = new TextEncoder();
      const dec = new TextDecoder();

      const { emitLn, emitResult } = createPrettyEmitter(prettyPath);
      let buf = "";
      const reader = child.stdout.getReader();
      let lastOutput = performance.now();
      let lastWasTool = false;
      const silenceTimer = setInterval(() => {
        const elapsed = Math.round((performance.now() - lastOutput) / 1000);
        if (elapsed >= 10) {
          emitLn(`${C.gray}[silence: ${elapsed}s]${C.reset}`);
        }
      }, 10_000);

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          lastOutput = performance.now();
          await streamFile.write(value);
          buf += dec.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop()!;
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const obj = JSON.parse(line);

              // System init
              if (obj.type === "system" && obj.subtype === "init") {
                emitLn(
                  `${C.gray}session ${obj.session_id?.slice(0, 8)} model=${
                    obj.model ?? "?"
                  }${C.reset}\n`,
                );
                continue;
              }

              // System other / rate limit
              if (obj.type === "system") {
                emitLn(
                  `  ${C.gray}[system: ${obj.subtype ?? "?"}]${C.reset}`,
                );
                continue;
              }
              if (obj.type === "rate_limit_event") {
                emitLn(`  ${C.gray}[rate limit]${C.reset}`);
                continue;
              }

              // Result (end of session)
              if (obj.type === "result") {
                const dur = obj.duration_ms
                  ? `${(obj.duration_ms / 1000).toFixed(1)}s`
                  : "?";
                const cost = obj.total_cost_usd
                  ? `$${obj.total_cost_usd.toFixed(4)}`
                  : "";
                const err = obj.is_error ? ` ${C.red}ERROR${C.reset}` : "";
                emitLn(
                  `\n${C.gray}done: ${obj.num_turns} turns, ${dur}${
                    cost ? ", " + cost : ""
                  }${err}${C.reset}`,
                );
                if (obj.errors?.length) {
                  for (const e of obj.errors.slice(0, 3)) {
                    emitLn(`${C.red}  ${midTrunc(e, 200)}${C.reset}`);
                  }
                }
                continue;
              }

              // Assistant messages
              if (obj.type === "assistant" && obj.message?.content) {
                for (const block of obj.message.content) {
                  if (block.type === "text" && block.text?.trim()) {
                    if (lastWasTool) emitLn("");
                    emitLn(
                      `${C.bold}${C.yellow}${block.text.trim()}${C.reset}`,
                    );
                    emitLn("");
                    lastWasTool = false;
                  }
                  if (block.type === "tool_use") {
                    const input = block.input ?? {};
                    if (block.name === "Bash" && input.command) {
                      emitLn(
                        `  ${C.bold}${C.green}$ ${
                          midTrunc(input.command, 200)
                        }${C.reset}`,
                      );
                    } else if (block.name === "Write" && input.file_path) {
                      emitLn(
                        `  ${C.dim}${C.green}write: ${input.file_path}${C.reset}`,
                      );
                    } else if (block.name === "Read" && input.file_path) {
                      emitLn(
                        `  ${C.dim}${C.green}read: ${input.file_path}${C.reset}`,
                      );
                    } else if (block.name === "Edit" && input.file_path) {
                      emitLn(
                        `  ${C.dim}${C.green}edit: ${input.file_path}${C.reset}`,
                      );
                    } else if (block.name === "Grep") {
                      emitLn(
                        `  ${C.dim}${C.green}grep: /${
                          input.pattern ?? ""
                        }/ in ${input.path ?? "."}${C.reset}`,
                      );
                    } else if (block.name === "Glob") {
                      emitLn(
                        `  ${C.dim}${C.green}glob: ${
                          input.pattern ?? ""
                        }${C.reset}`,
                      );
                    } else if (
                      block.name === "Agent" || block.name === "Task"
                    ) {
                      const desc = input.description ??
                        input.prompt?.slice(0, 60) ?? "";
                      emitLn(
                        `  ${C.bold}${C.cyan}agent: ${desc}${C.reset}`,
                      );
                    } else {
                      emitLn(
                        `  ${C.dim}${C.green}${block.name}: ${
                          midTrunc(JSON.stringify(input), 100)
                        }${C.reset}`,
                      );
                    }
                    lastWasTool = true;
                  }
                  if (block.type === "thinking" && block.thinking?.trim()) {
                    emitLn(
                      `  ${C.gray}thinking: ${
                        midTrunc(block.thinking.trim(), 240)
                      }${C.reset}`,
                    );
                    lastWasTool = true;
                  }
                }
                continue;
              }

              // User messages (tool results)
              if (obj.type === "user" && obj.message?.content) {
                for (const block of obj.message.content) {
                  if (block.type === "tool_result") {
                    const content = typeof block.content === "string"
                      ? block.content
                      : "";
                    if (!content.trim()) {
                      emitLn(`  ${C.gray}→ (empty)${C.reset}`);
                      continue;
                    }
                    emitResult(content, !!block.is_error);
                    continue;
                  }
                  if (block.type === "text" && block.text) {
                    emitLn(
                      `  ${C.gray}[user: ${
                        midTrunc(block.text.trim(), 80)
                      }]${C.reset}`,
                    );
                  }
                }
                continue;
              }

              // Anything else
              emitLn(`  ${C.gray}[${obj.type ?? "unknown"}]${C.reset}`);
            } catch (e) {
              console.warn(
                `[iter ${iter}] malformed stream line: ${(e as Error).message}`,
              );
            }
          }
        }
      } finally {
        clearInterval(silenceTimer);
      }
      Deno.stdout.writeSync(enc.encode("\n\n"));
      streamFile.close();
      const { code } = await child.status;
      const durationSec = ((performance.now() - start) / 1000).toFixed(1);

      console.log(
        `[iter ${iter}] exit ${code} (${durationSec}s)`,
      );

      // Summarize the pretty log
      try {
        const prettyContent = await Deno.readTextFile(prettyPath);
        if (prettyContent.trim()) {
          const summaryModel = config.summaryModel ?? "haiku";
          console.log(`[iter ${iter}] summarizing log (${summaryModel})...`);
          const summaryProc = new Deno.Command("claude", {
            args: [
              "--model",
              summaryModel,
              "--max-turns",
              "1",
              "--output-format",
              "text",
              "-p",
              "Summarize what happened in this agent iteration." +
              " Be factual and concise: what was built, what commands were run," +
              " what errors occurred, what was the outcome." +
              " Do not editorialize.\n\n" + prettyContent,
            ],
            stdout: "piped",
            stderr: "piped",
          });
          const summaryOutput = await summaryProc.output();
          if (summaryOutput.code === 0) {
            const summary = new TextDecoder().decode(summaryOutput.stdout);
            await Deno.writeTextFile(
              `${iterLogDir}/log-summary.md`,
              summary,
            );
            console.log(`[iter ${iter}] log summary written`);
          } else {
            console.warn(
              `[iter ${iter}] log summary failed (exit ${summaryOutput.code})`,
            );
          }
        }
      } catch (e) {
        console.warn(
          `[iter ${iter}] log summary error: ${(e as Error).message}`,
        );
      }

      // Move tmp.md → history/<iter>.md
      try {
        await Deno.rename(
          `${dir}/summary/tmp.md`,
          `${dir}/summary/history/${iter}.md`,
        );
      } catch {
        console.warn(
          `[iter ${iter}] WARNING: agent did not write summary/tmp.md`,
        );
      }

      // Update iteration counter
      await writeIteration(config, iter);

      // Back off on error
      if (code !== 0) {
        console.warn(`[iter ${iter}] non-zero exit, backing off 30s`);
        await new Promise((r) => setTimeout(r, 30_000));
      }
    }

    console.log(
      `Worker finished after ${await readIteration(config)} iterations.`,
    );
  } finally {
    await removeLock(config);
  }
}

/** Stop a running worker on a channel. */
export async function stopWorker(config: WorkerConfig): Promise<void> {
  const pidFile = `${channelDir(config)}/.worker.pid`;
  let content: string;
  try {
    content = await Deno.readTextFile(pidFile);
  } catch {
    console.error(
      `No worker running for channel "${config.channel}" (no .worker.pid found)`,
    );
    Deno.exit(1);
  }
  const pid = parseInt(content.trim(), 10);
  if (isNaN(pid)) {
    console.error("Invalid PID file");
    Deno.exit(1);
  }

  try {
    const kill = new Deno.Command("kill", { args: [String(pid)] });
    await kill.output();
    console.log(`Sent SIGTERM to worker PID ${pid}`);
    // Wait briefly for cleanup
    await new Promise((r) => setTimeout(r, 2000));
    await Deno.remove(pidFile).catch((e) =>
      console.warn(`warning: failed to remove ${pidFile}: ${e.message}`)
    );
    console.log("Worker stopped.");
  } catch {
    console.warn(`Process ${pid} not found, cleaning up stale PID file`);
    await Deno.remove(pidFile).catch((e) =>
      console.warn(`warning: failed to remove ${pidFile}: ${e.message}`)
    );
  }
}
