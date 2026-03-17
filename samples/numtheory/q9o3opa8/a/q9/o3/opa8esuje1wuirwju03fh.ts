import { gcd } from "../../29/q3/3z8rqiv6wi7e6wmkfogud.ts";
import { isPrime } from "../../1e/00/ajro7glwpdy5jkv48v09e.ts";
import { primeFactors } from "../../so/vd/y8ip3nf88femvtqcox26n.ts";
import { primeSieve } from "../../ub/kj/73byadgzg99990wmeeo7e.ts";
import { totient } from "../../4t/xt/xmty1c5o1r5x06qerqx74.ts";

export type Cap = {
  console: Pick<Console, "log" | "error">;
  Deno: { args: readonly string[] };
};

export function main(cap: Cap): void {
  const [cmd, ...rest] = [...cap.Deno.args];
  const num = (s: string) => {
    const n = parseInt(s);
    if (isNaN(n)) cap.console.error(`not a number: ${s}`);
    return n;
  };
  switch (cmd) {
    case "gcd": {
      const [a, b] = rest.map(num);
      cap.console.log(`gcd(${a}, ${b}) = ${gcd(a, b)}`);
      break;
    }
    case "prime": {
      const n = num(rest[0]);
      cap.console.log(`isPrime(${n}) = ${isPrime(n)}`);
      break;
    }
    case "factors": {
      const n = num(rest[0]);
      cap.console.log(`primeFactors(${n}) = [${primeFactors(n).join(", ")}]`);
      break;
    }
    case "sieve": {
      const n = num(rest[0]);
      const s = primeSieve(n);
      const primes = [];
      for (let i = 0; i < s.length; i++) if (s[i]) primes.push(i);
      cap.console.log(`primes up to ${n}: ${primes.join(", ")}`);
      break;
    }
    case "totient": {
      const n = num(rest[0]);
      cap.console.log(`φ(${n}) = ${totient(n)}`);
      break;
    }
    default:
      cap.console.error("usage: numtheory <gcd|prime|factors|sieve|totient> [args]");
  }
}