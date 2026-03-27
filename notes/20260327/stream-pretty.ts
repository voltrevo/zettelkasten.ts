#!/usr/bin/env -S deno run --allow-read
// Pretty-print a Claude stream-json JSONL file.
// Usage: docker exec zts-agent /home/zts/stream-pretty.ts [iter-NNNN]
//    or: ./stream-pretty.ts /path/to/stream.jsonl

const LOGS_DIR = "/home/zts/workspaces/default/logs";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const GRAY = "\x1b[90m";

let streamPath: string;
const arg = Deno.args[0];
if (!arg) {
  const entries: string[] = [];
  for await (const e of Deno.readDir(LOGS_DIR)) {
    if (e.isDirectory) entries.push(e.name);
  }
  entries.sort();
  streamPath = `${LOGS_DIR}/${entries[entries.length - 1]}/stream.jsonl`;
} else if (arg.endsWith(".jsonl")) {
  streamPath = arg;
} else {
  streamPath = `${LOGS_DIR}/${arg}/stream.jsonl`;
}

console.error(`${GRAY}Reading: ${streamPath}${RESET}\n`);

const text = await Deno.readTextFile(streamPath);
const lines = text.split("\n").filter(Boolean);

function mid(s: string, max: number): string {
  if (s.length <= max) return s;
  const half = Math.floor((max - 3) / 2);
  return s.slice(0, half) + "..." + s.slice(s.length - half);
}

function sizeStr(s: string): string {
  const lines = s.split("\n").length;
  if (lines > 1) return `${lines} lines`;
  const bytes = new TextEncoder().encode(s).length;
  if (bytes > 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${bytes}B`;
}

let lastTs = "";
let lastWasTool = false;

for (const line of lines) {
  const obj = JSON.parse(line);

  if (obj.timestamp) lastTs = obj.timestamp.slice(11, 19);

  // System init
  if (obj.type === "system" && obj.subtype === "init") {
    console.log(
      `${GRAY}[${lastTs || "start"}] session ${
        obj.session_id?.slice(0, 8)
      } model=${obj.model ?? "?"}${RESET}\n`,
    );
    continue;
  }

  // System other
  if (obj.type === "system") {
    console.log(`  ${GRAY}[system: ${obj.subtype ?? "?"}]${RESET}`);
    continue;
  }

  // Rate limit
  if (obj.type === "rate_limit_event") {
    console.log(`  ${GRAY}[rate limit]${RESET}`);
    continue;
  }

  // Result (end of session)
  if (obj.type === "result") {
    const dur = obj.duration_ms
      ? `${(obj.duration_ms / 1000).toFixed(1)}s`
      : "?";
    const cost = obj.total_cost_usd ? `$${obj.total_cost_usd.toFixed(4)}` : "";
    const err = obj.is_error ? ` ${RED}ERROR${RESET}` : "";
    console.log(
      `\n${GRAY}[${lastTs}] done: ${obj.num_turns} turns, ${dur}${
        cost ? ", " + cost : ""
      }${err}${RESET}`,
    );
    if (obj.errors?.length) {
      for (const e of obj.errors.slice(0, 3)) {
        console.log(`${RED}  ${mid(e, 200)}${RESET}`);
      }
    }
    continue;
  }

  // Assistant messages
  if (obj.type === "assistant" && obj.message?.content) {
    for (const block of obj.message.content) {
      // Prose
      if (block.type === "text" && block.text?.trim()) {
        if (lastWasTool) console.log();
        console.log(`${GRAY}[${lastTs}]${RESET}`);
        console.log(`${BOLD}${YELLOW}${block.text.trim()}${RESET}`);
        console.log();
        lastWasTool = false;
      }

      // Tool use
      if (block.type === "tool_use") {
        const input = block.input ?? {};
        let line = "";

        if (block.name === "Bash" && input.command) {
          line = `${BOLD}${GREEN}$ ${mid(input.command, 200)}${RESET}`;
        } else if (block.name === "Write" && input.file_path) {
          line = `${DIM}${GREEN}write: ${input.file_path}${RESET}`;
        } else if (block.name === "Read" && input.file_path) {
          line = `${DIM}${GREEN}read: ${input.file_path}${RESET}`;
        } else if (block.name === "Edit" && input.file_path) {
          line = `${DIM}${GREEN}edit: ${input.file_path}${RESET}`;
        } else if (block.name === "Grep") {
          const pattern = input.pattern ?? "";
          const path = input.path ?? ".";
          line = `${DIM}${GREEN}grep: /${pattern}/ in ${path}${RESET}`;
        } else if (block.name === "Glob") {
          line = `${DIM}${GREEN}glob: ${input.pattern ?? ""}${RESET}`;
        } else if (block.name === "Agent" || block.name === "Task") {
          const desc = input.description ?? input.prompt?.slice(0, 60) ?? "";
          line = `${BOLD}${CYAN}agent: ${desc}${RESET}`;
        } else {
          line = `${DIM}${GREEN}${block.name}: ${
            mid(JSON.stringify(input), 100)
          }${RESET}`;
        }

        console.log(`  ${line}`);
        lastWasTool = true;
      }

      // Thinking
      if (block.type === "thinking" && block.thinking?.trim()) {
        console.log(
          `  ${GRAY}thinking: ${mid(block.thinking.trim(), 240)}${RESET}`,
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
        const content = typeof block.content === "string" ? block.content : "";
        const isError = block.is_error;
        const color = isError ? RED : GRAY;

        if (!content.trim()) {
          console.log(`  ${color}→ (empty)${RESET}`);
          continue;
        }

        // Summarize based on size
        const lineCount = content.split("\n").length;
        if (lineCount > 10) {
          // Show first 2 lines, summary, last 2 lines
          const contentLines = content.split("\n");
          const first = contentLines.slice(0, 2).map((l) =>
            `  ${color}→ ${mid(l, 120)}${RESET}`
          ).join("\n");
          const last = contentLines.slice(-2).map((l) =>
            `  ${color}→ ${mid(l, 120)}${RESET}`
          ).join("\n");
          console.log(first);
          console.log(
            `  ${color}  ... ${lineCount - 4} more lines (${
              sizeStr(content)
            }) ...${RESET}`,
          );
          console.log(last);
        } else {
          // Short result — show with mid-truncation per line
          for (const l of content.split("\n")) {
            console.log(`  ${color}→ ${mid(l, 120)}${RESET}`);
          }
        }
        continue;
      }

      // Non-tool-result user content (prompt injection, etc.)
      if (block.type === "text" && block.text) {
        console.log(
          `  ${GRAY}[user: ${mid(block.text.trim(), 80)}]${RESET}`,
        );
      }
    }
    continue;
  }

  // Anything else
  console.log(`  ${GRAY}[${obj.type ?? "unknown"}]${RESET}`);
}
