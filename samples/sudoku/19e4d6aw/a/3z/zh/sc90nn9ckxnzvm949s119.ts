import { findEmpty } from "../../d3/fn/fs9syx5cofpdhry0b0e36.ts";
import { getCandidates } from "../../17/xa/t2f30gy5bdceo4mr98wyw.ts";

export function solve(grid: number[][]): boolean {
  const cell = findEmpty(grid);
  if (!cell) return true;
  const [r, c] = cell;
  for (const n of getCandidates(grid, r, c)) {
    grid[r][c] = n;
    if (solve(grid)) return true;
    grid[r][c] = 0;
  }
  return false;
}
