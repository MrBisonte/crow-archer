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

import {
  generateGrid, isArenaBorder, isCrowCorridor, isSpawnZone, type Noise2D,
} from './mapgen';
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
 * How a cavern is shaped: how much rock the first pass throws down, how many
 * smoothing rounds turn that scatter into chambers, and how much of the floor
 * left over then floods or grows.
 *
 * Captured at construction, the same as NoiseTerrain's density, because it
 * identifies the map rather than the call.
 */
interface CavernShape {
  /** Fraction of tiles seeded as rock before any smoothing. */
  readonly fill: number;
  /** Smoothing rounds. Each one is what turns scatter into chambers. */
  readonly smoothing: number;
  /** Fraction of the finished floor that floods into still pools. */
  readonly pools: number;
  /** Fraction that grows a fungus cluster: cover that burns, the way a tree does. */
  readonly fungus: number;
}

/**
 * A cave system, grown by cellular automata rather than thresholded or carved.
 *
 * This is the third answer to "what shape is a map", and it exists for the
 * reason MazeTerrain did: noise scatters tiles that happen to cluster, and no
 * density setting makes it produce a room. Smoothing does — each round pulls
 * a tile towards whatever most of its neighbours already are, so scatter
 * collapses into open chambers joined by short necks, with the ragged walls a
 * cave has and a colonnade does not.
 *
 * Unlike a maze, this is an arena: chambers are wide, sightlines are long
 * enough to shoot down, and MAP_RULES gives it crows and destructible rock on
 * that basis. The maze's argument for taking both away was that a corridor
 * makes a straight-flying bird look like a bug; a chamber does not.
 */
export class CavernTerrain implements MapGenerator {
  readonly #shape: CavernShape;

  constructor(opts: CavernShape) {
    this.#shape = { ...opts, smoothing: Math.max(0, Math.floor(opts.smoothing)) };
  }

  generate(rows: number, cols: number, rng: Rng, noise: Noise2D | null): TileGrid {
    const grid = seedRock(rows, cols, rng, this.#shape.fill);
    for (let round = 0; round < this.#shape.smoothing; round++) smoothCaves(grid, rows, cols);
    frameArena(grid, rows, cols);
    dressFloor(grid, rows, cols, rng, noise, this.#shape);
    joinRegions(grid);
    return grid;
  }
}

/** The first pass: rock scattered at `fill`, everything else open floor. */
function seedRock(rows: number, cols: number, rng: Rng, fill: number): TileGrid {
  const grid: TileGrid = [];
  for (let r = 0; r < rows; r++) {
    const row = new Array<TileId>(cols).fill(TILE.EMPTY);
    grid[r] = row;
    // One draw per tile whatever `fill` is, so the seed decides the map and
    // the threshold decides only what it looks like.
    for (let c = 0; c < cols; c++) if (rng() < fill) row[c] = TILE.ROCK;
  }
  return grid;
}

/**
 * One smoothing round, the 4-5 rule: a tile turns to rock when five or more of
 * the nine tiles in its 3x3 block are rock, and to floor otherwise. Off the
 * grid counts as rock, which is what pulls the cave in from the edges rather
 * than leaving floor hanging off them.
 *
 * The block includes the tile being decided, not just its eight neighbours.
 * Counting only the neighbours makes the rule lossy rather than stable: at a
 * starting fill under half, the average tile has fewer than five rock
 * neighbours, so every round erodes more than it grows and four of them leave
 * an almost empty room. Its own vote is what lets standing rock hold.
 *
 * Reads a copy and writes the original, so a round is one simultaneous step
 * rather than a scan whose later tiles see what its earlier ones just did.
 */
function smoothCaves(grid: TileGrid, rows: number, cols: number): void {
  const before = grid.map((row) => [...row]);
  for (let r = 0; r < rows; r++) {
    const row = grid[r];
    if (!row) continue;
    for (let c = 0; c < cols; c++) {
      let walls = 0;
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          const t = before[r + dr]?.[c + dc];
          if (t === undefined || t === TILE.ROCK) walls++;
        }
      row[c] = walls >= 5 ? TILE.ROCK : TILE.EMPTY;
    }
  }
}

/**
 * Stamps the arena's fixed furniture over a finished cave: a stone rim, the
 * crow corridor, and the spawn block.
 *
 * After the smoothing rather than before, because a round of it would eat
 * straight through all three.
 */
function frameArena(grid: TileGrid, rows: number, cols: number): void {
  for (let r = 0; r < rows; r++) {
    const row = grid[r];
    if (!row) continue;
    for (let c = 0; c < cols; c++) {
      // Rock, not the forest's rock-or-tree rim: the edge of a cave is the
      // stone it was hollowed out of.
      if (isArenaBorder(r, c, rows, cols)) row[c] = TILE.ROCK;
      else if (isSpawnZone(r, c, rows) || isCrowCorridor(c, cols)) row[c] = TILE.EMPTY;
    }
  }
}

/**
 * Floods some of the floor into pools and grows fungus on some of the rest.
 *
 * Both read the injected noise so they cluster the way the forest's water and
 * trees do, and both fall back to flat randomness without it, exactly as
 * `generateGrid` does. A pool only forms where all four orthogonal neighbours
 * were floor too, measured against the floor as it stood before this pass, so
 * water sits in the middle of a chamber instead of as a sliver along a wall
 * that a body cannot tell from shadow.
 *
 * Before `joinRegions` because both tiles stop a body: either can cut a
 * chamber off, and the connectivity pass is what has to see that.
 */
function dressFloor(
  grid: TileGrid,
  rows: number,
  cols: number,
  rng: Rng,
  noise: Noise2D | null,
  shape: CavernShape,
): void {
  const sx = rng() * 200;
  const sy = rng() * 200;
  const n2d = noise
    ? (c: number, r: number, scale: number, ox: number, oy: number) =>
        (noise(c * scale + ox + sx, r * scale + oy + sy) + 1) / 2
    : (): number => rng();
  const poolAt = 1 - shape.pools;
  const fungusAt = 1 - shape.fungus;
  const wasFloor = grid.map((row) => row.map((t) => t === TILE.EMPTY));
  const floor = (r: number, c: number): boolean => wasFloor[r]?.[c] === true;

  for (let r = 0; r < rows; r++) {
    const row = grid[r];
    if (!row) continue;
    for (let c = 0; c < cols; c++) {
      if (row[c] !== TILE.EMPTY) continue;
      // The two guarantees frameArena just made are not this pass's to undo.
      if (isSpawnZone(r, c, rows) || isCrowCorridor(c, cols)) continue;
      // Both drawn every time, never inside the branch: with no noise source
      // these are rng draws, and a skipped draw would make the map depend on
      // which branch ran.
      const nPool = n2d(c, r, 0.12, 0, 0);
      const nFungus = n2d(c, r, 0.2, 61, 29);
      const deep = floor(r - 1, c) && floor(r + 1, c) && floor(r, c - 1) && floor(r, c + 1);
      if (deep && nPool > poolAt) row[c] = TILE.WATER;
      else if (nFungus > fungusAt) row[c] = TILE.TREE;
    }
  }
}

/**
 * Joins every pocket of floor to the largest one, by carving a two-tile-wide
 * elbow between the closest pair of tiles.
 *
 * Cellular automata make no connectivity promise whatsoever — a smoothing
 * round can seal a chamber off completely, and `dressFloor` can cut one off
 * afterwards with a pool. That is survivable on a deathmatch map and fatal on
 * a waves run, where a sealed-off half of the arena is crows the player cannot
 * reach and a win condition that never arrives.
 *
 * Carves rather than fills, so the pass only ever adds floor and whatever it
 * has already joined stays joined. Every pocket reaches for the largest
 * region rather than for the running union, so the result does not depend on
 * the order pockets come out in.
 *
 * Two tiles wide for the reason MazeTerrain's corridor is: a one-tile neck is
 * 32 pixels and a body is about 20, which leaves no room to step around
 * anything coming the other way.
 */
function joinRegions(grid: TileGrid): void {
  const regions = floorRegions(grid);
  if (regions.length < 2) return;
  const main = regions.reduce((big, region) => (region.length > big.length ? region : big));
  for (const pocket of regions) {
    if (pocket === main) continue;
    let best: { from: [number, number]; to: [number, number]; gap: number } | null = null;
    for (const [pr, pc] of pocket) {
      for (const [mr, mc] of main) {
        const gap = (pr - mr) ** 2 + (pc - mc) ** 2;
        if (best === null || gap < best.gap) best = { from: [pr, pc], to: [mr, mc], gap };
      }
    }
    if (best !== null) carveElbow(grid, best.from, best.to);
  }
}

/** Every connected pocket of tiles a body could stand on, in scan order. */
function floorRegions(grid: TileGrid): [number, number][][] {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const seen: boolean[][] = [];
  for (let r = 0; r < rows; r++) seen[r] = new Array<boolean>(cols).fill(false);

  const regions: [number, number][][] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (seen[r]![c] || !tilePassable(grid[r]?.[c])) continue;
      const region: [number, number][] = [];
      const stack: [number, number][] = [[r, c]];
      seen[r]![c] = true;
      while (stack.length > 0) {
        const [cr, cc] = stack.pop()!;
        region.push([cr, cc]);
        for (const [dr, dc] of STEPS) {
          const nr = cr + dr;
          const nc = cc + dc;
          if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
          if (seen[nr]![nc] || !tilePassable(grid[nr]?.[nc])) continue;
          seen[nr]![nc] = true;
          stack.push([nr, nc]);
        }
      }
      regions.push(region);
    }
  }
  return regions;
}

/**
 * Opens a two-tile-wide path from one tile to another: along the row first,
 * then down the column, widening across whichever way the run is going.
 *
 * The rim is never opened, so a tunnel cannot break the arena's edge and let a
 * body walk off the grid. Only the widening is ever clipped by that: both
 * endpoints are floor, so neither they nor the straight run between them is
 * ever on the border in the first place.
 */
function carveElbow(grid: TileGrid, from: [number, number], to: [number, number]): void {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const [r0, c0] = from;
  const [r1, c1] = to;
  const towards = (a: number, b: number): number => (a < b ? 1 : -1);

  const cStep = towards(c0, c1);
  for (let c = c0; c !== c1 + cStep; c += cStep) {
    openInterior(grid, rows, cols, r0, c);
    openInterior(grid, rows, cols, r0 + 1, c);
  }
  const rStep = towards(r0, r1);
  for (let r = r0; r !== r1 + rStep; r += rStep) {
    openInterior(grid, rows, cols, r, c1);
    openInterior(grid, rows, cols, r, c1 + 1);
  }
}

/** Opens one tile, unless it is off the grid or part of the arena's rim. */
function openInterior(grid: TileGrid, rows: number, cols: number, r: number, c: number): void {
  if (r < 0 || r >= rows || c < 0 || c >= cols) return;
  if (isArenaBorder(r, c, rows, cols)) return;
  open(grid, r, c);
}

/**
 * Is every walkable tile reachable from every other?
 *
 * Exported for tests rather than asserted inside `generate`. `carve` makes
 * connectivity true by construction, `braid` only removes wall, and
 * `joinRegions` restores it for a cavern, so a failure here is a bug in this
 * file rather than a condition the game should try to handle at runtime. A
 * flood fill over 33x21 is cheap enough to run across hundreds of seeds in a
 * test.
 *
 * One region means connected; none means there was nothing to connect, which
 * is vacuously true and is what a fully solid grid gives.
 */
export function openTilesConnected(grid: TileGrid): boolean {
  return floorRegions(grid).length <= 1;
}
