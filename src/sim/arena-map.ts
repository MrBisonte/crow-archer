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

import {
  CavernTerrain, MazeTerrain, NoiseTerrain, type MapGenerator,
} from './map-generators';
import { BastionTerrain } from './bastion-terrain';
import { type Noise2D } from './mapgen';
import { mulberry32 } from './rng';
import { TILE, TileMap, tilePassable, type TileId } from './tilemap';

/**
 * A distinct, named map. The set is meant to grow, and every map shares a
 * real generation shape (below) and a visual theme (TILE_THEMES in
 * render/tiles.ts) — the same reason CharacterKind became a table instead of
 * a branch, not the reason GameMode stayed one.
 */
export type MapKind = 'forest' | 'castle' | 'maze' | 'cavern' | 'bastion';

/**
 * How each map builds its grid, one row per MapKind so a fifth map fails to
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
 * into loops. cavern's fill and smoothing are what decide whether it reads as
 * chambers or as gravel: below about four rounds the scatter never collapses
 * into rooms. All of them are free to adjust; nothing downstream reads them.
 */
export const MAP_GEN: Record<MapKind, MapGenerator> = {
  forest: new NoiseTerrain({ density: 0.45 }),
  castle: new NoiseTerrain({ density: 0.5 }),
  maze: new MazeTerrain({ braid: 0.15 }),
  cavern: new CavernTerrain({ fill: 0.44, smoothing: 4, pools: 0.1, fungus: 0.1 }),
  // Sparse on purpose. The fortification is the map; scatter is only enough
  // cover that crossing the open ground is a choice rather than a walk.
  bastion: new BastionTerrain({ scatter: 0.08 }),
};

/**
 * Who fights on a map.
 *
 * `crows` is the original arena population: birds that fly in off the right
 * edge, cross in a straight line with no terrain check, and read as wildlife
 * over open ground. That last part is why it is not universal — the same
 * straight line through a corridor reads as a bug, which is what kept them out
 * of the maze.
 *
 * `soldiers` is a garrison: spearmen, shieldmen and archers that walk, path
 * around terrain, and arrive in composed waves rather than one at a time. A
 * cavern is somebody's dug-out stronghold, so its enemies are the people who
 * dug it.
 *
 * `scripted` is a map whose population is placed by a stage script rather than
 * escalating on a timer. The maze's rat pack and its warden are the only ones,
 * and the distinction is load-bearing: a scripted map must not appear on the
 * Waves map-select screen, because a run there would have two win conditions
 * and mean neither.
 *
 * `siege` is the bastion's: a finite ten-wave ladder drawn from the whole
 * bestiary by sim/siege-run.ts, ending in a win rather than running forever.
 * It is its own value rather than another `scripted` because the two answer
 * differently to the only question that matters downstream today — both stay
 * off the Waves screen, but a scripted map has no wave count at all while a
 * siege has exactly ten — and folding them together would be the same mistake
 * `crows: boolean` made when it answered two questions with one flag.
 */
export type MapPopulation = 'crows' | 'soldiers' | 'scripted' | 'siege';

/**
 * Which populations escalate on the wave timer, and therefore which maps earn
 * a panel on the Waves map-select screen.
 *
 * A table rather than `population !== 'scripted'` so that a fourth population
 * has to state which it is, instead of defaulting itself onto a screen nobody
 * decided to put it on.
 */
const WAVE_POPULATION: Record<MapPopulation, boolean> = {
  crows: true,
  soldiers: true,
  scripted: false,
  siege: false,
};

/** Does this map field an escalating population of its own in Waves mode? */
export const runsWaves = (kind: MapKind): boolean =>
  WAVE_POPULATION[MAP_RULES[kind].population];

/**
 * Per-map rules that are not about generation, one row per MapKind.
 *
 * Separate from MAP_GEN because these outlive generation: MAP_GEN is consulted
 * once to build the grid, these are consulted every time something tries to
 * change it.
 *
 * forest and castle are built from scattered noise, so blowing a hole in one
 * opens a shortcut and nothing else. A maze *is* its walls: clearing them with
 * a Lightning Storm or a Whirlwind turns the level into an open room and
 * deletes the only thing making an unkillable warden dangerous. A cavern is
 * scattered rock again, only grown rather than thresholded, so it goes back to
 * the forest's answer: its walls are cover, not the level.
 *
 * `fogOfWar` is the same argument about sight. Forest, castle and cavern are
 * arenas you read at a glance, and hiding two thirds of one would only make it
 * fiddly. A maze is a level about not knowing what is round the corner, so the
 * corner has to actually hide something.
 *
 * `population` is who lives there, and it used to be a `crows` boolean. That
 * one flag was quietly answering two different questions — "do birds live
 * here" and "does this map field a wave at all" — and they came apart the
 * moment a map wanted a population that was not birds. A map with no crows is
 * not necessarily a map with no waves.
 */
export const MAP_RULES: Record<MapKind, {
  destructibleTerrain: boolean; fogOfWar: boolean; population: MapPopulation;
}> = {
  forest: { destructibleTerrain: true, fogOfWar: false, population: 'crows' },
  castle: { destructibleTerrain: true, fogOfWar: false, population: 'crows' },
  maze: { destructibleTerrain: false, fogOfWar: true, population: 'scripted' },
  cavern: { destructibleTerrain: true, fogOfWar: false, population: 'soldiers' },
  bastion: { destructibleTerrain: true, fogOfWar: false, population: 'siege' },
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

  /**
   * Which map this grid was built from, kept so the methods that change it can
   * read MAP_RULES.
   *
   * A grid alone cannot answer whether its walls may be broken: rock is rock in
   * every map. The alternative was passing the kind to `destroyArea` and
   * `burnTile` at each call site, and the one caller that forgot would flatten
   * a maze in a way nothing would catch.
   */
  readonly kind: MapKind;

  /**
   * Defaults to 'forest' rather than requiring a kind, so callers that build a
   * grid by hand keep the destructible terrain they already had.
   */
  constructor(map: TileMap, kind: MapKind = 'forest') {
    this.map = map;
    this.kind = kind;
  }

  /**
   * Builds the terrain a seed describes. The same seed and kind always give
   * the same map. Defaults to 'forest', today's only map, so every existing
   * caller is unaffected by a kind existing at all.
   */
  static fromSeed(seed: number, noise: NoiseFactory, kind: MapKind = 'forest'): Terrain {
    const map = new TileMap(MAP_ROWS, MAP_COLS);
    map.reset(MAP_GEN[kind].generate(MAP_ROWS, MAP_COLS, mulberry32(seed), noise(seed)));
    return new Terrain(map, kind);
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
   *
   * Nothing happens at all on a map MAP_RULES marks indestructible. A maze is
   * its walls, and one Lightning Storm through them is the difference between a
   * corridor chase and an open room.
   */
  destroyArea(x: number, y: number, radius: number): void {
    if (!MAP_RULES[this.kind].destructibleTerrain) return;
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
        // Saplings go too. Cover that grows back has to be stoppable while it
        // is doing it, or regrowth is something that happens to the player
        // rather than something they play against.
        if (tile === TILE.ROCK || tile === TILE.TREE || tile === TILE.HUT
          || tile === TILE.SAPLING) {
          this.map.set(r, c, TILE.EMPTY);
        }
      }
    }
  }

  /**
   * Burns exactly the tile at this point, if it can burn.
   *
   * Rock does not catch — the same exception the legacy game's fire arrows
   * make — so this only ever clears a tree, a hut, or a sapling on its way to
   * being one again. One tile, not a radius:
   * this is a shot landing on what it hit, not a blast. Returns whether
   * anything actually burned, so a caller only bothers telling clients about
   * hits that changed something.
   *
   * On a map MAP_RULES marks indestructible it always reports false and leaves
   * the tile standing, which is the answer callers already handle for rock. A
   * fire arrow burning a maze open costs the level the same walls a blast
   * would.
   */
  burnTile(x: number, y: number): boolean {
    if (!MAP_RULES[this.kind].destructibleTerrain) return false;
    const r = Math.floor(y / TILE_SIZE);
    const c = Math.floor(x / TILE_SIZE);
    const tile = this.map.get(r, c);
    if (tile !== TILE.TREE && tile !== TILE.HUT && tile !== TILE.SAPLING) return false;
    this.map.set(r, c, TILE.EMPTY);
    return true;
  }
}
