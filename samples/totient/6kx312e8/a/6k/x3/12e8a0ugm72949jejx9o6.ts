import { gcd } from "../../29/q3/3z8rqiv6wi7e6wmkfogud.ts";
import { isPrime } from "../../1e/00/ajro7glwpdy5jkv48v09e.ts";

export type Cap = {
  console: Pick<Console, "log" | "error">;
  Deno: { args: readonly string[] };
};

export function main(cap: Cap): void {
  const n = parseInt(cap.Deno.args[0] ?? "");
  if (isNaN(n) || n < 1) {
    cap.console.error("Usage: zts exec <hash> <positive integer>");
    return;
  }
  if (n === 1) {
    cap.console.log("φ(1) = 1");
    return;
  }
  // Euler's product formula: φ(n) = n * ∏(1 - 1/p) for each prime p | n
  let result = n;
  let temp = n;
  for (let p = 2; p <= temp; p++) {
    if (isPrime(p) && temp % p === 0) {
      result = result / p * (p - 1);
      while (temp % p === 0) temp = Math.floor(temp / p);
    }
  }
  cap.console.log(`φ(${n}) = ${result}`);
}
