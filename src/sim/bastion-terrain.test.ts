import { describe, expect, it } from 'vitest';

import { MAP_COLS, MAP_ROWS } from './arena-map';
import { BastionTerrain, barrierCols, towerSites, type TowerSite } from './bastion-terrain';
import { isArenaBorder, isCrowCorridor, isSpawnZone } from './mapgen';
import { noiseFor } from './noise';
import { mulberry32 } from './rng';
import { TILE, tilePassable, type TileGrid } from './tilemap';

/** Every seed a run could pick, sampled — the same spread the sibling maps use. */
const SEEDS = Array.from({ length: 200 }, (_, i) => i * 7919 + 1);

/** The tuning this map is meant to ship with: cover, not a thicket. */
const SHAPE = { scatter: 0.08 };

const bastion = (seed: number, scatter = SHAPE.scatter, withNoise = false): TileGrid =>
  new BastionTerrain({ scatter }).generate(
    MAP_ROWS,
    MAP_COLS,
    mulberry32(seed),
    withNoise ? noiseFor(seed) : null,
  );

const STEPS: readonly (readonly [number, number])[] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

/**
 * Every tile the siege can walk to, flood filled from the crow corridor over
 * passable tiles only. Orthogonal steps, because that is how a body moves
 * between tiles: a diagonal chain of rock is a wall, not a gap.
 */
function walkableFromCorridor(grid: TileGrid): boolean[][] {
  const seen: boolean[][] = Array.from({ length: MAP_ROWS }, () =>
    new Array<boolean>(MAP_COLS).fill(false),
  );
  const stack: [number, number][] = [];
  for (let r = 0; r < MAP_ROWS; r++) {
    for (let c = 0; c < MAP_COLS; c++) {
      if (!isCrowCorridor(c, MAP_COLS) || !tilePassable(grid[r]?.[c])) continue;
      seen[r]![c] = true;
      stack.push([r, c]);
    }
  }
  while (stack.length > 0) {
    const [cr, cc] = stack.pop()!;
    for (const [dr, dc] of STEPS) {
      const nr = cr + dr;
      const nc = cc + dc;
      if (nr < 0 || nr >= MAP_ROWS || nc < 0 || nc >= MAP_COLS) continue;
      if (seen[nr]![nc] || !tilePassable(grid[nr]?.[nc])) continue;
      seen[nr]![nc] = true;
      stack.push([nr, nc]);
    }
  }
  return seen;
}

/**
 * Can the siege get at this tower?
 *
 * A tower is TILE.HUT and TILE.HUT is impassable, so nothing ever stands on
 * one. "Reachable" therefore means: at least one of the tower's four orthogonal
 * neighbours is passable and is in the flood fill from the corridor. That is
 * the definition every test in this file uses, and it is the one the game
 * needs — an attacker walks up beside a tower and hits it.
 */
const towerReachable = (grid: TileGrid, site: TowerSite, seen: boolean[][]): boolean =>
  STEPS.some(([dr, dc]) => seen[site.row + dr]?.[site.col + dc] === true);

/**
 * The interior rows of one column that hold rock, in order.
 *
 * The top and bottom rows are the arena's rim and are rock on every column, so
 * counting them would report every barrier as reaching both rims. The rim has
 * its own test.
 */
const rockRows = (grid: TileGrid, col: number): number[] => {
  const rows: number[] = [];
  for (let r = 1; r < MAP_ROWS - 1; r++) if (grid[r]?.[col] === TILE.ROCK) rows.push(r);
  return rows;
};

const isRun = (rows: number[]): boolean =>
  rows.length > 0 && rows.every((r, i) => i === 0 || r === rows[i - 1]! + 1);

describe('BastionTerrain', () => {
  // The one invariant the map cannot survive losing. If the barrier or the
  // scatter ever seals a tower off, the siege walks into a wall for ten waves
  // and the run never ends. Everything else in this file is a detail by
  // comparison.
  it('leaves both towers reachable on foot from the corridor, across 200 seeds', () => {
    for (const seed of SEEDS) {
      const grid = bastion(seed);
      const seen = walkableFromCorridor(grid);
      for (const site of towerSites(MAP_ROWS, MAP_COLS)) {
        expect(
          towerReachable(grid, site, seen),
          `seed ${seed} sealed off the tower at ${site.row},${site.col}`,
        ).toBe(true);
      }
    }
  });

  // Same invariant with a real noise field, which is what the game injects.
  // Noise clusters cover, and a cluster is exactly the shape that walls a lane
  // off, so this is the harder half of the same question.
  it('leaves both towers reachable from the corridor under noise too, across 200 seeds', () => {
    for (const seed of SEEDS) {
      const grid = bastion(seed, SHAPE.scatter, true);
      const seen = walkableFromCorridor(grid);
      for (const site of towerSites(MAP_ROWS, MAP_COLS)) {
        expect(
          towerReachable(grid, site, seen),
          `seed ${seed} (noise) sealed off the tower at ${site.row},${site.col}`,
        ).toBe(true);
      }
    }
  });

  // The hero starts in the spawn block and has to be able to meet what is
  // coming; a defence that cannot reach the field is the same bug wearing a
  // different hat.
  it('leaves the spawn block reachable from the corridor, across 200 seeds', () => {
    for (const seed of SEEDS) {
      const seen = walkableFromCorridor(bastion(seed));
      let reached = 0;
      for (let r = 0; r < MAP_ROWS; r++)
        for (let c = 0; c < MAP_COLS; c++) {
          if (isSpawnZone(r, c, MAP_ROWS) && seen[r]![c]) reached++;
        }
      expect(reached, `seed ${seed} cut the spawn block off`).toBeGreaterThan(0);
    }
  });

  it('is deterministic: one seed always gives one bastion', () => {
    expect(bastion(12345)).toEqual(bastion(12345));
    expect(bastion(12345, SHAPE.scatter, true)).toEqual(bastion(12345, SHAPE.scatter, true));
  });

  it('gives a different bastion for a different seed', () => {
    for (const seed of SEEDS.slice(0, 20)) {
      expect(bastion(seed), `seed ${seed}`).not.toEqual(bastion(seed + 1));
    }
  });

  // The reason towerSites is exported at all: the renderer and the guard
  // placement look up these coordinates instead of scanning for HUT tiles, so
  // if the generator ever stamped somewhere else they would decorate and defend
  // empty ground.
  it('stands both towers as HUT tiles, exactly where towerSites says', () => {
    for (const seed of SEEDS.slice(0, 40)) {
      const grid = bastion(seed);
      const sites = towerSites(MAP_ROWS, MAP_COLS);
      for (const site of sites) {
        expect(grid[site.row]?.[site.col], `seed ${seed} at ${site.row},${site.col}`).toBe(TILE.HUT);
      }
      expect(grid.flat().filter((t) => t === TILE.HUT), `seed ${seed}`).toHaveLength(2);
      const [north, south] = sites;
      expect(south.row - north.row, 'the towers are too close to read as two').toBeGreaterThan(4);
    }
  });

  // A tower inside the spawn block would be erased by the pass that keeps a
  // fresh spawn out of terrain, which is what towerSpread's floor of 4 exists
  // to prevent.
  it('stands the towers clear of the spawn block, so nothing clears them away', () => {
    for (const site of towerSites(MAP_ROWS, MAP_COLS)) {
      expect(isSpawnZone(site.row, site.col, MAP_ROWS)).toBe(false);
      expect(isArenaBorder(site.row, site.col, MAP_ROWS, MAP_COLS)).toBe(false);
    }
  });

  // Read on a bare map, with no scatter to confuse rubble for masonry: the
  // barrier is two courses, of rock, standing in one unbroken run.
  it('raises a barrier of exactly two columns of rock, and nothing else', () => {
    const grid = bastion(1, 0);
    const [first, second] = barrierCols(MAP_COLS);
    const left = rockRows(grid, first);
    const right = rockRows(grid, second);
    expect(isRun(left), `col ${first} rock rows ${left.join(',')} are not one run`).toBe(true);
    expect(right, 'the two courses do not stand in the same rows').toEqual(left);

    // Nothing else on the map is rock except the rim: no third course, and no
    // scattered rubble at a scatter of zero.
    for (let r = 0; r < MAP_ROWS; r++)
      for (let c = 0; c < MAP_COLS; c++) {
        if (grid[r]?.[c] !== TILE.ROCK) continue;
        const barrier = (c === first || c === second) && left.includes(r);
        expect(
          barrier || isArenaBorder(r, c, MAP_ROWS, MAP_COLS),
          `stray rock at ${r},${c}`,
        ).toBe(true);
      }
  });

  // Cover, not a wall. If this ever spans the full height the siege has nothing
  // to come round and the map is a corridor with a dead end.
  it('leaves the barrier open at the top and the bottom', () => {
    const grid = bastion(1, 0);
    for (const col of barrierCols(MAP_COLS)) {
      const rows = rockRows(grid, col);
      const top = rows[0]!;
      const bottom = rows[rows.length - 1]!;
      expect(top, 'the barrier reaches the top rim').toBeGreaterThan(1);
      expect(bottom, 'the barrier reaches the bottom rim').toBeLessThan(MAP_ROWS - 2);
      expect(tilePassable(grid[top - 1]?.[col]), `no gap above the barrier in col ${col}`).toBe(
        true,
      );
      expect(tilePassable(grid[bottom + 1]?.[col]), `no gap below the barrier in col ${col}`).toBe(
        true,
      );
      // Still tall enough to be worth going round rather than a stub of wall.
      expect(rows.length).toBeGreaterThan(MAP_ROWS / 2);
    }
  });

  // The gaps have to survive the scatter pass, which is the part a seed can
  // ruin. Both flanks, every sampled seed, with noise clustering the cover.
  it('keeps a way round the barrier at both ends whatever the seed scatters', () => {
    for (const seed of SEEDS) {
      const grid = bastion(seed, SHAPE.scatter, true);
      for (const col of barrierCols(MAP_COLS)) {
        const openAbove = Array.from({ length: Math.floor(MAP_ROWS / 3) }, (_, r) =>
          tilePassable(grid[r]?.[col]),
        ).some(Boolean);
        const openBelow = Array.from({ length: Math.floor(MAP_ROWS / 3) }, (_, i) =>
          tilePassable(grid[MAP_ROWS - 1 - i]?.[col]),
        ).some(Boolean);
        expect(openAbove, `seed ${seed} closed the top flank in col ${col}`).toBe(true);
        expect(openBelow, `seed ${seed} closed the bottom flank in col ${col}`).toBe(true);
      }
    }
  });

  it('stands the barrier between the towers and the corridor, never behind them', () => {
    const [first, second] = barrierCols(MAP_COLS);
    for (const site of towerSites(MAP_ROWS, MAP_COLS)) {
      expect(first, 'the barrier stands level with or behind a tower').toBeGreaterThan(site.col);
    }
    expect(second, 'the barrier stands inside the crow corridor').toBeLessThan(MAP_COLS - 2);
    expect(isCrowCorridor(second, MAP_COLS)).toBe(false);
  });

  it('keeps the crow corridor clear, the way every map the siege enters must', () => {
    for (const seed of SEEDS.slice(0, 40)) {
      const grid = bastion(seed, SHAPE.scatter, true);
      for (let r = 0; r < MAP_ROWS; r++)
        for (let c = 0; c < MAP_COLS; c++) {
          if (!isCrowCorridor(c, MAP_COLS)) continue;
          expect(tilePassable(grid[r]?.[c]), `seed ${seed} blocked the corridor at ${r},${c}`).toBe(
            true,
          );
        }
    }
  });

  it('walls the rim in stone, so nothing walks off the grid', () => {
    for (const seed of SEEDS.slice(0, 40)) {
      const grid = bastion(seed, SHAPE.scatter, true);
      for (let r = 0; r < MAP_ROWS; r++)
        for (let c = 0; c < MAP_COLS; c++) {
          if (!isArenaBorder(r, c, MAP_ROWS, MAP_COLS)) continue;
          expect(grid[r]?.[c], `seed ${seed} broke the rim at ${r},${c}`).toBe(TILE.ROCK);
        }
    }
  });

  // A siege ground has no pond: water would stop a body, and a pool across a
  // flank lane is the invariant above failing in a way that looks like scenery.
  it('never floods a single tile, at any seed', () => {
    for (const seed of SEEDS) {
      expect(bastion(seed).flat(), `seed ${seed}`).not.toContain(TILE.WATER);
      expect(bastion(seed, SHAPE.scatter, true).flat(), `seed ${seed} (noise)`).not.toContain(
        TILE.WATER,
      );
    }
  });

  it('scatters cover at the density it was asked for, and none at all at zero', () => {
    const cover = (grid: TileGrid): number =>
      grid.flat().filter((t) => t === TILE.TREE).length +
      grid.flat().filter((t) => t === TILE.ROCK).length;
    const bare = bastion(7, 0);
    expect(bare.flat()).not.toContain(TILE.TREE);
    for (const seed of SEEDS.slice(0, 20)) {
      const dressed = bastion(seed, SHAPE.scatter);
      expect(cover(dressed), `seed ${seed} scattered nothing`).toBeGreaterThan(cover(bare));
      // Sparse: a battlefield, not a forest. The rim and the barrier are most
      // of `bare`, so this bounds the scatter itself rather than the furniture.
      expect(cover(dressed) - cover(bare), `seed ${seed} scattered a thicket`).toBeLessThan(
        MAP_ROWS * MAP_COLS * 0.2,
      );
    }
    expect(cover(bastion(7, 0.3))).toBeGreaterThan(cover(bastion(7, SHAPE.scatter)));
  });

  it('grows both rubble and scrub, so the cover is not all one thing', () => {
    const kinds = new Set(SEEDS.slice(0, 20).flatMap((seed) => bastion(seed).flat()));
    expect(kinds).toEqual(new Set([TILE.EMPTY, TILE.ROCK, TILE.TREE, TILE.HUT]));
  });

  // The sane answer at 5x7: nothing. Every interior column is either the spawn
  // block (1-4) or the crow corridor (5-6), and both are cleared by contract,
  // so there is nowhere left to stand a tower or a barrier that would not be
  // erased. A walled empty yard is the right degenerate map — the maze's answer
  // was solid rock and the cavern's was open floor, and open is the safer of
  // the two here for the same reason it was there: nothing can spawn inside a
  // wall that is not there.
  it('degrades to a walled empty yard on a grid too small to fortify', () => {
    const tiny = new BastionTerrain(SHAPE).generate(5, 7, mulberry32(1), null);
    expect(tiny).toHaveLength(5);
    expect(tiny[0]).toHaveLength(7);
    for (let r = 0; r < 5; r++)
      for (let c = 0; c < 7; c++) {
        const want = isArenaBorder(r, c, 5, 7) ? TILE.ROCK : TILE.EMPTY;
        expect(tiny[r]?.[c], `tiny grid at ${r},${c}`).toBe(want);
      }
    expect(tiny.flat()).not.toContain(TILE.HUT);
    expect(tiny.flat()).not.toContain(TILE.WATER);
  });
});

describe('towerSites', () => {
  it('puts the two towers in the tower band, above and below the centre line', () => {
    const [north, south] = towerSites(MAP_ROWS, MAP_COLS);
    const mid = Math.floor(MAP_ROWS / 2);
    expect(north.row).toBeLessThan(mid);
    expect(south.row).toBeGreaterThan(mid);
    for (const site of [north, south]) {
      expect(site.col).toBeGreaterThanOrEqual(2);
      expect(site.col).toBeLessThanOrEqual(3);
      expect(site.row).toBeGreaterThan(0);
      expect(site.row).toBeLessThan(MAP_ROWS - 1);
    }
  });

  it('answers with two sites even on a grid with no room for a tower', () => {
    const [north, south] = towerSites(5, 7);
    for (const site of [north, south]) {
      expect(site.row).toBeGreaterThan(0);
      expect(site.row).toBeLessThan(4);
    }
  });
});

describe('barrierCols', () => {
  it('names two adjacent columns', () => {
    const [first, second] = barrierCols(MAP_COLS);
    expect(second).toBe(first + 1);
  });

  // Holds at every width, including the ones where nothing gets built: the
  // barrier is cover between the towers and the corridor or it is not a
  // barrier, so the answer is never allowed to land behind them.
  it('never names a column at or behind the towers, at any width', () => {
    for (let cols = 5; cols <= 60; cols++) {
      const [first] = barrierCols(cols);
      const [tower] = towerSites(21, cols);
      expect(first, `${cols} columns`).toBeGreaterThan(tower.col);
    }
  });
});
