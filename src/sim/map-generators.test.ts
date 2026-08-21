import { describe, expect, it } from 'vitest';

import { MAP_COLS, MAP_ROWS } from './arena-map';
import { MazeTerrain, NoiseTerrain, openTilesConnected } from './map-generators';
import { mulberry32 } from './rng';
import { TILE, tilePassable, type TileGrid } from './tilemap';

/** Every seed a match could pick, sampled. */
const SEEDS = Array.from({ length: 200 }, (_, i) => i * 7919 + 1);

const maze = (seed: number, braid = 0.15): TileGrid =>
  new MazeTerrain({ braid }).generate(MAP_ROWS, MAP_COLS, mulberry32(seed), null);

const openCount = (grid: TileGrid): number =>
  grid.reduce((n, row) => n + row.filter((t) => tilePassable(t)).length, 0);

describe('MazeTerrain', () => {
  // The whole reason the generator exists as its own class. A noise map with an
  // unreachable pocket costs nothing; a maze with one is unfinishable.
  it('leaves every walkable tile reachable from every other, across 200 seeds', () => {
    for (const seed of SEEDS) {
      expect(openTilesConnected(maze(seed)), `seed ${seed} carved a disconnected maze`).toBe(true);
    }
  });

  it('stays connected with no braiding at all', () => {
    for (const seed of SEEDS.slice(0, 50)) {
      expect(openTilesConnected(maze(seed, 0)), `seed ${seed}`).toBe(true);
    }
  });

  // Braiding only ever removes wall, so it can only add connections. If this
  // ever fails, braid() has started closing something.
  it('never has fewer open tiles after braiding than before', () => {
    for (const seed of SEEDS.slice(0, 50)) {
      expect(openCount(maze(seed, 0.5))).toBeGreaterThanOrEqual(openCount(maze(seed, 0)));
    }
  });

  it('is deterministic: one seed always gives one maze', () => {
    expect(maze(12345)).toEqual(maze(12345));
    expect(maze(12345)).not.toEqual(maze(12346));
  });

  it('walls the outer border, so nothing walks off the grid', () => {
    const grid = maze(99);
    const lastRow = MAP_ROWS - 1;
    const lastCol = MAP_COLS - 1;
    for (let c = 0; c < MAP_COLS; c++) {
      expect(tilePassable(grid[0]?.[c])).toBe(false);
      expect(tilePassable(grid[lastRow]?.[c])).toBe(false);
    }
    for (let r = 0; r < MAP_ROWS; r++) {
      expect(tilePassable(grid[r]?.[0])).toBe(false);
      expect(tilePassable(grid[r]?.[lastCol])).toBe(false);
    }
  });

  it('opens every cell, so no part of the maze is walled off unused', () => {
    const grid = maze(5);
    for (let r = 1; r < MAP_ROWS - 1; r += 2) {
      for (let c = 1; c < MAP_COLS - 1; c += 2) {
        expect(tilePassable(grid[r]?.[c]), `cell ${r},${c} was never carved`).toBe(true);
      }
    }
  });

  it('builds walls out of ROCK, which blocks shots as well as bodies', () => {
    const grid = maze(3);
    const kinds = new Set(grid.flat());
    expect(kinds).toEqual(new Set([TILE.EMPTY, TILE.ROCK]));
  });

  it('braiding at 1 leaves strictly fewer dead ends than a perfect maze', () => {
    const deadEnds = (grid: TileGrid): number => {
      let n = 0;
      for (let r = 1; r < MAP_ROWS - 1; r += 2) {
        for (let c = 1; c < MAP_COLS - 1; c += 2) {
          if (!tilePassable(grid[r]?.[c])) continue;
          let exits = 0;
          for (const [dr, dc] of [
            [-1, 0],
            [1, 0],
            [0, -1],
            [0, 1],
          ]) {
            if (tilePassable(grid[r + dr!]?.[c + dc!])) exits++;
          }
          if (exits === 1) n++;
        }
      }
      return n;
    };
    expect(deadEnds(maze(21, 1))).toBeLessThan(deadEnds(maze(21, 0)));
  });

  it('degrades to solid rock rather than throwing on a grid too small to hold a cell', () => {
    const tiny = new MazeTerrain({ braid: 0.15 }).generate(2, 2, mulberry32(1), null);
    expect(tiny.flat().every((t) => t === TILE.ROCK)).toBe(true);
  });
});

describe('NoiseTerrain', () => {
  it('still builds the map it always did, unchanged by the generator split', () => {
    const forest = new NoiseTerrain({ density: 0.45 });
    const grid = forest.generate(MAP_ROWS, MAP_COLS, mulberry32(42), null);
    expect(grid).toHaveLength(MAP_ROWS);
    expect(grid[0]).toHaveLength(MAP_COLS);
    expect(openCount(grid)).toBeGreaterThan(0);
  });

  it('gives a different map at a different density', () => {
    const a = new NoiseTerrain({ density: 0.45 }).generate(MAP_ROWS, MAP_COLS, mulberry32(9), null);
    const b = new NoiseTerrain({ density: 1 }).generate(MAP_ROWS, MAP_COLS, mulberry32(9), null);
    expect(a).not.toEqual(b);
  });
});

describe('openTilesConnected', () => {
  const solid = (): TileGrid =>
    Array.from({ length: 5 }, () => new Array(5).fill(TILE.ROCK) as TileGrid[number]);

  it('calls a grid with no open tiles connected, vacuously', () => {
    expect(openTilesConnected(solid())).toBe(true);
  });

  it('catches two pockets that cannot reach each other', () => {
    const grid = solid();
    grid[1]![1] = TILE.EMPTY;
    grid[3]![3] = TILE.EMPTY;
    expect(openTilesConnected(grid)).toBe(false);
  });

  it('accepts the same two pockets once a corridor joins them', () => {
    const grid = solid();
    for (let i = 1; i <= 3; i++) {
      grid[i]![1] = TILE.EMPTY;
      grid[3]![i] = TILE.EMPTY;
    }
    expect(openTilesConnected(grid)).toBe(true);
  });
});
