import { formatGrid } from "../../2u/ml/mm53qx06p61kmiyk33o39.ts";
import { solve } from "../../3z/zh/sc90nn9ckxnzvm949s119.ts";

export type Cap = {
  console: Pick<Console, "log" | "error">;
  Deno: { args: readonly string[] };
};

export function main(cap: Cap): void {
  const puzzle = cap.Deno.args[0];
  if (!puzzle || puzzle.length !== 81 || !/^[0-9]+$/.test(puzzle)) {
    cap.console.error(
      "Usage: zts exec <hash> <81-digit-string>  (0 = empty cell)",
    );
    return;
  }
  const grid: number[][] = Array.from({ length: 9 }, (_, r) =>
    Array.from({ length: 9 }, (_, c) => parseInt(puzzle[r * 9 + c])),
  );
  if (solve(grid)) {
    cap.console.log(formatGrid(grid));
  } else {
    cap.console.error("No solution found.");
  }
}
