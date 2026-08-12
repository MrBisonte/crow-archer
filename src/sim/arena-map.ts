/**
 * The battlefield: terrain built from a seed, and the questions the simulation
 * asks of it.
 *
 * The map never crosses the network. Both sides build it from the four bytes in
 * MATCH_START, which is why generation has to be deterministic down to the last
 * tile: the server decides what you walked into, and your client has to have
 * drawn the same thing.
 *
 * Walking and flying ask different questions. A body cannot enter water; an
 * arrow flies over it and is only stopped by something tall. Keeping those two
 * rules apart here means neither is re-decided at a call site.
 */

import { generateGrid, type Noise2D } from './mapgen';
import { mulberry32 } from './rng';
import { TILE, TileMap, tilePassable, type TileId } from './tilemap';

/** How much of single player's clutter a duel arena keeps. */
export const BATTLE_DENSITY = 0.45;

/** Pixels per tile. The arena's pixel size follows from this and the grid. */
export const TILE_SIZE = 32;

/** Grid size. Matches ARENA_W and ARENA_H in arena.ts, in tiles. */
export const MAP_COLS = 33;
export const MAP_ROWS = 21;

/**
 * Builds a noise source from the same seed the grid uses.
 *
 * Injected rather than imported here so the simulation stays free of the
 * dependency, and so a test can generate terrain without it.
 */
export type NoiseFactory = (seed: number) => Noise2D | null;

/**
 * Terrain for one match.
 *
 * It owns the grid and answers in world pixels, because everything that asks is
 * working in pixels and converting at each call site is how the two drift.
 */
export class Terrain {
  readonly map: TileMap;

  constructor(map: TileMap) {
    this.map = map;
  }

  /**
   * Builds the terrain a seed describes. The same seed always gives this map.
   *
   * The clutter is thinned from what single player uses. That map was drawn for
   * crows flying a corridor, and measured, a third of its tiles stop an arrow:
   * two players 400 px apart almost never have a clear line. Cover is worth
   * having and a thicket is not.
   */
  static fromSeed(seed: number, noise: NoiseFactory): Terrain {
    const map = new TileMap(MAP_ROWS, MAP_COLS);
    map.reset(generateGrid(MAP_ROWS, MAP_COLS, mulberry32(seed), noise(seed), BATTLE_DENSITY));
    return new Terrain(map);
  }

  /** The tile covering a point, or undefined outside the grid. */
  tileAt(x: number, y: number): TileId | undefined {
    return this.map.get(Math.floor(y / TILE_SIZE), Math.floor(x / TILE_SIZE));
  }

  /**
   * Can a body stand here? Water counts as solid: the legacy game does not let
   * a player wade, and a swimming archer is a different game.
   */
  walkable(x: number, y: number): boolean {
    return tilePassable(this.tileAt(x, y));
  }

  /**
   * Does terrain stop a projectile here? Water does not: an arrow crosses a
   * pond, and only rock, trees and huts are tall enough to catch one.
   *
   * Off the grid counts as solid, the way the legacy game does it, so the edge
   * of the world stops a shot without anything having to special-case it.
   */
  blocksShot(x: number, y: number): boolean {
    const tile = this.tileAt(x, y);
    if (tile === undefined) return true;
    return tile === TILE.ROCK || tile === TILE.TREE || tile === TILE.HUT;
  }

  /** Would a thrown thing sink here? Only dynamite cares, and it fizzles out. */
  drowns(x: number, y: number): boolean {
    return this.tileAt(x, y) === TILE.WATER;
  }

  /**
   * Burns everything that burns within a radius down to ash.
   *
   * Trees and huts go; rock and water do not, because no blast shifts either.
   * A radius rather than a point, since a blast is a radius: dynamite that
   * cleared exactly one tile of a forest read as having missed.
   */
  burnArea(x: number, y: number, radius: number): void {
    const reach = Math.ceil(radius / TILE_SIZE);
    const r0 = Math.floor(y / TILE_SIZE);
    const c0 = Math.floor(x / TILE_SIZE);
    for (let dr = -reach; dr <= reach; dr++) {
      for (let dc = -reach; dc <= reach; dc++) {
        const r = r0 + dr;
        const c = c0 + dc;
        // Tile centres, so a tile only burns when the blast really covers it.
        const cx = c * TILE_SIZE + TILE_SIZE / 2;
        const cy = r * TILE_SIZE + TILE_SIZE / 2;
        if ((cx - x) ** 2 + (cy - y) ** 2 > radius * radius) continue;
        const tile = this.map.get(r, c);
        if (tile === TILE.HUT || tile === TILE.TREE) this.map.set(r, c, TILE.ASH);
      }
    }
  }
}
