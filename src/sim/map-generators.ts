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
 * How a maze's tiles are laid out: how wide a corridor is and how thick the
 * wall between two corridors is, both in tiles.
 *
 * A one-tile corridor is 32 pixels and a body is about 20, which leaves no
 * room to step around anything. That is survivable against enemies you can
 * kill and unplayable against one you cannot, so corridor width is a
 * parameter rather than the algorithm's fixed assumption.
 */
interface MazeLayout {
  /** Cells and the passages between them are this many tiles across. */
  readonly corridor: number;
  /** Tiles of solid wall between two parallel corridors. */
  readonly wall: number;
}

/** Where cell `i` starts, in tiles, along either axis. */
const cellStart = (i: number, lay: MazeLayout, offset: number): number =>
  offset + lay.wall + i * (lay.corridor + lay.wall);

/** How many cells fit along an axis of `size` tiles, and the centring offset. */
function fit(size: number, lay: MazeLayout): { count: number; offset: number } {
  const pitch = lay.corridor + lay.wall;
  const count = Math.floor((size - lay.wall) / pitch);
  if (count < 1) return { count: 0, offset: 0 };
  // Whatever is left over is split between the two borders, so a maze that
  // does not divide evenly reads as centred rather than shoved into a corner.
  return { count, offset: Math.floor((size - (count * pitch + lay.wall)) / 2) };
}

/**
 * A braided maze carved by recursive backtracking.
 *
 * Cells sit on a fixed pitch with walls between them, so the outer border
 * falls out solid without being special cased. At the default two-tile
 * corridor a 33x21 grid holds a 10x6 maze.
 */
export class MazeTerrain implements MapGenerator {
  readonly #braid: number;
  readonly #layout: MazeLayout;

  /**
   * `braid` is the fraction of dead ends to open back up, 0 for a perfect
   * maze and 1 for none left. A perfect maze plays badly here: every wrong
   * turn is a dead end and a character with an 80 pixel sightline spends the
   * level walking back the way it came. Loops give flanking and escape.
   */
  constructor(opts: { braid: number; corridor?: number; wall?: number }) {
    this.#braid = Math.max(0, Math.min(1, opts.braid));
    this.#layout = {
      corridor: Math.max(1, Math.floor(opts.corridor ?? 2)),
      wall: Math.max(1, Math.floor(opts.wall ?? 1)),
    };
  }

  /** Noise is unused: a maze is carved, not thresholded. */
  generate(rows: number, cols: number, rng: Rng, _noise: Noise2D | null): TileGrid {
    const grid: TileGrid = [];
    for (let r = 0; r < rows; r++) grid[r] = new Array<TileId>(cols).fill(TILE.ROCK);

    const down = fit(rows, this.#layout);
    const across = fit(cols, this.#layout);
    if (down.count < 1 || across.count < 1) return grid;

    const plan: MazePlan = {
      lay: this.#layout,
      cellRows: down.count,
      cellCols: across.count,
      rowOffset: down.offset,
      colOffset: across.offset,
    };
    carve(grid, plan, rng);
    braid(grid, plan, rng, this.#braid);
    return grid;
  }
}

/** Everything the carving passes need to turn cell coordinates into tiles. */
interface MazePlan {
  readonly lay: MazeLayout;
  readonly cellRows: number;
  readonly cellCols: number;
  readonly rowOffset: number;
  readonly colOffset: number;
}

/** Opens the full corridor-wide block a cell occupies. */
function openCell(grid: TileGrid, p: MazePlan, cr: number, cc: number): void {
  const r0 = cellStart(cr, p.lay, p.rowOffset);
  const c0 = cellStart(cc, p.lay, p.colOffset);
  for (let r = r0; r < r0 + p.lay.corridor; r++)
    for (let c = c0; c < c0 + p.lay.corridor; c++) open(grid, r, c);
}

/**
 * Opens the passage between two adjacent cells: the wall band between them,
 * the full width of a corridor.
 */
function openPassage(
  grid: TileGrid,
  p: MazePlan,
  cr: number,
  cc: number,
  nr: number,
  nc: number,
): void {
  for (const [r, c] of passageTiles(p, cr, cc, nr, nc)) open(grid, r, c);
}

/** Every tile of the wall band between two adjacent cells. */
function passageTiles(
  p: MazePlan,
  cr: number,
  cc: number,
  nr: number,
  nc: number,
): [number, number][] {
  const { corridor, wall } = p.lay;
  const r0 = cellStart(Math.min(cr, nr), p.lay, p.rowOffset);
  const c0 = cellStart(Math.min(cc, nc), p.lay, p.colOffset);
  const tiles: [number, number][] = [];
  if (cr === nr) {
    // Horizontal neighbours: the band sits after the left cell's corridor.
    for (let r = r0; r < r0 + corridor; r++)
      for (let c = c0 + corridor; c < c0 + corridor + wall; c++) tiles.push([r, c]);
  } else {
    for (let r = r0 + corridor; r < r0 + corridor + wall; r++)
      for (let c = c0; c < c0 + corridor; c++) tiles.push([r, c]);
  }
  return tiles;
}

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
function carve(grid: TileGrid, p: MazePlan, rng: Rng): void {
  const seen: boolean[][] = [];
  for (let r = 0; r < p.cellRows; r++) seen[r] = new Array<boolean>(p.cellCols).fill(false);

  const startR = Math.floor(rng() * p.cellRows);
  const startC = Math.floor(rng() * p.cellCols);
  const stack: [number, number][] = [[startR, startC]];
  seen[startR]![startC] = true;
  openCell(grid, p, startR, startC);

  while (stack.length > 0) {
    const [cr, cc] = stack[stack.length - 1]!;
    const options: [number, number][] = [];
    for (const [dr, dc] of STEPS) {
      const nr = cr + dr;
      const nc = cc + dc;
      if (nr < 0 || nr >= p.cellRows || nc < 0 || nc >= p.cellCols) continue;
      if (seen[nr]![nc]) continue;
      options.push([nr, nc]);
    }
    if (options.length === 0) {
      stack.pop();
      continue;
    }
    const [nr, nc] = options[Math.floor(rng() * options.length)]!;
    seen[nr]![nc] = true;
    openPassage(grid, p, cr, cc, nr, nc);
    openCell(grid, p, nr, nc);
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
function braid(grid: TileGrid, p: MazePlan, rng: Rng, fraction: number): void {
  if (fraction <= 0) return;

  const deadEnds: [number, number][] = [];
  for (let cr = 0; cr < p.cellRows; cr++) {
    for (let cc = 0; cc < p.cellCols; cc++) {
      if (exitsFrom(grid, p, cr, cc).open.length === 1) deadEnds.push([cr, cc]);
    }
  }

  for (const [cr, cc] of deadEnds) {
    if (rng() >= fraction) continue;
    const { closed } = exitsFrom(grid, p, cr, cc);
    if (closed.length === 0) continue;
    const [nr, nc] = closed[Math.floor(rng() * closed.length)]!;
    openPassage(grid, p, cr, cc, nr, nc);
  }
}

/**
 * Which of a cell's four neighbours it can already reach and which are still
 * walled off. Neighbours outside the grid are neither: the border stays.
 *
 * A passage counts as open when its whole band is open, so a half-carved
 * passage, which nothing produces, would read as closed rather than as a
 * corridor a body cannot fit down.
 */
function exitsFrom(
  grid: TileGrid,
  p: MazePlan,
  cr: number,
  cc: number,
): { open: [number, number][]; closed: [number, number][] } {
  const open: [number, number][] = [];
  const closed: [number, number][] = [];
  for (const [dr, dc] of STEPS) {
    const nr = cr + dr;
    const nc = cc + dc;
    if (nr < 0 || nr >= p.cellRows || nc < 0 || nc >= p.cellCols) continue;
    const band = passageTiles(p, cr, cc, nr, nc);
    const clear = band.every(([r, c]) => tilePassable(grid[r]?.[c]));
    (clear ? open : closed).push([nr, nc]);
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
