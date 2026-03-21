/**
 * Agent loop worker. Manages the iteration lifecycle:
 * handover promotion, prompt assembly, agent invocation, output capture.
 */

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
  // Override prompt files (read from disk instead of server)
  contextPromptFile?: string;
  iterationPromptFile?: string;
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
  await Deno.mkdir(`${dir}/handovers/history`, { recursive: true });
  await Deno.mkdir(`${dir}/notes`, { recursive: true });
  await Deno.mkdir(`${dir}/retrospectives`, { recursive: true });
  await Deno.mkdir(`${dir}/logs`, { recursive: true });
  await Deno.mkdir(`${dir}/tmp`, { recursive: true });

  // Seed files
  await Deno.writeTextFile(`${dir}/.iteration`, "0");

  await Deno.writeTextFile(
    `${dir}/handovers/current.md`,
    `# Handover — first run

This is the first iteration for channel "${config.channel}".
No prior context exists. Pick a goal and start building.
`,
  );

  await Deno.writeTextFile(
    `${dir}/notes/current.md`,
    `# Notes — ${config.channel}

Rolling notes for this channel. Update as you learn things worth
carrying forward across iterations.
`,
  );

  console.log(`Created workspace: ${dir}/`);
  console.log("  handovers/current.md");
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
  } catch {
    return 0;
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
async function getPrompt(
  name: string,
  overrideFile: string | undefined,
  serverUrl: string,
): Promise<string> {
  if (overrideFile) {
    return await Deno.readTextFile(overrideFile);
  }
  const res = await fetch(`${serverUrl}/prompts/${name}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${name} prompt: ${res.status}`);
  }
  return await res.text();
}

/** Get recent retrospective files for context. */
async function getRecentRetrospectives(
  dir: string,
  count: number,
): Promise<string> {
  const retroDir = `${dir}/retrospectives`;
  const files: string[] = [];
  try {
    for await (const entry of Deno.readDir(retroDir)) {
      if (entry.name.startsWith("retro-") && entry.name.endsWith(".md")) {
        files.push(entry.name);
      }
    }
  } catch {
    return "";
  }
  files.sort().reverse();
  const recent = files.slice(0, count);
  const parts: string[] = [];
  for (const f of recent.reverse()) {
    const content = await Deno.readTextFile(`${retroDir}/${f}`);
    parts.push(`--- ${f} ---\n${content}`);
  }
  return parts.join("\n\n");
}

/** Run the agent loop. */
export async function runWorker(config: WorkerConfig): Promise<void> {
  const dir = channelDir(config);

  // Verify workspace exists
  try {
    await Deno.stat(`${dir}/handovers/current.md`);
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

  try {
    let iter = await readIteration(config);

    while (maxIters === 0 || iter < maxIters) {
      iter++;
      const isRetrospective = iter > 0 && iter % RETROSPECTIVE_INTERVAL === 0;
      const mode = isRetrospective ? "retrospective" : "build";

      console.log(`[iter ${iter}] ${mode}`);

      // Fetch prompts
      const contextPrompt = await getPrompt(
        "context",
        config.contextPromptFile,
        config.serverUrl,
      );
      const modePrompt = await getPrompt(
        isRetrospective ? "retrospective" : "iteration",
        isRetrospective
          ? config.retrospectivePromptFile
          : config.iterationPromptFile,
        config.serverUrl,
      );

      // Read handover
      let handover = "";
      try {
        handover = await Deno.readTextFile(`${dir}/handovers/current.md`);
      } catch { /* first run or missing */ }

      // Assemble prompt
      const iterPad = String(iter).padStart(4, "0");
      let prompt = contextPrompt + "\n\n---\n\n" + modePrompt +
        `\n\nCurrent iteration: ${iter}\nChannel: ${config.channel}\n`;
      if (isRetrospective) {
        prompt +=
          `Write your retrospective to: retrospectives/retro-${iterPad}.md\n`;
      }
      prompt +=
        `\n---\n\n# Incoming handover (written by previous iteration — this is your starting context, not your output)\n\n` +
        handover;

      // Add context for retrospective mode
      if (isRetrospective) {
        // Include recent handover history so the agent doesn't waste turns reading files
        const historyDir = `${dir}/handovers/history`;
        const historyFiles: string[] = [];
        try {
          for await (const entry of Deno.readDir(historyDir)) {
            if (entry.name.endsWith(".md")) historyFiles.push(entry.name);
          }
        } catch { /* no history */ }
        historyFiles.sort((a, b) => {
          const na = parseInt(a);
          const nb = parseInt(b);
          return na - nb;
        });
        // Include last 30 handovers
        const recentHistory = historyFiles.slice(-30);
        if (recentHistory.length > 0) {
          prompt += "\n\n---\n\n# Recent handover history\n\n";
          for (const f of recentHistory) {
            const content = await Deno.readTextFile(`${historyDir}/${f}`);
            prompt += `--- iteration ${
              f.replace(".md", "")
            } ---\n${content}\n\n`;
          }
        }

        // Include recent retrospectives
        const retroContext = await getRecentRetrospectives(dir, 3);
        if (retroContext) {
          prompt += "\n\n---\n\n# Recent retrospectives\n\n" + retroContext;
        }
      }

      // Snapshot current handover to history
      if (handover) {
        await Deno.writeTextFile(
          `${dir}/handovers/history/${iter}.md`,
          handover,
        );
      }

      // Remove next.md so we can detect if agent wrote it
      try {
        await Deno.remove(`${dir}/handovers/next.md`);
      } catch { /* didn't exist */ }

      // Create log dir for this iteration
      const iterLogDir = `${dir}/logs/iter-${String(iter).padStart(4, "0")}`;
      await Deno.mkdir(iterLogDir, { recursive: true });

      // Save the assembled prompt
      await Deno.writeTextFile(`${iterLogDir}/prompt.md`, prompt);

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
      claudeArgs.push(
        "--max-turns",
        String(config.maxTurns),
        "--output-format",
        "stream-json",
        "--verbose",
        "-p",
        prompt,
      );

      // Spawn agent — always capture stream-json, show parsed output
      const agentEnv = {
        ...Deno.env.toObject(),
        ZTS_CHANNEL: config.channel,
        ZTS_HANDOVER_DIR: `${dir}/handovers`,
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
      const streamFile = await Deno.open(streamPath, {
        write: true,
        create: true,
        truncate: true,
      });
      const enc = new TextEncoder();
      const dec = new TextDecoder();
      let buf = "";
      for await (const chunk of child.stdout) {
        await streamFile.write(chunk);
        buf += dec.decode(chunk, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop()!;
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const obj = JSON.parse(line);
            if (obj.type === "assistant" && obj.message?.content) {
              Deno.stdout.writeSync(enc.encode("\n"));
              for (const block of obj.message.content) {
                if (block.type === "text" && block.text) {
                  Deno.stdout.writeSync(enc.encode(block.text + "\n"));
                }
                if (block.type === "tool_use") {
                  Deno.stdout.writeSync(
                    enc.encode(`[tool: ${block.name}]\n`),
                  );
                }
              }
            }
          } catch { /* skip */ }
        }
      }
      Deno.stdout.writeSync(enc.encode("\n\n"));
      streamFile.close();
      const { code } = await child.status;
      const durationSec = ((performance.now() - start) / 1000).toFixed(1);

      console.log(
        `[iter ${iter}] exit ${code} (${durationSec}s)`,
      );

      // Promote handover
      try {
        const next = await Deno.readTextFile(`${dir}/handovers/next.md`);
        await Deno.writeTextFile(`${dir}/handovers/current.md`, next);
        await Deno.remove(`${dir}/handovers/next.md`);
      } catch {
        console.warn(
          `[iter ${iter}] WARNING: agent did not write handovers/next.md`,
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
    await Deno.remove(pidFile).catch(() => {});
    console.log("Worker stopped.");
  } catch {
    console.warn(`Process ${pid} not found, cleaning up stale PID file`);
    await Deno.remove(pidFile).catch(() => {});
  }
}
