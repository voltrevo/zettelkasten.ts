// Universal entry point — spawned by `zts exec`; also runnable directly:
//   ZTS_EXEC_URL=<atom-url> deno run --allow-all run.ts [args...]
const url = Deno.env.get("ZTS_EXEC_URL");
if (!url) {
  console.error("error: ZTS_EXEC_URL not set");
  Deno.exit(1);
}
const mod = await import(url);
if (typeof mod.main !== "function") {
  console.error("error: atom does not export a 'main' function");
  Deno.exit(1);
}
await mod.main(globalThis);
