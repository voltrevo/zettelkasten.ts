import { primeFactors } from "../../so/vd/y8ip3nf88femvtqcox26n.ts";

// Euler's totient: φ(n) = n * ∏(1 - 1/p) for distinct primes p | n
export function totient(n: number): number {
  if (n <= 0) return 0;
  if (n === 1) return 1;
  const factors = primeFactors(n);
  let result = n;
  for (const p of factors) {
    result = (result / p) * (p - 1);
  }
  return result;
}