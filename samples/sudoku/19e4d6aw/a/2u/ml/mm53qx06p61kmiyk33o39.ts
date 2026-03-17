export function formatGrid(grid: number[][]): string {
  const sep = "------+-------+------";
  return grid
    .map((row, r) => {
      const line = [0, 3, 6]
        .map((bc) => row.slice(bc, bc + 3).join(" "))
        .join(" | ");
      return r > 0 && r % 3 === 0 ? sep + "\n" + line : line;
    })
    .join("\n");
}
