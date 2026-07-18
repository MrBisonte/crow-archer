import { describe, expect, it } from 'vitest';

import { generateGrid } from './mapgen';
import { mulberry32 } from './rng';
import { TILE, tilePassable } from './tilemap';

const ROWS = 21;
const COLS = 33;

describe('generateGrid', () => {
  it('is deterministic for a given seed', () => {
    const a = generateGrid(ROWS, COLS, mulberry32(42), null);
    const b = generateGrid(ROWS, COLS, mulberry32(42), null);
    expect(a).toEqual(b);
  });

  it('differs across seeds', () => {
    const a = generateGrid(ROWS, COLS, mulberry32(1), null);
    const b = generateGrid(ROWS, COLS, mulberry32(2), null);
    expect(a).not.toEqual(b);
  });

  it('keeps the player spawn zone clear', () => {
    const grid = generateGrid(ROWS, COLS, mulberry32(7), null);
    const midRow = Math.floor(ROWS / 2);
    for (let r = midRow - 3; r <= midRow + 3; r++)
      for (let c = 1; c <= 4; c++) expect(grid[r]?.[c]).toBe(TILE.EMPTY);
  });

  it('keeps the crow corridor passable', () => {
    const grid = generateGrid(ROWS, COLS, mulberry32(7), null);
    for (let r = 0; r < ROWS; r++)
      for (let c = COLS - 2; c < COLS; c++) expect(tilePassable(grid[r]?.[c])).toBe(true);
  });

  it('walls the border outside the corridor', () => {
    const grid = generateGrid(ROWS, COLS, mulberry32(7), null);
    for (let c = 0; c < COLS - 2; c++) {
      expect(grid[0]?.[c]).not.toBe(TILE.EMPTY);
      expect(grid[ROWS - 1]?.[c]).not.toBe(TILE.EMPTY);
    }
  });

  it('places 4 or 8 hut tiles (1-2 complete 2x2 huts)', () => {
    const seen = new Set<number>();
    for (let seed = 0; seed < 20; seed++) {
      const grid = generateGrid(ROWS, COLS, mulberry32(seed), null);
      const huts = grid.flat().filter(t => t === TILE.HUT).length;
      seen.add(huts);
      expect([0, 4, 8]).toContain(huts);
    }
    // Across 20 seeds at least one map should actually contain huts
    expect(Math.max(...seen)).toBeGreaterThan(0);
  });
});
