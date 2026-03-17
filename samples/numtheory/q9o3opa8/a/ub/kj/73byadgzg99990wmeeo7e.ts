// Sieve of Eratosthenes: returns boolean[] where result[i] is true if i is prime.
export function primeSieve(limit: number): boolean[] {
  const sieve = new Array<boolean>(limit + 1).fill(true);
  sieve[0] = false;
  if (limit >= 1) sieve[1] = false;
  for (let i = 2; i * i <= limit; i++) {
    if (sieve[i]) {
      for (let j = i * i; j <= limit; j += i) {
        sieve[j] = false;
      }
    }
  }
  return sieve;
}
