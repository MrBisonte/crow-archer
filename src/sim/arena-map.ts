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

import { MazeTerrain, NoiseTerrain, type MapGenerator } from './map-generators';
import { type Noise2D } from './mapgen';
import { mulberry32 } from './rng';
import { TILE, TileMap, tilePassable, type TileId } from './tilemap';

/**
 * A distinct, named map. The set is meant to grow, and every map shares a
 * real generation shape (below) and a visual theme (TILE_THEMES in
 * render/tiles.ts) — the same reason CharacterKind became a table instead of
 * a branch, not the reason GameMode stayed one.
 */
export type MapKind = 'forest' | 'castle' | 'maze';

/**
 * How each map builds its grid, one row per MapKind so a fourth map fails to
 * compile until it has a generator.
 *
 * This held a plain `{ density: number }` while every map was the same noise
 * algorithm at a different setting. The maze is not that algorithm at any
 * density, so the row became the generator itself rather than a number the
 * one generator reads. See docs/level-3-maze.md.
 *
 * forest's 0.45 is single player's own clutter thinned for a duel: that map
 * was drawn for crows flying a corridor, and measured, a third of its tiles
 * stop an arrow, so two players 400 px apart almost never have a clear line
 * otherwise. castle's density is a starting point, tuned for readable
 * pillars over a thicket. maze's braid is the fraction of dead ends reopened
 * into loops. All three are free to adjust; nothing downstream reads them.
 */
export const MAP_GEN: Record<MapKind, MapGenerator> = {
  forest: new NoiseTerrain({ density: 0.45 }),
  castle: new NoiseTerrain({ density: 0.5 }),
  maze: new MazeTerrain({ braid: 0.15 }),
};

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
   * Builds the terrain a seed describes. The same seed and kind always give
   * the same map. Defaults to 'forest', today's only map, so every existing
   * caller is unaffected by a kind existing at all.
   */
  static fromSeed(seed: number, noise: NoiseFactory, kind: MapKind = 'forest'): Terrain {
    const map = new TileMap(MAP_ROWS, MAP_COLS);
    map.reset(MAP_GEN[kind].generate(MAP_ROWS, MAP_COLS, mulberry32(seed), noise(seed)));
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
   * Clears everything solid within a radius, the way a legacy blast does.
   *
   * Rock, trees and huts all go, and they go to EMPTY rather than ash, which is
   * exactly what `explodeDynamite` does in the single-player game. Rock was
   * left standing here at first on the reasoning that no blast shifts stone;
   * the legacy game disagrees, and it is the one that decides.
   *
   * Water is untouched: a pond is not rubble.
   *
   * A radius rather than a point, since a blast is a radius. Tile centres are
   * what is measured, also as in the legacy game.
   */
  destroyArea(x: number, y: number, radius: number): void {
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
        if (tile === TILE.ROCK || tile === TILE.TREE || tile === TILE.HUT) {
          this.map.set(r, c, TILE.EMPTY);
        }
      }
    }
  }

  /**
   * Burns exactly the tile at this point, if it can burn.
   *
   * Rock does not catch — the same exception the legacy game's fire arrows
   * make — so this only ever clears a tree or a hut. One tile, not a radius:
   * this is a shot landing on what it hit, not a blast. Returns whether
   * anything actually burned, so a caller only bothers telling clients about
   * hits that changed something.
   */
  burnTile(x: number, y: number): boolean {
    const r = Math.floor(y / TILE_SIZE);
    const c = Math.floor(x / TILE_SIZE);
    const tile = this.map.get(r, c);
    if (tile !== TILE.TREE && tile !== TILE.HUT) return false;
    this.map.set(r, c, TILE.EMPTY);
    return true;
  }
}
