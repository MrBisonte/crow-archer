import { describe, expect, it } from 'vitest';

import { TILE, TileMap, type TileGrid } from './tilemap';

describe('TileMap', () => {
  it('set fires onChange with old and new tile', () => {
    const m = new TileMap(4, 4);
    const events: [number, number, number, number][] = [];
    m.onChange((r, c, oldT, newT) => events.push([r, c, oldT, newT]));
    m.set(1, 1, TILE.ROCK);
    expect(events).toEqual([[1, 1, TILE.EMPTY, TILE.ROCK]]);
    expect(m.get(1, 1)).toBe(TILE.ROCK);
  });

  it('set to the same tile is a no-op', () => {
    const m = new TileMap(4, 4);
    m.set(1, 1, TILE.ROCK);
    const events: unknown[] = [];
    m.onChange((...e) => events.push(e));
    m.set(1, 1, TILE.ROCK);
    expect(events).toHaveLength(0);
  });

  it('set ignores out-of-bounds', () => {
    const m = new TileMap(4, 4);
    const events: unknown[] = [];
    m.onChange((...e) => events.push(e));
    m.set(-1, 0, TILE.ROCK);
    m.set(0, 99, TILE.ROCK);
    expect(events).toHaveLength(0);
  });

  it('reset fires onReset and swaps the grid', () => {
    const m = new TileMap(4, 4);
    let resets = 0;
    m.onReset(() => resets++);
    const grid: TileGrid = Array.from({ length: 4 }, () => new Array(4).fill(TILE.WATER));
    m.reset(grid);
    expect(resets).toBe(1);
    expect(m.get(3, 3)).toBe(TILE.WATER);
  });
});
