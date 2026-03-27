#!/usr/bin/env -S deno run --allow-read
// Usage: docker exec zts-agent /home/zts/agent-prose.ts [iter-NNNN]
// Shows prose from the latest (or specified) iteration.

const LOGS_DIR = "/home/zts/workspaces/default/logs";

let iterDir: string;
if (Deno.args[0]) {
  iterDir = `${LOGS_DIR}/${Deno.args[0]}`;
} else {
  const entries: string[] = [];
  for await (const e of Deno.readDir(LOGS_DIR)) {
    if (e.isDirectory) entries.push(e.name);
  }
  entries.sort();
  iterDir = `${LOGS_DIR}/${entries[entries.length - 1]}`;
}

const streamPath = `${iterDir}/stream.jsonl`;
console.error(`Reading: ${streamPath}\n`);

const text = await Deno.readTextFile(streamPath);
const lines = text.split("\n").filter(Boolean);

function fmtDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

let lastTs = "";
let gapStartTs = "";
let nonProseCount = 0;

for (const line of lines) {
  const obj = JSON.parse(line);

  if (obj.timestamp) {
    lastTs = obj.timestamp.slice(11, 19);
    if (!gapStartTs && nonProseCount > 0) gapStartTs = lastTs;
  }

  if (obj.type === "assistant") {
    const content = obj.message?.content;
    if (!Array.isArray(content)) {
      nonProseCount++;
      continue;
    }
    let hadProse = false;
    for (const block of content) {
      if (block.type === "text" && block.text?.trim()) {
        if (nonProseCount > 0) {
          let gap = "";
          if (gapStartTs && lastTs) {
            const [h1, m1, s1] = gapStartTs.split(":").map(Number);
            const [h2, m2, s2] = lastTs.split(":").map(Number);
            const sec = (h2 * 3600 + m2 * 60 + s2) - (h1 * 3600 + m1 * 60 + s1);
            gap = ` (${fmtDuration(Math.max(0, sec))})`;
          }
          console.log(`  ... ${nonProseCount} other events${gap} ...\n`);
          nonProseCount = 0;
          gapStartTs = "";
        }
        console.log(`[${lastTs || "??:??:??"}]`);
        console.log(block.text.trim());
        console.log();
        hadProse = true;
      }
    }
    if (hadProse) continue;
  }

  if (nonProseCount === 0) gapStartTs = lastTs;
  nonProseCount++;
}

if (nonProseCount > 0) {
  let gap = "";
  if (gapStartTs && lastTs) {
    const [h1, m1, s1] = gapStartTs.split(":").map(Number);
    const [h2, m2, s2] = lastTs.split(":").map(Number);
    const sec = (h2 * 3600 + m2 * 60 + s2) - (h1 * 3600 + m1 * 60 + s1);
    gap = ` (${fmtDuration(Math.max(0, sec))})`;
  }
  console.log(`  ... ${nonProseCount} other events${gap} ...`);
}
