/**
 * How each map builds its grid.
 *
 * Maps used to differ by one number, a noise density, so `MAP_GEN` held that
 * number and `generateGrid` did the work. A maze is not the noise algorithm at
 * any density: noise scatters tiles that happen to cluster, a maze carves
 * corridors that are guaranteed to connect. So the row stopped being a config
 * value and became the generator itself.
 *
 * Adding a map is a new implementation here plus one row in `MAP_GEN`. Nothing
 * in this file branches on which map is being built.
 *
 * See docs/level-3-maze.md for the alternatives that were rejected.
 */

import { generateGrid, type Noise2D } from './mapgen';
import type { Rng } from './rng';
import { TILE, tilePassable, type TileGrid, type TileId } from './tilemap';

/**
 * Builds one map's grid.
 *
 * `noise` is offered to every generator and ignored by the ones that do not
 * want it, rather than being threaded conditionally by the caller: the caller
 * does not know which generators are noise-based and should not have to.
 */
export interface MapGenerator {
  generate(rows: number, cols: number, rng: Rng, noise: Noise2D | null): TileGrid;
}

/**
 * The original terrain: three independent noise layers thresholded into water,
 * rock and forest, with a walled border, a clear spawn zone and a crow
 * corridor down the right.
 *
 * Density is captured at construction because it identifies the map, not the
 * call. Forest and castle are this generator at two settings.
 */
export class NoiseTerrain implements MapGenerator {
  readonly #density: number;

  constructor(opts: { density: number }) {
    this.#density = opts.density;
  }

  generate(rows: number, cols: number, rng: Rng, noise: Noise2D | null): TileGrid {
    return generateGrid(rows, cols, rng, noise, this.#density);
  }
}

/**
 * A braided maze carved by recursive backtracking.
 *
 * Cells sit on odd indices with one-tile walls between them, so a 33x21 grid
 * is a 16x10 maze and the outer border falls out solid without being special
 * cased. Even-indexed rows and columns are wall until something carves them.
 */
export class MazeTerrain implements MapGenerator {
  readonly #braid: number;

  /**
   * `braid` is the fraction of dead ends to open back up, 0 for a perfect
   * maze and 1 for none left. A perfect maze plays badly here: every wrong
   * turn is a dead end and a character with an 80 pixel sightline spends the
   * level walking back the way it came. Loops give flanking and escape.
   */
  constructor(opts: { braid: number }) {
    this.#braid = Math.max(0, Math.min(1, opts.braid));
  }

  /** Noise is unused: a maze is carved, not thresholded. */
  generate(rows: number, cols: number, rng: Rng, _noise: Noise2D | null): TileGrid {
    const grid: TileGrid = [];
    for (let r = 0; r < rows; r++) grid[r] = new Array<TileId>(cols).fill(TILE.ROCK);

    const cellRows = Math.floor((rows - 1) / 2);
    const cellCols = Math.floor((cols - 1) / 2);
    if (cellRows < 1 || cellCols < 1) return grid;

    carve(grid, cellRows, cellCols, rng);
    braid(grid, cellRows, cellCols, rng, this.#braid);
    return grid;
  }
}

/** Tile coordinates of cell (cr, cc). Cells live on odd indices. */
const cellRow = (cr: number): number => cr * 2 + 1;
const cellCol = (cc: number): number => cc * 2 + 1;

/** The four cell-space steps, as [dRow, dCol]. */
const STEPS: readonly (readonly [number, number])[] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

/**
 * Recursive backtracker, iterative so a large grid cannot blow the stack.
 *
 * Every cell is visited exactly once and is entered by carving the wall
 * between it and an already-visited cell, so every open tile is reachable from
 * every other by construction. That is the connectivity guarantee a maze needs
 * and noise never did.
 */
function carve(grid: TileGrid, cellRows: number, cellCols: number, rng: Rng): void {
  const seen: boolean[][] = [];
  for (let r = 0; r < cellRows; r++) seen[r] = new Array<boolean>(cellCols).fill(false);

  const startR = Math.floor(rng() * cellRows);
  const startC = Math.floor(rng() * cellCols);
  const stack: [number, number][] = [[startR, startC]];
  seen[startR]![startC] = true;
  open(grid, cellRow(startR), cellCol(startC));

  while (stack.length > 0) {
    const [cr, cc] = stack[stack.length - 1]!;
    const options: [number, number][] = [];
    for (const [dr, dc] of STEPS) {
      const nr = cr + dr;
      const nc = cc + dc;
      if (nr < 0 || nr >= cellRows || nc < 0 || nc >= cellCols) continue;
      if (seen[nr]![nc]) continue;
      options.push([nr, nc]);
    }
    if (options.length === 0) {
      stack.pop();
      continue;
    }
    const [nr, nc] = options[Math.floor(rng() * options.length)]!;
    seen[nr]![nc] = true;
    // The wall between two cells is the tile midway between their centres.
    open(grid, (cellRow(cr) + cellRow(nr)) / 2, (cellCol(cc) + cellCol(nc)) / 2);
    open(grid, cellRow(nr), cellCol(nc));
    stack.push([nr, nc]);
  }
}

/**
 * Opens one wall on a fraction of dead ends, turning a perfect maze into a
 * looping one.
 *
 * Only ever removes wall, never adds it, so the connectivity `carve`
 * guarantees survives this pass untouched.
 */
function braid(
  grid: TileGrid,
  cellRows: number,
  cellCols: number,
  rng: Rng,
  fraction: number,
): void {
  if (fraction <= 0) return;

  const deadEnds: [number, number][] = [];
  for (let cr = 0; cr < cellRows; cr++) {
    for (let cc = 0; cc < cellCols; cc++) {
      if (exitsFrom(grid, cr, cc, cellRows, cellCols).open.length === 1) deadEnds.push([cr, cc]);
    }
  }

  for (const [cr, cc] of deadEnds) {
    if (rng() >= fraction) continue;
    const { closed } = exitsFrom(grid, cr, cc, cellRows, cellCols);
    if (closed.length === 0) continue;
    const [wr, wc] = closed[Math.floor(rng() * closed.length)]!;
    open(grid, wr, wc);
  }
}

/**
 * Which of a cell's four walls are open and which are still solid, as wall
 * tile coordinates. Walls outside the grid are neither: the border stays.
 */
function exitsFrom(
  grid: TileGrid,
  cr: number,
  cc: number,
  cellRows: number,
  cellCols: number,
): { open: [number, number][]; closed: [number, number][] } {
  const open: [number, number][] = [];
  const closed: [number, number][] = [];
  for (const [dr, dc] of STEPS) {
    const nr = cr + dr;
    const nc = cc + dc;
    if (nr < 0 || nr >= cellRows || nc < 0 || nc >= cellCols) continue;
    const wr = (cellRow(cr) + cellRow(nr)) / 2;
    const wc = (cellCol(cc) + cellCol(nc)) / 2;
    if (tilePassable(grid[wr]?.[wc])) open.push([wr, wc]);
    else closed.push([wr, wc]);
  }
  return { open, closed };
}

const open = (grid: TileGrid, r: number, c: number): void => {
  const row = grid[r];
  if (row) row[c] = TILE.EMPTY;
};

/**
 * Is every walkable tile reachable from every other?
 *
 * Exported for tests rather than asserted inside `generate`. `carve` makes
 * connectivity true by construction and `braid` only removes wall, so a
 * failure here is a bug in this file, not a condition the game should try to
 * handle at runtime. A flood fill over 33x21 is cheap enough to run across
 * hundreds of seeds in a test.
 */
export function openTilesConnected(grid: TileGrid): boolean {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  let total = 0;
  let start: [number, number] | null = null;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!tilePassable(grid[r]?.[c])) continue;
      total++;
      start ??= [r, c];
    }
  }
  if (start === null) return true;

  const seen: boolean[][] = [];
  for (let r = 0; r < rows; r++) seen[r] = new Array<boolean>(cols).fill(false);
  const stack: [number, number][] = [start];
  seen[start[0]]![start[1]] = true;
  let found = 0;
  while (stack.length > 0) {
    const [r, c] = stack.pop()!;
    found++;
    for (const [dr, dc] of STEPS) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      if (seen[nr]![nc]) continue;
      if (!tilePassable(grid[nr]?.[nc])) continue;
      seen[nr]![nc] = true;
      stack.push([nr, nc]);
    }
  }
  return found === total;
}
