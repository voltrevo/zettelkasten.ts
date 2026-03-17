export function getCandidates(
  grid: number[][],
  row: number,
  col: number,
): number[] {
  const used = new Set<number>();
  for (let c = 0; c < 9; c++) used.add(grid[row][c]);
  for (let r = 0; r < 9; r++) used.add(grid[r][col]);
  const br = Math.floor(row / 3) * 3;
  const bc = Math.floor(col / 3) * 3;
  for (let r = br; r < br + 3; r++)
    for (let c = bc; c < bc + 3; c++) used.add(grid[r][c]);
  return [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((n) => !used.has(n));
}
