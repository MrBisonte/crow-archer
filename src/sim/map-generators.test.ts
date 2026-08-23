import { describe, expect, it } from 'vitest';

import { MAP_COLS, MAP_ROWS } from './arena-map';
import { CavernTerrain, MazeTerrain, NoiseTerrain, openTilesConnected } from './map-generators';
import { isArenaBorder, isCrowCorridor, isSpawnZone } from './mapgen';
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

  // The reason corridor width is a parameter: a one-tile corridor is 32px and
  // a body is about 20, so there is no room to step around an unkillable boss.
  it('carves corridors two tiles wide, so a body can pass another thing', () => {
    const grid = maze(5);
    let widest = 0;
    for (let r = 0; r < MAP_ROWS - 1; r++) {
      for (let c = 0; c < MAP_COLS - 1; c++) {
        const block =
          tilePassable(grid[r]?.[c]) &&
          tilePassable(grid[r]?.[c + 1]) &&
          tilePassable(grid[r + 1]?.[c]) &&
          tilePassable(grid[r + 1]?.[c + 1]);
        if (block) widest = 2;
      }
    }
    expect(widest, 'no 2x2 open block: corridors are still one tile wide').toBe(2);
  });

  it('honours a one-tile corridor when asked for one', () => {
    const narrow = new MazeTerrain({ braid: 0, corridor: 1 }).generate(
      MAP_ROWS,
      MAP_COLS,
      mulberry32(5),
      null,
    );
    expect(openTilesConnected(narrow)).toBe(true);
    expect(openCount(narrow)).toBeLessThan(openCount(maze(5, 0)));
  });

  it('builds walls out of ROCK, which blocks shots as well as bodies', () => {
    const grid = maze(3);
    const kinds = new Set(grid.flat());
    expect(kinds).toEqual(new Set([TILE.EMPTY, TILE.ROCK]));
  });

  // Braiding is only observable as extra open tiles: it opens passages that a
  // perfect maze leaves walled. Asserting that, rather than recounting dead
  // ends here, keeps the test from restating the layout arithmetic it is
  // supposed to be checking.
  it('opens strictly more of the map at full braid than at none', () => {
    let opened = 0;
    for (const seed of SEEDS.slice(0, 20)) {
      expect(openCount(maze(seed, 1))).toBeGreaterThanOrEqual(openCount(maze(seed, 0)));
      if (openCount(maze(seed, 1)) > openCount(maze(seed, 0))) opened++;
    }
    expect(opened, 'full braid never opened a single passage in 20 seeds').toBeGreaterThan(15);
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

describe('CavernTerrain', () => {
  /** The tuning MAP_GEN ships, so these test the cavern the game builds. */
  const SHAPE = { fill: 0.44, smoothing: 4, pools: 0.1, fungus: 0.1 };

  const cavern = (seed: number, opts: Partial<typeof SHAPE> = {}): TileGrid =>
    new CavernTerrain({ ...SHAPE, ...opts }).generate(
      MAP_ROWS,
      MAP_COLS,
      mulberry32(seed),
      null,
    );

  it('is deterministic: one seed always gives one cavern', () => {
    expect(cavern(12345)).toEqual(cavern(12345));
    expect(cavern(12345)).not.toEqual(cavern(12346));
  });

  // The same guarantee the maze needs, for a harder reason: a maze is
  // connected by construction, and cellular automata promise nothing at all.
  // joinRegions is the pass that has to make this true.
  it('leaves every walkable tile reachable from every other, across 200 seeds', () => {
    for (const seed of SEEDS) {
      expect(openTilesConnected(cavern(seed)), `seed ${seed} sealed a chamber off`).toBe(true);
    }
  });

  it('stays connected with no smoothing at all, when the fill is still scatter', () => {
    for (const seed of SEEDS.slice(0, 40)) {
      expect(openTilesConnected(cavern(seed, { smoothing: 0 })), `seed ${seed}`).toBe(true);
    }
  });

  // What smoothing is for. A lone rock is one with no orthogonal rock beside
  // it: scatter is mostly those, and a cave is mostly not, so the count
  // collapsing is the scatter becoming chambers.
  it('turns scatter into chambers, which is the whole point of smoothing', () => {
    const lone = (grid: TileGrid): number => {
      let n = 0;
      for (let r = 0; r < MAP_ROWS; r++)
        for (let c = 0; c < MAP_COLS; c++) {
          if (grid[r]?.[c] !== TILE.ROCK) continue;
          const joined =
            grid[r - 1]?.[c] === TILE.ROCK || grid[r + 1]?.[c] === TILE.ROCK ||
            grid[r]?.[c - 1] === TILE.ROCK || grid[r]?.[c + 1] === TILE.ROCK;
          if (!joined) n++;
        }
      return n;
    };
    for (const seed of SEEDS.slice(0, 20)) {
      expect(lone(cavern(seed)), `seed ${seed}`).toBeLessThan(lone(cavern(seed, { smoothing: 0 })));
    }
  });

  it('walls the rim but leaves the crow corridor open, the way every crow map does', () => {
    for (const seed of SEEDS.slice(0, 40)) {
      const grid = cavern(seed);
      for (let r = 0; r < MAP_ROWS; r++)
        for (let c = 0; c < MAP_COLS; c++) {
          if (isArenaBorder(r, c, MAP_ROWS, MAP_COLS)) {
            expect(tilePassable(grid[r]?.[c]), `seed ${seed} opened the rim at ${r},${c}`)
              .toBe(false);
          } else if (isCrowCorridor(c, MAP_COLS) || isSpawnZone(r, c, MAP_ROWS)) {
            expect(tilePassable(grid[r]?.[c]), `seed ${seed} blocked ${r},${c}`).toBe(true);
          }
        }
    }
  });

  // Both bounds matter. Too closed is a run spent squeezing down necks; too
  // open is the forest with different paint, and the cover this map is for
  // never appears.
  it('leaves an arena worth playing on, never a warren and never an empty room', () => {
    const total = MAP_ROWS * MAP_COLS;
    for (const seed of SEEDS) {
      const open = openCount(cavern(seed)) / total;
      expect(open, `seed ${seed} left ${(open * 100).toFixed(0)}% open`).toBeGreaterThan(0.35);
      expect(open, `seed ${seed} left ${(open * 100).toFixed(0)}% open`).toBeLessThan(0.9);
    }
  });

  // Ash only ever comes from burning something, and huts are placed by the
  // noise generator alone, so a cavern that emitted either would be drawn by
  // painters CAVERN_TILE_PAINTERS only borrows to keep its table total.
  it('builds only the four tiles its theme paints for itself', () => {
    const kinds = new Set(SEEDS.slice(0, 40).flatMap((seed) => cavern(seed).flat()));
    expect(kinds.has(TILE.ASH)).toBe(false);
    expect(kinds.has(TILE.HUT)).toBe(false);
    expect(kinds).toEqual(new Set([TILE.EMPTY, TILE.ROCK, TILE.WATER, TILE.TREE]));
  });

  it('grows both pools and fungus, and neither when asked for neither', () => {
    const bare = SEEDS.slice(0, 20).map((seed) => cavern(seed, { pools: 0, fungus: 0 }));
    for (const grid of bare) {
      expect(grid.flat()).not.toContain(TILE.WATER);
      expect(grid.flat()).not.toContain(TILE.TREE);
    }
    const dressed = SEEDS.slice(0, 20).map((seed) => cavern(seed));
    expect(dressed.some((g) => g.flat().includes(TILE.WATER))).toBe(true);
    expect(dressed.some((g) => g.flat().includes(TILE.TREE))).toBe(true);
  });

  // Not the maze's answer, which is solid rock, and deliberately so: on a grid
  // this small every column is inside the crow corridor, so the scaffolding
  // opens the lot. Open is the safer degenerate answer of the two anyway —
  // nothing can spawn inside a wall that is not there.
  it('degrades to open floor rather than throwing on a grid too small to hold a chamber', () => {
    const tiny = new CavernTerrain(SHAPE).generate(2, 2, mulberry32(1), null);
    expect(tiny).toHaveLength(2);
    expect(tiny[0]).toHaveLength(2);
    expect(tiny.flat().every((t) => t === TILE.EMPTY)).toBe(true);
    expect(openTilesConnected(tiny)).toBe(true);
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
