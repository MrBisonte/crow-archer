import { describe, expect, it } from 'vitest';

import { MAP_COLS, MAP_ROWS } from './arena-map';
import {
  BastionTerrain,
  barrierCols,
  towerSites,
  type BarrierSegment,
  type TowerSite,
} from './bastion-terrain';
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

/** The barrier as the generator reports it, at the size the game ships. */
const SEGMENTS = barrierCols(MAP_ROWS, MAP_COLS);

/** The band of columns the barrier occupies, from its westmost course to its eastmost. */
const BARRIER_WEST = Math.min(...SEGMENTS.map((s) => s.cols[0]));
const BARRIER_EAST = Math.max(...SEGMENTS.map((s) => s.cols[1]));

/** Every column any section stands in, west to east, each named once. */
const BARRIER_COLUMNS = [...new Set(SEGMENTS.flatMap((s) => [s.cols[0], s.cols[1]]))].sort(
  (a, b) => a - b,
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

const towersReachable = (grid: TileGrid): boolean => {
  const seen = walkableFromCorridor(grid);
  return towerSites(MAP_ROWS, MAP_COLS).every((site) => towerReachable(grid, site, seen));
};

/**
 * The ways through the barrier: every maximal run of rows on which the whole
 * width of the barrier band is passable.
 *
 * Read off the tiles rather than off the segment list on purpose. A body
 * crossing from the corridor to the towers has to cross this band somewhere,
 * and these runs are the only rows on which it can, so counting them counts the
 * routes the map actually offers rather than the ones it claims.
 */
function waysThrough(grid: TileGrid): number[][] {
  const clear = (r: number): boolean => {
    for (let c = BARRIER_WEST; c <= BARRIER_EAST; c++) {
      if (!tilePassable(grid[r]?.[c])) return false;
    }
    return true;
  };
  const runs: number[][] = [];
  let run: number[] = [];
  for (let r = 1; r < MAP_ROWS - 1; r++) {
    if (clear(r)) run.push(r);
    else if (run.length > 0) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length > 0) runs.push(run);
  return runs;
}

/** The same grid with one way through walled off, so "more than one" can be tested. */
const sealing = (grid: TileGrid, rows: readonly number[]): TileGrid => {
  const copy = grid.map((row) => [...row]);
  for (const r of rows) {
    for (let c = BARRIER_WEST; c <= BARRIER_EAST; c++) copy[r]![c] = TILE.ROCK;
  }
  return copy;
};

/**
 * The ways through as geometry alone lays them out, with no scatter to narrow
 * one. This is the list the sealing test walls off one at a time: rubble is
 * what those seals are meant to survive, so the seals themselves are cut from
 * the bare shape.
 */
const WAYS = waysThrough(bastion(1, 0));

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

/** Every row a section stands on, whichever of its two courses is asked about. */
const rowsOf = (segment: BarrierSegment): number[] =>
  Array.from({ length: segment.lastRow - segment.firstRow + 1 }, (_, i) => segment.firstRow + i);

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

  // Segmenting the wall was meant to buy depth, and depth is worth nothing if
  // every body still funnels through one place. Measured by walling off one
  // way through at a time and asking the flood fill again: if any single seal
  // strands a tower, that way through was the only one and the barrier is a
  // wall with a door in it.
  it('offers more than one way in: sealing any single one leaves both towers reachable', () => {
    expect(WAYS.length, `only ${WAYS.length} way(s) through the barrier`).toBeGreaterThan(2);
    for (const way of WAYS) {
      expect(towersReachable(sealing(bastion(1, 0), way)), `sealing rows ${way.join(',')}`).toBe(
        true,
      );
      // And it has to survive a seed's rubble on top of the seal, which is the
      // case the reserved skeleton exists for.
      for (const seed of SEEDS.slice(0, 25)) {
        expect(
          towersReachable(sealing(bastion(seed, SHAPE.scatter, true), way)),
          `seed ${seed} with rows ${way.join(',')} sealed`,
        ).toBe(true);
      }
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

  // Read on a bare map, with no scatter to confuse rubble for masonry: every
  // section is two courses, of rock, standing in one unbroken run, and nothing
  // else on the ground is rock.
  it('raises every section as two courses of rock, and raises nothing else', () => {
    const grid = bastion(1, 0);
    const masonry = new Set<string>();
    for (const segment of SEGMENTS) {
      const [west, east] = segment.cols;
      const want = rowsOf(segment);
      for (const col of [west, east]) {
        const built = rockRows(grid, col).filter(
          (r) => r >= segment.firstRow && r <= segment.lastRow,
        );
        expect(isRun(built), `col ${col} rows ${built.join(',')} are not one run`).toBe(true);
        expect(built, `col ${col} does not stand in the rows the segment claims`).toEqual(want);
        for (const r of want) masonry.add(`${r},${col}`);
      }
      expect(east, 'a section is not two adjacent courses').toBe(west + 1);
    }

    // No fourth course, and no scattered rubble at a scatter of zero.
    for (let r = 0; r < MAP_ROWS; r++)
      for (let c = 0; c < MAP_COLS; c++) {
        if (grid[r]?.[c] !== TILE.ROCK) continue;
        expect(
          masonry.has(`${r},${c}`) || isArenaBorder(r, c, MAP_ROWS, MAP_COLS),
          `stray rock at ${r},${c}`,
        ).toBe(true);
      }
  });

  // Cover, not a wall. If any section ever spanned the full height the siege
  // would have nothing to come round and the map would be a corridor with a
  // dead end.
  it('leaves every section short of both rims, and open above and below', () => {
    const grid = bastion(1, 0);
    for (const segment of SEGMENTS) {
      const height = segment.lastRow - segment.firstRow + 1;
      expect(height, 'a section spans the full height').toBeLessThan(MAP_ROWS - 2);
      expect(height, 'a section is a wall, not cover').toBeLessThan(MAP_ROWS / 2);
      expect(height, 'a section is a pebble, not cover').toBeGreaterThanOrEqual(2);
      expect(segment.firstRow, 'a section reaches the top rim').toBeGreaterThan(1);
      expect(segment.lastRow, 'a section reaches the bottom rim').toBeLessThan(MAP_ROWS - 2);
      for (const col of segment.cols) {
        expect(
          tilePassable(grid[segment.firstRow - 1]?.[col]),
          `no gap above the section in col ${col}`,
        ).toBe(true);
        expect(
          tilePassable(grid[segment.lastRow + 1]?.[col]),
          `no gap below the section in col ${col}`,
        ).toBe(true);
      }
    }
  });

  // The gaps have to survive the scatter pass, which is the part a seed can
  // ruin. Both flanks, every barrier column, every sampled seed, with noise
  // clustering the cover.
  it('keeps a way round the barrier at both ends whatever the seed scatters', () => {
    for (const seed of SEEDS) {
      const grid = bastion(seed, SHAPE.scatter, true);
      for (const col of BARRIER_COLUMNS) {
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

  // The new half of the same promise. The gaps between the sections are what
  // makes three sections three sections, so rubble is not allowed to bridge one
  // back into a wall: the generator reserves them across the barrier's width
  // before it scatters anything.
  it('keeps the gaps between the sections open whatever the seed scatters', () => {
    const between = WAYS.slice(1, -1);
    expect(between.length, 'no gap between the sections at all').toBeGreaterThan(0);
    for (const seed of SEEDS) {
      const grid = bastion(seed, SHAPE.scatter, true);
      for (const way of between)
        for (const r of way)
          for (let c = BARRIER_WEST; c <= BARRIER_EAST; c++) {
            expect(
              tilePassable(grid[r]?.[c]),
              `seed ${seed} bridged the gap between sections at ${r},${c}`,
            ).toBe(true);
          }
    }
  });

  it('stands every section between the towers and the corridor, never behind them', () => {
    for (const segment of SEGMENTS) {
      for (const site of towerSites(MAP_ROWS, MAP_COLS)) {
        expect(
          segment.cols[0],
          'a section stands level with or behind a tower',
        ).toBeGreaterThan(site.col);
      }
      expect(segment.cols[1], 'a section stands inside the crow corridor').toBeLessThan(
        MAP_COLS - 2,
      );
      expect(isCrowCorridor(segment.cols[1], MAP_COLS)).toBe(false);
    }
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
    expect(barrierCols(5, 7), 'a 5x7 grid claimed room for a barrier').toEqual([]);
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
  it('names three sections, each two adjacent columns wide', () => {
    expect(SEGMENTS).toHaveLength(3);
    for (const segment of SEGMENTS) expect(segment.cols[1]).toBe(segment.cols[0] + 1);
  });

  // The whole point of the redesign, asserted rather than assumed. One straight
  // wall is one offset; a barrier with depth is at least two.
  it('stands the sections at two distinct column offsets', () => {
    const offsets = new Set(SEGMENTS.map((s) => s.cols[0]));
    expect(offsets.size, `every section stands in column ${[...offsets][0]}`).toBeGreaterThanOrEqual(
      2,
    );
  });

  // The chevron, read as an ordering: nearest the defence in the middle,
  // stepping away from it above and below.
  it('keeps the middle section nearest the towers and the flanks forward of it', () => {
    const [top, middle, bottom] = SEGMENTS as [BarrierSegment, BarrierSegment, BarrierSegment];
    expect(middle.cols[0], 'the middle section is not nearest the towers').toBeLessThan(
      top.cols[0],
    );
    expect(middle.cols[0], 'the middle section is not nearest the towers').toBeLessThan(
      bottom.cols[0],
    );
    expect(top.cols[0], 'the two flanks stand at different offsets').toBe(bottom.cols[0]);
    // And it is the middle one by row as well as by name.
    const mid = Math.floor(MAP_ROWS / 2);
    expect(middle.firstRow).toBeLessThanOrEqual(mid);
    expect(middle.lastRow).toBeGreaterThanOrEqual(mid);
  });

  it('leaves open rows between one section and the next', () => {
    for (let i = 1; i < SEGMENTS.length; i++) {
      const above = SEGMENTS[i - 1]!;
      const below = SEGMENTS[i]!;
      expect(
        below.firstRow - above.lastRow - 1,
        `sections ${i - 1} and ${i} touch`,
      ).toBeGreaterThanOrEqual(1);
    }
  });

  it('is a pure function of the grid size', () => {
    expect(barrierCols(MAP_ROWS, MAP_COLS)).toEqual(barrierCols(MAP_ROWS, MAP_COLS));
  });

  // Holds at every width, including the ones where nothing gets built: the
  // barrier is cover between the towers and the corridor or it is not a
  // barrier, so no section is ever allowed to land behind them.
  it('never names a column at or behind the towers, at any width', () => {
    for (let cols = 5; cols <= 60; cols++) {
      const [tower] = towerSites(21, cols);
      for (const segment of barrierCols(21, cols)) {
        expect(segment.cols[0], `${cols} columns`).toBeGreaterThan(tower.col);
        expect(segment.cols[1], `${cols} columns`).toBeLessThan(cols - 2);
      }
    }
  });

  // Cover at every size it agrees to build at, never a wall: no section may
  // reach either rim, and the sections may never overlap each other.
  it('never lets a section span the full height, at any size', () => {
    for (let rows = 5; rows <= 45; rows++) {
      const segments = barrierCols(rows, 33);
      for (const segment of segments) {
        expect(segment.firstRow, `${rows} rows`).toBeGreaterThan(0);
        expect(segment.lastRow, `${rows} rows`).toBeLessThan(rows - 1);
        expect(segment.lastRow - segment.firstRow + 1, `${rows} rows`).toBeLessThan(rows - 2);
      }
      for (let i = 1; i < segments.length; i++) {
        expect(segments[i]!.firstRow, `${rows} rows`).toBeGreaterThan(segments[i - 1]!.lastRow);
      }
    }
  });
});
