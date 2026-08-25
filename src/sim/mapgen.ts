/** Procedural terrain generation. Pure: all randomness injected. */

import type { Rng } from './rng';
import { TILE, type TileGrid, type TileId } from './tilemap';

/** Coherent 2-D noise in [-1, 1]. Null when no noise source is available. */
export type Noise2D = (x: number, y: number) => number;

/*
 * The arena's fixed furniture, as three predicates rather than three copies of
 * the same arithmetic. Every map crows live on owes them the same three
 * guarantees, and the second map to want them is the point at which "the
 * generator that happens to be first" stops being the right home.
 *
 * Pure and rng-free on purpose: `generateGrid` below still consumes its random
 * numbers in exactly the order it always did, so extracting these left every
 * existing seed generating the map it generated before.
 */

/**
 * The two columns down the right edge, left passable on every map. Crows spawn
 * off the right of the canvas and fly in, and an aggro one paths the rest of
 * the way with A*, so a map that walls this off gives them nothing to enter
 * through.
 */
export const isCrowCorridor = (c: number, cols: number): boolean => c >= cols - 2;

/**
 * The solid rim: top row, bottom row and left column, stopping short of the
 * crow corridor. The right edge is deliberately unwalled — that is the
 * corridor's whole job.
 */
export const isArenaBorder = (r: number, c: number, rows: number, cols: number): boolean =>
  (r === 0 || r === rows - 1 || c === 0) && !isCrowCorridor(c, cols);

/**
 * The block a run starts in, kept clear of anything solid so a fresh spawn
 * never lands inside terrain.
 */
export const isSpawnZone = (r: number, c: number, rows: number): boolean =>
  c >= 1 && c <= 4 && Math.abs(r - Math.floor(rows / 2)) <= 3;

/**
 * Builds the terrain grid. Border walls with an open crow corridor on the
 * right, a clear player spawn zone, three independent noise layers for water,
 * rock, and forest, then 1-2 destructible 2x2 huts.
 *
 * With a null noise source, tiles scatter randomly instead of clustering
 * (same graceful fallback the CDN version had).
 */
export function generateGrid(
  rows: number,
  cols: number,
  rng: Rng,
  noise: Noise2D | null,
  density = 1,
): TileGrid {
  // How much of the clutter to keep. One is the single-player map, which was
  // built for crows flying a corridor and is dense enough that a third of it
  // stops an arrow. A duel wants cover, not a thicket, so the battle map passes
  // less and the thresholds move towards one in proportion.
  const cut = (base: number) => 1 - (1 - base) * density;
  const waterAt = cut(0.76);
  const rockAt = cut(0.77);
  const treeAt = cut(0.76);
  const grid: TileGrid = [];
  const sx = rng() * 200;
  const sy = rng() * 200;
  const n2d = noise
    ? (c: number, r: number, scale: number, ox: number, oy: number) =>
        (noise(c * scale + ox + sx, r * scale + oy + sy) + 1) / 2
    : () => rng();

  const midRow = Math.floor(rows / 2);
  for (let r = 0; r < rows; r++) {
    const row = new Array<TileId>(cols).fill(TILE.EMPTY);
    grid[r] = row;
    for (let c = 0; c < cols; c++) {
      // Hard border walls: top row, bottom row, left col; crow corridor stays open
      if (isArenaBorder(r, c, rows, cols)) {
        row[c] = rng() < 0.6 ? TILE.ROCK : TILE.TREE;
        continue;
      }
      if (isSpawnZone(r, c, rows)) continue;
      if (isCrowCorridor(c, cols)) continue;
      // Each biome has its own noise layer at its own scale; offsets decorrelate.
      const nW = n2d(c, r, 0.1, 0, 0);
      const nR = n2d(c, r, 0.18, 47, 19);
      const nT = n2d(c, r, 0.15, 83, 61);
      // Priority: water > rock > tree (water wins ties so ponds stay contiguous)
      if (nW > waterAt) row[c] = TILE.WATER;
      else if (nR > rockAt) row[c] = TILE.ROCK;
      else if (nT > treeAt) row[c] = TILE.TREE;
    }
  }

  placeHuts(grid, rows, cols, rng, midRow);
  return grid;
}

/** Columns kept clear of huts on the west edge, where the player spawns. */
const HUT_WEST_MARGIN = 5;

function placeHuts(grid: TileGrid, rows: number, cols: number, rng: Rng, midRow: number): void {
  const numHuts = rng() < 0.6 ? 2 : 1;
  let placed = 0;
  let tries = 0;
  while (placed < numHuts && tries < 60) {
    tries++;
    // Huts sit between the spawn block and the crow corridor. The row draw
    // below already scales; this was a fixed 5..19, so on a wider grid every
    // hut still landed in the western third and the rest of the map had none.
    // Six tenths of the buildable ground, which is 15 columns on the shipped
    // 33 — the same band, expressed as a share of the grid instead of a count.
    const hutBand = Math.round((cols - HUT_WEST_MARGIN - 3) * 0.6);
    const hc = HUT_WEST_MARGIN + Math.floor(rng() * hutBand);
    const hr = 1 + Math.floor(rng() * (rows - 4));
    if (hc <= 4 && hr >= midRow - 3 && hr <= midRow + 3) continue;
    if (hc >= cols - 3) continue;
    // Need a 2x2 footprint of EMPTY tiles, plus at least a 1-tile gap around it
    let ok = true;
    for (let dr = -1; dr <= 2 && ok; dr++)
      for (let dc = -1; dc <= 2 && ok; dc++) {
        const t = grid[hr + dr]?.[hc + dc];
        if (t === undefined) continue;
        if (dr >= 0 && dr < 2 && dc >= 0 && dc < 2) {
          if (t !== TILE.EMPTY) ok = false;
        } else if (t === TILE.HUT) {
          ok = false;
        }
      }
    if (!ok) continue;
    for (let dr = 0; dr < 2; dr++)
      for (let dc = 0; dc < 2; dc++) {
        const row = grid[hr + dr];
        if (row) row[hc + dc] = TILE.HUT;
      }
    placed++;
  }
}
