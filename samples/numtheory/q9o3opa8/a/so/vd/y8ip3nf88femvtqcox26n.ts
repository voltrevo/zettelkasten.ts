import { isPrime } from "../../1e/00/ajro7glwpdy5jkv48v09e.ts";

// Returns distinct prime factors of n in ascending order.
export function primeFactors(n: number): number[] {
  if (n < 2) return [];
  const factors: number[] = [];
  for (let p = 2; p <= n; p++) {
    if (isPrime(p) && n % p === 0) {
      factors.push(p);
      while (n % p === 0) n = Math.floor(n / p);
    }
  }
  return factors;
}