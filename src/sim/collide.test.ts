import { describe, expect, it } from 'vitest';

import { MAP_COLS, MAP_ROWS, TILE_SIZE, Terrain } from './arena-map';
import { bodyFits, slide } from './collide';
import { TILE, TileMap, type TileId } from './tilemap';

const RADIUS = 8;

/** Open ground with a single solid tile wherever a test puts one. */
function withWall(row: number, col: number, tile: TileId = TILE.ROCK): Terrain {
  const t = new Terrain(new TileMap(MAP_ROWS, MAP_COLS));
  t.map.set(row, col, tile);
  return t;
}

/** The centre of a tile, in world pixels. */
const centre = (row: number, col: number) => ({
  x: col * TILE_SIZE + TILE_SIZE / 2,
  y: row * TILE_SIZE + TILE_SIZE / 2,
});

describe('bodyFits', () => {
  it('accepts open ground', () => {
    const p = centre(5, 5);
    expect(bodyFits(withWall(9, 9), p.x, p.y, RADIUS)).toBe(true);
  });

  it('refuses a spot whose centre is inside rock', () => {
    const p = centre(5, 5);
    expect(bodyFits(withWall(5, 5), p.x, p.y, RADIUS)).toBe(false);
  });

  it('refuses a spot where only the edge overlaps, not the centre', () => {
    // Centre sits in the open tile to the left, but the body's right edge
    // reaches into the rock. Testing the centre alone would allow this.
    const wall = centre(5, 5);
    const x = wall.x - TILE_SIZE / 2 - RADIUS / 2;
    expect(withWall(5, 5).walkable(x, wall.y)).toBe(true);
    expect(bodyFits(withWall(5, 5), x, wall.y, RADIUS)).toBe(false);
  });
});

describe('slide', () => {
  const open = () => withWall(19, 31);

  it('takes a step across open ground', () => {
    const p = centre(5, 5);
    expect(slide(open(), p.x, p.y, 4, 3, RADIUS)).toEqual({ x: p.x + 4, y: p.y + 3 });
  });

  it('keeps the axis that was clear when the other is blocked', () => {
    const terrain = withWall(5, 6);            // wall to the right
    const p = centre(5, 5);
    const moved = slide(terrain, p.x, p.y, 40, 5, RADIUS);
    expect(moved.x).toBe(p.x);                 // stopped horizontally
    expect(moved.y).toBe(p.y + 5);             // still slid vertically
  });

  it('slides along a wall instead of catching on it', () => {
    const terrain = withWall(5, 6);
    const p = centre(5, 5);
    // Pushing diagonally into the wall should still travel down the wall.
    let { x, y } = p;
    for (let i = 0; i < 10; i++) ({ x, y } = slide(terrain, x, y, 3, 3, RADIUS));
    expect(y).toBeGreaterThan(p.y + 20);
  });

  it('stands still when both axes are blocked', () => {
    const terrain = new Terrain(new TileMap(MAP_ROWS, MAP_COLS));
    terrain.map.set(5, 6, TILE.ROCK);
    terrain.map.set(6, 5, TILE.ROCK);
    const p = centre(5, 5);
    expect(slide(terrain, p.x, p.y, 40, 40, RADIUS)).toEqual(p);
  });

  it('treats water as a wall, since a body cannot wade', () => {
    const terrain = withWall(5, 6, TILE.WATER);
    const p = centre(5, 5);
    expect(slide(terrain, p.x, p.y, 40, 0, RADIUS).x).toBe(p.x);
  });

  it('lets a body cross ash, which is a hut that has burnt down', () => {
    const terrain = withWall(5, 6, TILE.ASH);
    const p = centre(5, 5);
    expect(slide(terrain, p.x, p.y, 20, 0, RADIUS).x).toBe(p.x + 20);
  });
});
