/**
 * The bastion tiles read as data, never as a picture.
 *
 * These painters have no canvas in them, which is the point: a tile is a 16x16
 * array of colour strings until something blits it, so every property that
 * actually matters — it covers its tile, its colours survive a fillStyle, it
 * paints the same pixels twice, it does not paint every tile of the map
 * identically — is a question about an array and needs no browser to ask.
 *
 * What a detail pass on tile art quietly breaks is a short list: a painter
 * stops filling its tile and punches a hole in the map, a seed branch is added
 * and the tile stops being deterministic, a seed is ignored and a field of one
 * tile visibly repeats, or two painters converge until a player cannot tell a
 * wall from a tower. There is one test here for each of those.
 */

import { describe, expect, it } from 'vitest';

import {
  BASTION_PALETTE,
  BASTION_TILE_GRID,
  paintBastionAsh,
  paintBastionGround,
  paintBastionSapling,
  paintBastionStone,
  paintBastionTower,
  paintBastionTree,
  paintBastionWater,
} from './bastion-tiles';
import { countFilled, gridColours, gridSize, invalidColours, isHexColour, raggedRows } from './grid-testkit';
import { makePixelGrid, type PixelGrid } from './pixel-grid';

type BastionPainter = (grid: PixelGrid, seed: number) => void;

/** Every painter, named, so each test below runs against all of them rather
 * than against whichever one was being worked on when it was written. */
const PAINTERS: ReadonlyArray<readonly [string, BastionPainter]> = [
  ['ground', paintBastionGround],
  ['stone', paintBastionStone],
  ['tower', paintBastionTower],
  ['tree', paintBastionTree],
  ['ash', paintBastionAsh],
  // Ash regrows through a sapling on this map, and TILE_THEMES is checked for
  // every tile a map can hold rather than every tile its generator emits, so
  // both of these are painted even though BastionTerrain makes neither.
  ['sapling', paintBastionSapling],
  ['water', paintBastionWater],
];

/** The seeds a per-tile check sweeps. Wider than one seed because every
 * painter branches on several different moduli, and a bug living in a `seed %
 * 7` arm is invisible to a test that only ever passes 0. */
const SEEDS = Array.from({ length: 32 }, (_, i) => i);

const paint = (painter: BastionPainter, seed: number): PixelGrid => {
  const grid = makePixelGrid(BASTION_TILE_GRID, BASTION_TILE_GRID);
  painter(grid, seed);
  return grid;
};

/** A grid as one comparable string, for telling two of them apart. */
const shapeOf = (grid: PixelGrid): string => grid.map((row) => row.join(',')).join('|');

/** How many cells a grid paints in any of the named palette colours. This is
 * how "is it made of stone" and "is it standing on earth" get asked without
 * writing coordinates into the test, which would fail on every art change
 * rather than on the ones that matter. */
const countIn = (grid: PixelGrid, keys: readonly string[]): number => {
  const wanted = new Set(keys.map((k) => BASTION_PALETTE[k]));
  let n = 0;
  for (const row of grid) for (const c of row) if (c !== null && wanted.has(c)) n++;
  return n;
};

const MASONRY = ['stone', 'stoneHi', 'stoneShade', 'mortar'] as const;
const GROUND = ['earth', 'earthDark', 'earthLit', 'gravel', 'clay'] as const;

describe('the bastion palette', () => {
  it('is all real hex colours, so every cell survives the blit', () => {
    for (const [key, value] of Object.entries(BASTION_PALETTE)) {
      expect(isHexColour(value), `${key} is ${value}`).toBe(true);
    }
  });

  // A duplicated value means one of the two names is doing no work, and the way
  // that happens is a copy-pasted line that only got half edited — so the
  // painter that reaches for the second name is silently painting the first.
  it('gives every name a colour of its own', () => {
    const values = Object.values(BASTION_PALETTE);
    expect(new Set(values).size, `duplicate colour among ${values.length} names`)
      .toBe(values.length);
  });

  it('paints at the same logical resolution as tiles.ts', () => {
    expect(BASTION_TILE_GRID).toBe(16);
  });
});

describe('bastion tile painters', () => {
  // Tiles are terrain, not sprites. A painter that leaves cells empty punches a
  // transparent hole through to the layer canvas, and nothing behind the map is
  // ever meant to show. Every painter here fills all 16 rows — including the
  // tower, whose crenellation gaps show the earth it has already painted rather
  // than being left transparent.
  it.each(PAINTERS)('fills the whole %s tile, on every seed', (name, painter) => {
    for (const seed of SEEDS) {
      const grid = paint(painter, seed);
      expect(gridSize(grid), `${name} @${seed}`).toEqual({ w: 16, h: 16 });
      // Height and width alone would pass on a grid that is ragged partway
      // down, which then fails much later as some stranger symptom.
      expect(raggedRows(grid), `${name} @${seed} has short rows`).toEqual([]);
      expect(countFilled(grid), `${name} @${seed} left cells transparent`).toBe(256);
    }
  });

  it.each(PAINTERS)('paints %s in colours a fillStyle can take', (name, painter) => {
    for (const seed of SEEDS) {
      expect(invalidColours(paint(painter, seed)), `${name} @${seed}`).toEqual([]);
    }
  });

  // The static layer paints a tile once and keeps it. If a painter were not a
  // pure function of (grid, seed), a tile would differ from the one beside it
  // for no reason a player could read, and a repaint of the same tile would
  // change the map under them.
  it.each(PAINTERS)('paints %s identically for the same seed, cell by cell', (name, painter) => {
    for (const seed of SEEDS) {
      expect(paint(painter, seed), `${name} @${seed} is not deterministic`)
        .toEqual(paint(painter, seed));
    }
  });

  // The check that catches a painter which takes a seed and ignores it. It
  // compiles, it draws, it looks right in isolation, and the map it tiles into
  // is a visibly repeating wallpaper.
  it.each(PAINTERS)('varies %s across seeds, so a field of them does not repeat', (name, painter) => {
    const shapes = new Set(SEEDS.map((seed) => shapeOf(paint(painter, seed))));
    expect(shapes.size, `${name} drew one grid for all ${SEEDS.length} seeds`)
      .toBeGreaterThan(1);
  });

  it('draws the five tiles differently, so they are told apart on sight', () => {
    for (const seed of [0, 1, 2, 3, 4, 5, 6, 7]) {
      const shapes = PAINTERS.map(([, painter]) => shapeOf(paint(painter, seed)));
      expect(new Set(shapes).size, `two painters collided on seed ${seed}`)
        .toBe(PAINTERS.length);
    }
  });
});

/**
 * The stone course and the tower are the pair most at risk of converging: they
 * are the only two masonry tiles, they share a palette, and one of them is the
 * map's barrier while the other is a building on it. "Not byte-identical" is
 * far too weak a bar for that — two tiles differing by four pixels pass it and
 * are indistinguishable at tile size.
 *
 * So the difference is asserted in the terms a player actually reads it in:
 * the barrier fills its tile edge to edge with masonry and shows no ground at
 * all, and the tower is an object standing on visible earth. That is the
 * silhouette difference, and it is the one that survives a repaint of either.
 */
/**
 * The tower is four tiles that have to add up to one building.
 *
 * Every other painter here is asked whether a tile is right on its own. This
 * one has to be asked whether four tiles agree, because the failure it can have
 * is not a bad tile: it is four perfectly good tiles that are each a whole
 * tower, which is what this painter did before it took the quadrant flags and
 * what it silently goes back to the moment anything stops passing them.
 */
describe('the tower assembles from its four quarters', () => {
  const QUADRANTS = [
    ['north-west', false, false],
    ['north-east', false, true],
    ['south-west', true, false],
    ['south-east', true, true],
  ] as const;

  const quadrant = (above: boolean, left: boolean, seed = 0): PixelGrid => {
    const grid = makePixelGrid(BASTION_TILE_GRID, BASTION_TILE_GRID);
    paintBastionTower(grid, seed, above, left);
    return grid;
  };

  it('paints a different quarter for each pair of flags', () => {
    const drawn = QUADRANTS.map(([, above, left]) => JSON.stringify(quadrant(above, left)));
    // Four towers rather than one is exactly what identical output means.
    expect(new Set(drawn).size, 'the quadrant flags changed nothing').toBe(QUADRANTS.length);
  });

  it('crowns the northern tiles and runs unbroken shaft through the southern', () => {
    // Row 0 says which half a tile is, and says it the same way in both
    // columns. The tower's topmost row is its battlements, which sit one row
    // down, so a northern tile's first row is open ground; a southern tile's
    // first row is the middle of the shaft and is solid masonry. A painter
    // ignoring `hutAbove` gives every tile open sky there -- four towers.
    const MASONRY = new Set([
      BASTION_PALETTE.stone, BASTION_PALETTE.stoneHi,
      BASTION_PALETTE.stoneShade, BASTION_PALETTE.mortar,
    ]);
    for (const [name, above, left] of QUADRANTS) {
      const top = (quadrant(above, left)[0] ?? []).filter((c) => c && MASONRY.has(c)).length;
      if (above) expect(top, `${name} has open sky where the shaft should run`).toBeGreaterThan(0);
      else expect(top, `${name} has masonry above its own battlements`).toBe(0);
    }
  });

  it('splits the door across the two southern tiles', () => {
    // The door straddles the seam: its western half is on the south-west tile's
    // eastern edge and its eastern half on the south-east tile's western edge.
    // Whole on one tile means the two halves are not lining up.
    const iron = (grid: PixelGrid, col: number): boolean =>
      grid.some((row) => row[col] === BASTION_PALETTE.iron);
    expect(iron(quadrant(true, false), BASTION_TILE_GRID - 1), 'no door on the south-west tile')
      .toBe(true);
    expect(iron(quadrant(true, true), 0), 'no door on the south-east tile').toBe(true);
  });
});

describe('the stone course against the tower', () => {
  it.each([0, 1, 2, 3, 4, 5, 6, 7])('keeps them apart on seed %i', (seed) => {
    const stone = paint(paintBastionStone, seed);
    const tower = paint(paintBastionTower, seed);

    expect(countIn(stone, MASONRY), 'the course stopped filling its tile with masonry')
      .toBeGreaterThan(240);
    expect(countIn(stone, GROUND), 'the course showed ground, so it is no longer a barrier')
      .toBe(0);

    expect(countIn(tower, GROUND), 'the tower stopped standing on visible ground')
      .toBeGreaterThan(60);
    expect(countIn(tower, MASONRY), 'the tower spread to the edges and became a wall')
      .toBeLessThan(200);
  });

  // Both are masonry and both should say so: a tower that shared no colour with
  // the wall in front of it would read as a different material on the same map.
  it('builds both out of the same stone', () => {
    const shared = [...gridColours(paint(paintBastionStone, 0))]
      .filter((c) => gridColours(paint(paintBastionTower, 0)).has(c));
    expect(shared.length).toBeGreaterThan(1);
  });
});
