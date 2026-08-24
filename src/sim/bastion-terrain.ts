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
 *
 * The barrier is echeloned, which came out of a playtest: one straight wall in
 * front of the hero read as a single flat obstacle, so it is now three sections
 * at two column offsets — the middle one covering the towers head-on, the two
 * flanking ones standing forward of it towards the corridor. At 21x33, with the
 * hero's spawn on the left and the siege arriving from the right:
 *
 *     ..........##.....   rows 4-6,   cols 11-12
 *     ..............
 *     .......##........   rows 9-11,  cols 8-9   <- nearest the towers
 *     ..............
 *     ..........##.....   rows 14-16, cols 11-12
 *
 * Four ways through it: round either end, or through either stepped gap.
 */

import type { MapGenerator } from './map-generators';
import { isArenaBorder, isCrowCorridor, isSpawnZone, type Noise2D } from './mapgen';
import type { Rng } from './rng';
import { TILE, type TileGrid, type TileId } from './tilemap';
import { TOWER_SPAN, towerTiles } from './towers';

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
 * be erased by the pass that keeps a fresh spawn out of terrain. It is the span
 * that has to clear it, not the corner: the north tower extends SOUTH from its
 * site, towards the centre, so its inner row sits `TOWER_SPAN - 1` closer to
 * the block than its site does. Hence `3 + TOWER_SPAN` rather than a bare 4 —
 * with one-tile towers those were the same number, and the day the footprint
 * grew the north tower would otherwise have lost a row to the spawn pass on
 * every grid under sixteen rows.
 *
 * A quarter of the grid puts them at rows 5 and 15 of 21 — ten rows apart, far
 * enough to read as two towers rather than one thick one, with the spawn block
 * between them where the hero starts.
 */
const towerSpread = (rows: number): number =>
  Math.max(3 + TOWER_SPAN, Math.floor(rows / 4));

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
  const col = Math.max(1, Math.min(TOWER_COL, cols - 1 - TOWER_SPAN));
  const onGrid = (r: number): number =>
    Math.max(1, Math.min(r, Math.max(1, rows - 1 - TOWER_SPAN)));
  return [
    { row: onGrid(mid - spread), col },
    { row: onGrid(mid + spread), col },
  ];
}

/** Is there room to stand a tower here, or is this grid too small to hold one? */
const towerFits = (site: TowerSite, rows: number, cols: number): boolean =>
  towerTiles(site).every(
    (tile) =>
      tile.row > 0 &&
      tile.row < rows - 1 &&
      tile.col > 0 &&
      tile.col < cols - 1 &&
      !isArenaBorder(tile.row, tile.col, rows, cols) &&
      !isCrowCorridor(tile.col, cols) &&
      !isSpawnZone(tile.row, tile.col, rows),
  );

/**
 * One section of the barrier: two courses of rock standing across a run of
 * rows.
 *
 * Two columns rather than one because a single course reads as a fence at 32 px
 * a tile, and because cover a body can stand *inside* is what lets the defence
 * hold a line rather than just stand behind one.
 */
export interface BarrierSegment {
  /** The two adjacent columns this section stands in, west first. */
  readonly cols: readonly [number, number];
  /** The topmost row it occupies. */
  readonly firstRow: number;
  /** The bottommost row it occupies, inclusive. */
  readonly lastRow: number;
}

/**
 * The two columns the middle section stands in.
 *
 * A quarter of the way across, which on the shipped 33 columns is 8 and 9:
 * close enough to the towers to be their cover and not a second arena wall,
 * far enough that the defence has a yard to fall back into. Everything from
 * there to the corridor is the open middle ground the fight happens on.
 *
 * Always at least two columns right of the towers, at every grid size, so the
 * promise this map makes — cover *between* the towers and the corridor — holds
 * even where the barrier turns out not to fit. On a grid that narrow the
 * sections land on or past the corridor and nothing is built.
 */
const centreCols = (cols: number): readonly [number, number] => {
  const first = Math.max(TOWER_COL + 2, Math.min(Math.floor(cols / 4), cols - 4));
  return [first, first + 1];
};

/**
 * How far forward of the middle section the two flanking sections stand.
 *
 * Forward means towards the corridor, so the barrier reads as a shallow chevron
 * opening at the siege: nearest the defence in the centre, stepping away from
 * it above and below. Three columns on the shipped 33 — enough that a column of
 * open ground separates the two courses, so the eye reads depth rather than one
 * wall with a kink in it.
 */
const echelon = (cols: number): number => Math.max(3, Math.floor(cols / 10));

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

/** The rows the barrier as a whole occupies: everything between the two flank gaps. */
const barrierRows = (rows: number): { first: number; last: number } => {
  const gap = barrierGap(rows);
  return { first: gap + 1, last: rows - 2 - gap };
};

/**
 * How many rows of open ground separate one section from the next.
 *
 * The same argument as `barrierGap`, one size down: these gaps are stepped
 * rather than straight — a body leaving one goes on to a section standing three
 * columns away — so they do not have to be as wide as the run round the end to
 * be walked without threading a needle. Two rows at 21.
 */
const segmentGap = (rows: number): number => Math.max(1, Math.floor(rows / 10));

/**
 * The row spans of the three sections, top to bottom, or nothing when the grid
 * is too short to hold three sections and two gaps between them.
 *
 * The band is split in thirds with the odd rows going to the middle section, so
 * the layout stays a mirror about the centre line — neither flank is the softer
 * one, which is the same reason `laneRows` mirrors.
 */
const segmentRows = (rows: number): readonly { first: number; last: number }[] => {
  const { first, last } = barrierRows(rows);
  const gap = segmentGap(rows);
  const spare = last - first + 1 - 2 * gap;
  if (spare < 3) return [];
  const flank = Math.floor(spare / 3);
  const centre = spare - 2 * flank;
  const centreFirst = first + flank + gap;
  return [
    { first, last: first + flank - 1 },
    { first: centreFirst, last: centreFirst + centre - 1 },
    { first: last - flank + 1, last },
  ];
};

/**
 * The barrier, section by section, top to bottom. Empty when the grid has no
 * room for one.
 *
 * Three sections at two column offsets rather than one straight wall: the
 * middle section covers the towers head-on and the two flanking sections stand
 * `echelon` columns forward of it, so what the siege meets is layered depth
 * with four ways through it — round either end, or through either of the two
 * stepped gaps between sections.
 *
 * All or nothing on a grid too small for it. A barrier that dropped its flanks
 * where they would not fit would be a different shape wearing the same name,
 * and the one thing every consumer may assume is that what it is told about is
 * what was built. `raiseBarrier` iterates this list and nothing else, so the
 * generator cannot disagree with it.
 *
 * Exported because the layout is inspected from outside — the same reason
 * `towerSites` is, and the reason neither is a private detail of `generate`.
 */
export function barrierCols(rows: number, cols: number): readonly BarrierSegment[] {
  const centre = centreCols(cols);
  const step = echelon(cols);
  const flank: readonly [number, number] = [centre[0] + step, centre[1] + step];
  // The spare column matters. A barrier flush against the corridor would have
  // the siege arriving already in contact with it, which is a wall to be broken
  // rather than cover to be walked around. The forward sections are the ones
  // that decide it, being the ones nearest the mouth.
  if (flank[1] > cols - 4) return [];
  const spans = segmentRows(rows);
  if (spans.length !== 3) return [];
  const [top, middle, bottom] = spans as [
    { first: number; last: number },
    { first: number; last: number },
    { first: number; last: number },
  ];
  return [
    { cols: flank, firstRow: top.first, lastRow: top.last },
    { cols: centre, firstRow: middle.first, lastRow: middle.last },
    { cols: flank, firstRow: bottom.first, lastRow: bottom.last },
  ];
}

/**
 * The gates: one point per way through the barrier, top to bottom.
 *
 * A 'way through' is a run of rows on which the whole barrier band is open —
 * the flank gaps at either end and the stepped gaps between the sections. These
 * are the places a siege can actually cross, which makes them the places a
 * retinue should be standing, so this is exported for the guards to post on
 * rather than being left as a fact only the generator knows.
 *
 * Returned in grid coordinates, at the barrier's own column so a guard posted
 * here stands in the gap rather than behind it. An empty barrier has no gates,
 * which is the honest answer for a grid too small to fortify: there is nothing
 * to hold.
 */
export function barrierGates(rows: number, cols: number): readonly TowerSite[] {
  const segments = barrierCols(rows, cols);
  if (segments.length === 0) return [];
  const band = { west: cols, east: 0 };
  for (const seg of segments) {
    band.west = Math.min(band.west, seg.cols[0]);
    band.east = Math.max(band.east, seg.cols[1]);
  }
  const blocked = new Set<number>();
  for (const seg of segments) {
    for (let r = seg.firstRow; r <= seg.lastRow; r++) blocked.add(r);
  }
  const gates: TowerSite[] = [];
  let runStart = -1;
  for (let r = 1; r <= rows - 1; r++) {
    const open = r < rows - 1 && !blocked.has(r);
    if (open && runStart < 0) runStart = r;
    if (!open && runStart >= 0) {
      gates.push({ row: Math.floor((runStart + r - 1) / 2), col: band.west });
      runStart = -1;
    }
  }
  return gates;
}

/** The rows of open ground between one section and the next, top to bottom. */
const segmentGapRows = (segments: readonly BarrierSegment[]): readonly number[] => {
  const gaps: number[] = [];
  for (let i = 1; i < segments.length; i++) {
    const above = segments[i - 1];
    const below = segments[i];
    if (!above || !below) continue;
    for (let r = above.lastRow + 1; r < below.firstRow; r++) gaps.push(r);
  }
  return gaps;
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
 * Raises the barrier: three sections of rock across the middle of the map, open
 * at both ends and between every pair of sections.
 *
 * Stamps `barrierCols` and consults nothing else, so the shape the map is built
 * from and the shape it reports are the same list.
 */
function raiseBarrier(grid: TileGrid, rows: number, cols: number): void {
  for (const segment of barrierCols(rows, cols)) {
    for (let r = segment.firstRow; r <= segment.lastRow; r++) {
      const row = grid[r];
      if (!row) continue;
      for (const c of segment.cols) row[c] = TILE.ROCK;
    }
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
    // The whole footprint or none of it. `towerFits` has already said every
    // tile is legal, so a partial stamp here could only ever be a bug.
    for (const tile of towerTiles(site)) {
      const row = grid[tile.row];
      if (row) row[tile.col] = TILE.HUT;
    }
  }
}

/**
 * The tiles the scatter pass may never take: the walkway behind the towers, the
 * two flank lanes, the gaps between the barrier's sections, and the ring of
 * tiles around each tower.
 *
 * The first three are a skeleton joining the corridor to both towers that no
 * seed can cut — a lane runs from the corridor to the walkway through a flank
 * gap, the walkway runs the height of the map, and every tower has its west
 * neighbour on it. That is why this generator needs no connectivity repair:
 * the path is reserved before anything is scattered rather than rebuilt after
 * something ate it.
 *
 * The section gaps are the same argument applied to the new geometry, and are
 * reserved across the barrier's own width only — from a column short of the
 * middle section to a column past the flanking ones. A gap is what makes three
 * sections three sections; rubble bridging one would quietly re-fuse the wall
 * the playtest asked us to break up. Beyond that width the gap rows are open
 * ground like any other, and the scatter is welcome to them: the guarantee that
 * a body gets from the corridor to a tower still rests on the two lanes, which
 * is where it rested before.
 *
 * Cheap, too. Two rows, one column, and a couple of dozen tiles between the
 * sections is a tenth of a 21x33 grid, and the lanes read as the ways round the
 * barrier, which is what they are.
 *
 * Built once per generate rather than asked per tile: the skeleton is a
 * function of the grid size, and recomputing the barrier and the towers 693
 * times to answer the same question is work the caller can hoist.
 */
function reservedTiles(rows: number, cols: number): (r: number, c: number) => boolean {
  const [topLane, bottomLane] = laneRows(rows);
  const towers = towerSites(rows, cols);
  const segments = barrierCols(rows, cols);
  const gapRows = new Set(segmentGapRows(segments));
  const barrierWest = Math.min(...segments.map((s) => s.cols[0]));
  const barrierEast = Math.max(...segments.map((s) => s.cols[1]));

  return (r: number, c: number): boolean => {
    if (c === SPINE_COL && r > 0 && r < rows - 1) return true;
    if ((r === topLane || r === bottomLane) && c > 0) return true;
    if (gapRows.has(r) && c >= barrierWest - 1 && c <= barrierEast + 1) return true;
    // Orthogonally adjacent to any tile of any tower, and not inside one. With
    // a one-tile tower this was a manhattan distance of exactly 1 from the
    // site; a 2x2 needs the ring around the block, or three of the four tiles
    // would have no reserved neighbour and the scatter could wall them in.
    return towers.some((site) =>
      towerTiles(site).some(
        (tile) =>
          Math.abs(tile.row - r) + Math.abs(tile.col - c) === 1 &&
          !towerTiles(site).some((inside) => inside.row === r && inside.col === c),
      ),
    );
  };
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
  const isReserved = reservedTiles(rows, cols);

  for (let r = 0; r < rows; r++) {
    const row = grid[r];
    if (!row) continue;
    for (let c = 0; c < cols; c++) {
      // The fortification and the rim are already standing, and the two
      // guarantees frameArena made are not this pass's to undo.
      if (row[c] !== TILE.EMPTY) continue;
      if (isSpawnZone(r, c, rows) || isCrowCorridor(c, cols)) continue;
      if (isReserved(r, c)) continue;
      const nRock = n2d(c, r, 0.18, 47, 19);
      const nTree = n2d(c, r, 0.15, 83, 61);
      if (nRock > coverAt) row[c] = TILE.ROCK;
      else if (nTree > coverAt) row[c] = TILE.TREE;
    }
  }
}
