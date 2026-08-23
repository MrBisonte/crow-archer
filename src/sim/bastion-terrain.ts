/**
 * The bastion: a siege ground.
 *
 * The other generators each answer "what shape is a map" — noise scatters,
 * a maze carves, a cavern grows. This one answers a different question, which
 * is what the map has to *promise*. Ten waves come down the corridor on the
 * right at two towers held by a hero and a retinue of guards, so the layout is
 * a fortification, and a fortification is placed rather than rolled: the
 * renderer draws the towers, the guard placement stands bodies beside them and
 * the siege walks at them, and all three have to be talking about the same two
 * tiles. So the towers and the barrier are deterministic functions of the grid
 * size and are exported as such, and the only thing the seed decides is the
 * cover scattered over the ground between them.
 *
 * That split is the whole design. A generator that rolled the towers would
 * force every consumer to re-run generation, or to scan the finished grid for
 * HUT tiles and hope it found the right ones, which is a search standing in
 * for an answer the map already knew.
 *
 * No water anywhere, deliberately. A siege ground with a pond in it is a
 * different picture, and TILE.WATER stops a body: a pool dropped across a flank
 * lane would narrow or close one of the two ways round the barrier, which is
 * the one thing this map may never do. It buys nothing a rock does not.
 */

import type { MapGenerator } from './map-generators';
import { isArenaBorder, isCrowCorridor, isSpawnZone, type Noise2D } from './mapgen';
import type { Rng } from './rng';
import { TILE, type TileGrid, type TileId } from './tilemap';

/**
 * How the bastion is dressed.
 *
 * One number, because one number is all that is left once the fortification is
 * fixed. Captured at construction the same way NoiseTerrain's density and
 * CavernTerrain's shape are: it identifies the map rather than the call.
 */
export interface BastionShape {
  /** Fraction of open middle ground that gets scatter cover. Keep it low. */
  readonly scatter: number;
}

/** Where the two towers stand, in grid coordinates. */
export interface TowerSite {
  readonly row: number;
  readonly col: number;
}

/**
 * The column the towers stand in.
 *
 * The spawn block runs from column 1 to column 4, and the towers belong to the
 * defence, so they sit in that band rather than out on the field. Column 3 is
 * the outer of the two the brief allows, which leaves column 2 free as a
 * walkway behind them — see SPINE_COL, which is what actually makes them
 * reachable.
 */
const TOWER_COL = 3;

/**
 * The walkway behind the towers: one column, kept clear of scatter for its
 * whole height.
 *
 * Not decoration. Every tower's west neighbour is on this column, and the
 * column meets both flank lanes, so "can the siege reach a tower" reduces to
 * "is the skeleton intact" and never to a probability. The alternative was to
 * scatter freely and repair afterwards with a connectivity pass, the way
 * CavernTerrain's joinRegions does. Rejected: a repair pass has to carve, and
 * carving through a barrier that exists to be walked around is how a siege map
 * quietly stops being one.
 */
const SPINE_COL = TOWER_COL - 1;

/**
 * How far above and below the centre line the towers stand.
 *
 * Strictly greater than 3 at every size, because isSpawnZone clears everything
 * within 3 rows of centre in these columns and a tower inside that block would
 * be erased by the pass that keeps a fresh spawn out of terrain. A quarter of
 * the grid puts them at rows 5 and 15 of 21 — ten rows apart, far enough to
 * read as two towers rather than one thick one, with the spawn block between
 * them where the hero starts.
 */
const towerSpread = (rows: number): number => Math.max(4, Math.floor(rows / 4));

/**
 * Deterministic tower positions for a grid of this size. Exported so the
 * renderer and the guard placement find the same two tiles the generator used.
 *
 * Always returns two sites, even on a grid with no room for a tower, because a
 * caller asking where the towers are cannot do anything useful with "maybe
 * none". On a grid that small the generator declines to stamp them and the
 * sites describe an intent nothing acted on; `towerFits` below is the single
 * place that decides, so the generator and this function cannot disagree about
 * a site that did get built.
 */
export function towerSites(rows: number, cols: number): readonly [TowerSite, TowerSite] {
  const mid = Math.floor(rows / 2);
  const spread = towerSpread(rows);
  const col = Math.max(1, Math.min(TOWER_COL, cols - 2));
  const onGrid = (r: number): number => Math.max(1, Math.min(r, Math.max(1, rows - 2)));
  return [
    { row: onGrid(mid - spread), col },
    { row: onGrid(mid + spread), col },
  ];
}

/** Is there room to stand a tower here, or is this grid too small to hold one? */
const towerFits = (site: TowerSite, rows: number, cols: number): boolean =>
  site.row > 0 &&
  site.row < rows - 1 &&
  !isArenaBorder(site.row, site.col, rows, cols) &&
  !isCrowCorridor(site.col, cols) &&
  !isSpawnZone(site.row, site.col, rows);

/**
 * The two columns the barrier stands in.
 *
 * A quarter of the way across, which on the shipped 33 columns is 8 and 9:
 * close enough to the towers to be their cover and not a second arena wall,
 * far enough that the defence has a yard to fall back into. Everything from
 * there to the corridor is the open middle ground the fight happens on.
 *
 * Always at least two columns right of the towers, at every grid size, so the
 * promise this map makes — cover *between* the towers and the corridor — holds
 * even where the barrier turns out not to fit. On a grid that narrow the pair
 * lands on or past the corridor, `barrierFits` says no, and nothing is built.
 */
export function barrierCols(cols: number): readonly [number, number] {
  const first = Math.max(TOWER_COL + 2, Math.min(Math.floor(cols / 4), cols - 4));
  return [first, first + 1];
}

/**
 * Is there room for the barrier: two courses, with open ground still left
 * between them and the corridor mouth?
 *
 * The spare column matters. A barrier flush against the corridor would have the
 * siege arriving already in contact with it, which is a wall to be broken
 * rather than cover to be walked around.
 */
const barrierFits = (cols: number): boolean => barrierCols(cols)[1] <= cols - 4;

/**
 * How many rows of open ground the barrier leaves at each end.
 *
 * This is the difference between cover and a wall. The barrier is there to be
 * gone around, so both flanks stay open: at 21 rows this is 3, leaving rows
 * 1-3 and 17-19 clear and the barrier standing across rows 4-16. Three tiles
 * is wide enough that a body — about 20 px in a 32 px tile — can go round
 * without threading a needle, the same argument that made MazeTerrain's
 * corridor two tiles rather than one.
 */
const barrierGap = (rows: number): number => Math.max(2, Math.floor(rows / 7));

/** The rows the barrier occupies: everything between the two flank gaps. */
const barrierRows = (rows: number): { first: number; last: number } => {
  const gap = barrierGap(rows);
  return { first: gap + 1, last: rows - 2 - gap };
};

/**
 * The two rows kept clear from wall to corridor: one through each flank gap.
 *
 * Mirrored about the centre line so neither flank is the better one, and
 * always inside its gap — `barrierGap` is at least 2 and the lane is at most
 * half of it, so a lane can never land on a barrier row.
 */
const laneRows = (rows: number): readonly [number, number] => {
  const top = Math.max(1, Math.floor((barrierGap(rows) + 1) / 2));
  return [top, rows - 1 - top];
};

/**
 * A siege ground, with fixed fortification and scattered cover.
 *
 * The build order is furniture first, frame second, dressing last, which is
 * CavernTerrain's order and for the same reason: the arena's three guarantees
 * are stamped over whatever was already there, and the pass that scatters
 * cover has to run after them so it can see what it is not allowed to touch.
 */
export class BastionTerrain implements MapGenerator {
  readonly #shape: BastionShape;

  constructor(opts: BastionShape) {
    this.#shape = opts;
  }

  generate(rows: number, cols: number, rng: Rng, noise: Noise2D | null): TileGrid {
    const grid: TileGrid = [];
    for (let r = 0; r < rows; r++) grid[r] = new Array<TileId>(cols).fill(TILE.EMPTY);

    frameArena(grid, rows, cols);
    raiseBarrier(grid, rows, cols);
    raiseTowers(grid, rows, cols);
    scatterCover(grid, rows, cols, rng, noise, this.#shape.scatter);
    return grid;
  }
}

/**
 * Stamps the arena's fixed furniture: a stone rim, the crow corridor and the
 * spawn block.
 *
 * Stone rather than the forest's rock-or-tree rim, for the reason a cavern's
 * is stone: this is a walled ground, and a wooden stretch of its wall would
 * read as a gate that is not one. Deliberately rng-free, so the border costs no
 * draws and a seed decides only the scatter.
 *
 * The same six lines live inside map-generators.ts as CavernTerrain's private
 * `frameArena`. When this generator moves in beside it, that is the pair to
 * extract; duplicating it here beats exporting a second copy of the predicates
 * it is built from.
 */
function frameArena(grid: TileGrid, rows: number, cols: number): void {
  for (let r = 0; r < rows; r++) {
    const row = grid[r];
    if (!row) continue;
    for (let c = 0; c < cols; c++) {
      if (isArenaBorder(r, c, rows, cols)) row[c] = TILE.ROCK;
      else if (isSpawnZone(r, c, rows) || isCrowCorridor(c, cols)) row[c] = TILE.EMPTY;
    }
  }
}

/**
 * Raises the barrier: two courses of rock across the middle of the map, open at
 * both ends.
 *
 * Two columns rather than one because a single course reads as a fence at 32 px
 * a tile, and because cover a body can stand *inside* is what lets the defence
 * hold a line rather than just stand behind one.
 */
function raiseBarrier(grid: TileGrid, rows: number, cols: number): void {
  if (!barrierFits(cols)) return;
  const { first, last } = barrierRows(rows);
  for (let r = first; r <= last; r++) {
    const row = grid[r];
    if (!row) continue;
    for (const c of barrierCols(cols)) row[c] = TILE.ROCK;
  }
}

/**
 * Stands the two towers.
 *
 * One tile each, of TILE.HUT: cover that does not burn, which is what a stone
 * tower is and what a TREE would not be. A tower is therefore impassable, so
 * "reachable" for a tower always means a passable tile beside it — nothing ever
 * walks onto one.
 */
function raiseTowers(grid: TileGrid, rows: number, cols: number): void {
  for (const site of towerSites(rows, cols)) {
    if (!towerFits(site, rows, cols)) continue;
    const row = grid[site.row];
    if (row) row[site.col] = TILE.HUT;
  }
}

/**
 * The tiles the scatter pass may never take: the walkway behind the towers,
 * the two flank lanes, and the ring of tiles around each tower.
 *
 * Together these are a skeleton joining the corridor to both towers that no
 * seed can cut — a lane runs from the corridor to the walkway through a flank
 * gap, the walkway runs the height of the map, and every tower has its west
 * neighbour on it. That is why this generator needs no connectivity repair:
 * the path is reserved before anything is scattered rather than rebuilt after
 * something ate it.
 *
 * Cheap, too. Two rows and one column out of a 21x33 grid is under 8% of the
 * ground, and both lanes read as the ways round the barrier, which is what they
 * are.
 */
function isReserved(r: number, c: number, rows: number, cols: number): boolean {
  if (c === SPINE_COL && r > 0 && r < rows - 1) return true;
  const [top, bottom] = laneRows(rows);
  if ((r === top || r === bottom) && c > 0) return true;
  return towerSites(rows, cols).some(
    (site) => Math.abs(site.row - r) + Math.abs(site.col - c) === 1,
  );
}

/**
 * Scatters cover over the open ground: rubble and scrub, thin enough that the
 * map is a battlefield and not a thicket.
 *
 * Reads the injected noise so cover clusters into things worth standing behind,
 * and falls back to flat randomness without it, exactly as `generateGrid` and
 * CavernTerrain's `dressFloor` do. Both layers are drawn on every candidate
 * tile and never inside a branch: with no noise source these are rng draws, and
 * a skipped draw would make the map depend on which branch ran.
 *
 * `scatter` is split in half between the two thresholds, so the number reads as
 * the total fraction of ground that ends up covered rather than as a per-layer
 * setting the caller has to halve in their head.
 */
function scatterCover(
  grid: TileGrid,
  rows: number,
  cols: number,
  rng: Rng,
  noise: Noise2D | null,
  scatter: number,
): void {
  const sx = rng() * 200;
  const sy = rng() * 200;
  const n2d = noise
    ? (c: number, r: number, scale: number, ox: number, oy: number) =>
        (noise(c * scale + ox + sx, r * scale + oy + sy) + 1) / 2
    : (): number => rng();
  const coverAt = 1 - Math.max(0, scatter) / 2;

  for (let r = 0; r < rows; r++) {
    const row = grid[r];
    if (!row) continue;
    for (let c = 0; c < cols; c++) {
      // The fortification and the rim are already standing, and the two
      // guarantees frameArena made are not this pass's to undo.
      if (row[c] !== TILE.EMPTY) continue;
      if (isSpawnZone(r, c, rows) || isCrowCorridor(c, cols)) continue;
      if (isReserved(r, c, rows, cols)) continue;
      const nRock = n2d(c, r, 0.18, 47, 19);
      const nTree = n2d(c, r, 0.15, 83, 61);
      if (nRock > coverAt) row[c] = TILE.ROCK;
      else if (nTree > coverAt) row[c] = TILE.TREE;
    }
  }
}
