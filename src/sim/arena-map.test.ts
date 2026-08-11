import { describe, expect, it } from 'vitest';

import { MAP_COLS, MAP_ROWS, TILE_SIZE, Terrain } from './arena-map';
import { pickSpawns } from './spawns';
import { TILE, TileMap } from './tilemap';

/** No noise source, which the generator supports and which keeps tests quick. */
const flat: () => null = () => null;

/** A map that is empty everywhere except where a test puts something. */
function blank(): Terrain {
  const map = new TileMap(MAP_ROWS, MAP_COLS);
  return new Terrain(map);
}

describe('Terrain', () => {
  describe('built from a seed', () => {
    it('gives the same map for the same seed, on any machine', () => {
      const a = Terrain.fromSeed(12345, flat);
      const b = Terrain.fromSeed(12345, flat);
      expect(a.map.grid).toEqual(b.map.grid);
    });

    it('gives a different map for a different seed', () => {
      const a = Terrain.fromSeed(1, flat);
      const b = Terrain.fromSeed(2, flat);
      expect(a.map.grid).not.toEqual(b.map.grid);
    });

    it('is the size the arena expects', () => {
      const t = Terrain.fromSeed(7, flat);
      expect(t.map.rows).toBe(MAP_ROWS);
      expect(t.map.cols).toBe(MAP_COLS);
    });
  });

  describe('asking what is where', () => {
    it('reads a point in pixels as the tile covering it', () => {
      const t = blank();
      t.map.set(3, 5, TILE.ROCK);
      expect(t.tileAt(5 * TILE_SIZE + 1, 3 * TILE_SIZE + 1)).toBe(TILE.ROCK);
    });

    it('has nothing outside the grid', () => {
      expect(blank().tileAt(-1, -1)).toBeUndefined();
    });
  });

  describe('walking', () => {
    it('lets a body cross open ground', () => {
      expect(blank().walkable(100, 100)).toBe(true);
    });

    it('lets a body cross ash, which is what a burnt hut leaves', () => {
      const t = blank();
      t.map.set(2, 2, TILE.ASH);
      expect(t.walkable(2 * TILE_SIZE + 4, 2 * TILE_SIZE + 4)).toBe(true);
    });

    it.each([
      ['rock', TILE.ROCK],
      ['a tree', TILE.TREE],
      ['a hut', TILE.HUT],
      ['water', TILE.WATER],
    ])('stops a body at %s', (_name, tile) => {
      const t = blank();
      t.map.set(2, 2, tile);
      expect(t.walkable(2 * TILE_SIZE + 4, 2 * TILE_SIZE + 4)).toBe(false);
    });
  });

  describe('shooting', () => {
    it('lets an arrow cross open ground', () => {
      expect(blank().blocksShot(100, 100)).toBe(false);
    });

    it('lets an arrow cross water, which a body cannot wade', () => {
      const t = blank();
      t.map.set(2, 2, TILE.WATER);
      const x = 2 * TILE_SIZE + 4;
      expect(t.walkable(x, x)).toBe(false);
      expect(t.blocksShot(x, x)).toBe(false);
    });

    it.each([
      ['rock', TILE.ROCK],
      ['a tree', TILE.TREE],
      ['a hut', TILE.HUT],
    ])('stops an arrow at %s', (_name, tile) => {
      const t = blank();
      t.map.set(2, 2, tile);
      expect(t.blocksShot(2 * TILE_SIZE + 4, 2 * TILE_SIZE + 4)).toBe(true);
    });
  });

  describe('burning', () => {
    it('turns a hut to ash, which can then be walked over', () => {
      const t = blank();
      t.map.set(4, 4, TILE.HUT);
      const x = 4 * TILE_SIZE + 4;
      t.burn(x, x);
      expect(t.tileAt(x, x)).toBe(TILE.ASH);
      expect(t.walkable(x, x)).toBe(true);
    });

    it('leaves rock alone, which no blast is going to shift', () => {
      const t = blank();
      t.map.set(4, 4, TILE.ROCK);
      const x = 4 * TILE_SIZE + 4;
      t.burn(x, x);
      expect(t.tileAt(x, x)).toBe(TILE.ROCK);
    });
  });
});

describe('pickSpawns', () => {
  const terrain = () => Terrain.fromSeed(20260810, flat);

  it('gives one spawn per seat', () => {
    expect(pickSpawns(terrain(), 3)).toHaveLength(3);
  });

  it('puts every seat somewhere it can stand', () => {
    const t = terrain();
    for (const s of pickSpawns(t, 4)) expect(t.walkable(s.x, s.y)).toBe(true);
  });

  it('keeps the two sides apart, so nobody starts inside the other team', () => {
    const [a, b] = pickSpawns(terrain(), 2);
    expect(Math.abs(a!.x - b!.x)).toBeGreaterThan(MAP_COLS * TILE_SIZE * 0.4);
  });

  it('gives every seat its own spot in a full four-player match', () => {
    const spots = pickSpawns(terrain(), 4).map((s) => `${s.x},${s.y}`);
    expect(new Set(spots).size).toBe(4);
  });

  it('is the same on both machines, given the same map', () => {
    expect(pickSpawns(terrain(), 4)).toEqual(pickSpawns(terrain(), 4));
  });

  it('walks out of a blocked anchor rather than spawning inside rock', () => {
    const t = blank();
    // Bury the first anchor's tile and its whole neighbourhood.
    const col = Math.floor(0.18 * MAP_COLS);
    const row = Math.floor(0.28 * MAP_ROWS);
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      t.map.set(row + dr, col + dc, TILE.ROCK);
    }
    const [spawn] = pickSpawns(t, 1);
    expect(t.walkable(spawn!.x, spawn!.y)).toBe(true);
  });
});
