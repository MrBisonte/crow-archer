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
    /** The centre of a tile, which is what burnArea measures against. */
    const at = (row: number, col: number) => ({
      x: col * TILE_SIZE + TILE_SIZE / 2,
      y: row * TILE_SIZE + TILE_SIZE / 2,
    });

    it.each([
      ['a hut', TILE.HUT],
      ['a tree', TILE.TREE],
      ['rock', TILE.ROCK],
    ])('clears %s to open ground, as the legacy blast does', (_name, tile) => {
      const t = blank();
      t.map.set(4, 4, tile);
      const p = at(4, 4);
      t.destroyArea(p.x, p.y, 40);
      expect(t.tileAt(p.x, p.y)).toBe(TILE.EMPTY);
      expect(t.walkable(p.x, p.y)).toBe(true);
    });

    it('leaves water alone, because a pond is not rubble', () => {
      const t = blank();
      t.map.set(4, 4, TILE.WATER);
      const p = at(4, 4);
      t.destroyArea(p.x, p.y, 90);
      expect(t.tileAt(p.x, p.y)).toBe(TILE.WATER);
    });

    it('clears a whole radius, not just the tile it went off on', () => {
      const t = blank();
      for (let dc = -2; dc <= 2; dc++) t.map.set(4, 4 + dc, TILE.TREE);
      const p = at(4, 4);
      t.destroyArea(p.x, p.y, 90);
      for (let dc = -2; dc <= 2; dc++) {
        expect(t.tileAt(at(4, 4 + dc).x, at(4, 4 + dc).y)).toBe(TILE.EMPTY);
      }
    });

    it('leaves what the blast did not reach', () => {
      const t = blank();
      t.map.set(4, 10, TILE.TREE);
      const p = at(4, 4);
      t.destroyArea(p.x, p.y, 90);
      expect(t.tileAt(at(4, 10).x, at(4, 10).y)).toBe(TILE.TREE);
    });
  });

  describe('burnTile', () => {
    /** The centre of a tile, which is what burnTile measures against. */
    const at = (row: number, col: number) => ({
      x: col * TILE_SIZE + TILE_SIZE / 2,
      y: row * TILE_SIZE + TILE_SIZE / 2,
    });

    it.each([
      ['a hut', TILE.HUT],
      ['a tree', TILE.TREE],
    ])('chars %s to open ground, and says so', (_name, tile) => {
      const t = blank();
      t.map.set(4, 4, tile);
      const p = at(4, 4);
      expect(t.burnTile(p.x, p.y)).toBe(true);
      expect(t.tileAt(p.x, p.y)).toBe(TILE.EMPTY);
    });

    it('does not catch rock, the one exception a blast does not make', () => {
      const t = blank();
      t.map.set(4, 4, TILE.ROCK);
      const p = at(4, 4);
      expect(t.burnTile(p.x, p.y)).toBe(false);
      expect(t.tileAt(p.x, p.y)).toBe(TILE.ROCK);
    });

    it('leaves open ground and water alone, and says nothing burned', () => {
      const t = blank();
      const p = at(4, 4);
      expect(t.burnTile(p.x, p.y)).toBe(false);
      t.map.set(5, 5, TILE.WATER);
      const w = at(5, 5);
      expect(t.burnTile(w.x, w.y)).toBe(false);
      expect(t.tileAt(w.x, w.y)).toBe(TILE.WATER);
    });

    it('only ever takes the one tile, not a radius', () => {
      const t = blank();
      for (let dc = -1; dc <= 1; dc++) t.map.set(4, 4 + dc, TILE.TREE);
      const p = at(4, 4);
      t.burnTile(p.x, p.y);
      expect(t.tileAt(at(4, 3).x, at(4, 3).y)).toBe(TILE.TREE);
      expect(t.tileAt(at(4, 5).x, at(4, 5).y)).toBe(TILE.TREE);
    });
  });

  describe('drowning', () => {
    it('sinks a thrown thing in water', () => {
      const t = blank();
      t.map.set(3, 3, TILE.WATER);
      expect(t.drowns(3 * TILE_SIZE + 4, 3 * TILE_SIZE + 4)).toBe(true);
    });

    it('does not sink one on open ground or on rock', () => {
      const t = blank();
      t.map.set(3, 3, TILE.ROCK);
      expect(t.drowns(3 * TILE_SIZE + 4, 3 * TILE_SIZE + 4)).toBe(false);
      expect(t.drowns(100, 100)).toBe(false);
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
