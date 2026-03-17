import { gcd } from "../../29/q3/3z8rqiv6wi7e6wmkfogud.ts";

export type Cap = {
  console: Pick<Console, "log" | "error">;
  Deno: { args: readonly string[] };
};

export function main(cap: Cap): void {
  const input = cap.Deno.args[0];
  if (!input || !/^\d+\/\d+$/.test(input)) {
    cap.console.error("Usage: zts exec <hash> <a/b>");
    return;
  }
  const [a, b] = input.split("/").map(Number);
  if (b === 0) {
    cap.console.error("error: denominator cannot be zero");
    return;
  }
  const g = gcd(a, b);
  cap.console.log(`${a / g}/${b / g}`);
}
