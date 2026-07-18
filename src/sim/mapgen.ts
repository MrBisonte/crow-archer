/** Procedural terrain generation. Pure: all randomness injected. */

import type { Rng } from './rng';
import { TILE, type TileGrid, type TileId } from './tilemap';

/** Coherent 2-D noise in [-1, 1]. Null when no noise source is available. */
export type Noise2D = (x: number, y: number) => number;

/**
 * Builds the terrain grid. Border walls with an open crow corridor on the
 * right, a clear player spawn zone, three independent noise layers for water,
 * rock, and forest, then 1-2 destructible 2x2 huts.
 *
 * With a null noise source, tiles scatter randomly instead of clustering
 * (same graceful fallback the CDN version had).
 */
export function generateGrid(rows: number, cols: number, rng: Rng, noise: Noise2D | null): TileGrid {
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
      const isBorder = (r === 0 || r === rows - 1 || c === 0) && c < cols - 2;
      if (isBorder) {
        row[c] = rng() < 0.6 ? TILE.ROCK : TILE.TREE;
        continue;
      }
      // Player spawn clear zone (cols 1-4, rows centered on mid-row)
      if (c >= 1 && c <= 4 && r >= midRow - 3 && r <= midRow + 3) continue;
      // Crow corridor, always passable
      if (c >= cols - 2) continue;
      // Each biome has its own noise layer at its own scale; offsets decorrelate.
      const nW = n2d(c, r, 0.1, 0, 0);
      const nR = n2d(c, r, 0.18, 47, 19);
      const nT = n2d(c, r, 0.15, 83, 61);
      // Priority: water > rock > tree (water wins ties so ponds stay contiguous)
      if (nW > 0.76) row[c] = TILE.WATER;
      else if (nR > 0.77) row[c] = TILE.ROCK;
      else if (nT > 0.76) row[c] = TILE.TREE;
    }
  }

  placeHuts(grid, rows, cols, rng, midRow);
  return grid;
}

function placeHuts(grid: TileGrid, rows: number, cols: number, rng: Rng, midRow: number): void {
  const numHuts = rng() < 0.6 ? 2 : 1;
  let placed = 0;
  let tries = 0;
  while (placed < numHuts && tries < 60) {
    tries++;
    const hc = 5 + Math.floor(rng() * 15);
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
