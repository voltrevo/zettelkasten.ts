import { isPrime } from "../../1e/00/ajro7glwpdy5jkv48v09e.ts";

export type Cap = {
  console: Pick<Console, "log" | "error">;
  Deno: { args: readonly string[] };
};

export function main(cap: Cap): void {
  const n = parseInt(cap.Deno.args[0] ?? "");
  if (isNaN(n) || n < 4 || n % 2 !== 0) {
    cap.console.error("Usage: zts exec <hash> <even number >= 4>");
    return;
  }
  for (let p = 2; p <= n / 2; p++) {
    if (isPrime(p) && isPrime(n - p)) {
      cap.console.log(`${n} = ${p} + ${n - p}`);
      return;
    }
  }
  cap.console.error(`No Goldbach pair found for ${n}`);
}
