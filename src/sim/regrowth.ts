/**
 * Burnt ground grows back.
 *
 * Every way a map changes today takes something off it. Fire chars a tree to
 * ash, a blast clears rock and huts outright, and nothing ever puts any of it
 * back, so a long waves run ends on a map that has been sanded flat: no cover,
 * no sightline worth breaking, and a fire arrow with nothing left to burn. The
 * arena stops being a place and becomes a floor.
 *
 * This is the other direction, and only for what burned: ash becomes a sapling,
 * a sapling becomes a tree. Rock and huts stay gone, because "the stonework
 * reassembles" is a different and much stranger claim than "it grew back".
 *
 * Pure simulation. It owns no canvas and draws nothing — a tile changing is
 * already the event the render layer listens to, so cover reappearing repaints
 * through exactly the path a tile burning does.
 */

import { MAP_RULES, type MapKind } from './arena-map';
import { TILE, tilePassable, type TileId, type TileMap } from './tilemap';

/**
 * How long the two stages take, in seconds, and how much tiles differ from
 * each other.
 *
 * `stagger` is what keeps a burnt patch from coming back as one square: at 0
 * every tile burnt in the same blast sprouts on the same frame, which reads as
 * a switch being thrown rather than as anything growing.
 */
export interface RegrowthRules {
  /** Seconds of bare ash before a sapling shows. */
  readonly sprout: number;
  /** Seconds more before that sapling is a tree again. */
  readonly mature: number;
  /** Per-tile variation in both delays, as a fraction of each. 0 is lockstep. */
  readonly stagger: number;
}

/**
 * Long enough that burning cover is worth doing, short enough that it matters
 * inside one run. A waves run reaches its first real escalation around a
 * minute in, so cover burnt at the start is back by the time the map is busy
 * enough to need it.
 */
export const DEFAULT_REGROWTH: RegrowthRules = { sprout: 12, mature: 18, stagger: 0.4 };

/**
 * Is something standing on this tile right now?
 *
 * Injected because the simulation's bodies are not this module's to know
 * about, and because it is the one question a test of regrowth would otherwise
 * have to build a whole world to ask.
 */
export type Occupancy = (row: number, col: number) => boolean;

/** What a pending tile is waiting to become. */
type Stage = 'sprout' | 'mature';

interface Pending {
  /** Seconds still to wait. */
  left: number;
  stage: Stage;
}

/**
 * The tile a stage is waiting on, and the one it turns into. A pending tile
 * that no longer holds `from` was changed by something else — burnt again,
 * blasted, walked over by a map regeneration — and is dropped rather than
 * fought over.
 */
const STAGE_TILES: Record<Stage, { from: TileId; to: TileId; next: Stage | null }> = {
  sprout: { from: TILE.ASH, to: TILE.SAPLING, next: 'mature' },
  mature: { from: TILE.SAPLING, to: TILE.TREE, next: null },
};

/**
 * Per-tile variation, from the tile's own coordinates rather than a random
 * draw.
 *
 * Same seed formula the tile art uses, for the same reason: it is stable. Two
 * clients, a replay and a test all get the same answer for the same tile with
 * nothing to synchronise, and no rng to thread through a module that otherwise
 * needs none.
 */
export function regrowthDelay(rules: RegrowthRules, stage: Stage, row: number, col: number): number {
  const base = stage === 'sprout' ? rules.sprout : rules.mature;
  const spread = ((row * 97 + col * 31) % 100) / 100 - 0.5;
  return Math.max(0, base * (1 + rules.stagger * spread * 2));
}

/**
 * Grows a map's burnt tiles back.
 *
 * Watches the grid rather than being told what burned: ash is ash however it
 * got there, so a fire arrow, a lightning storm and a whirlwind all feed this
 * without any of them knowing it exists.
 */
export class Regrowth {
  readonly #map: TileMap;
  readonly #rules: RegrowthRules;
  readonly #occupied: Occupancy;
  /** Keyed by row * cols + col, so a tile has one entry and no string to parse. */
  readonly #pending = new Map<number, Pending>();
  #kind: MapKind;

  constructor(
    map: TileMap,
    kind: MapKind = 'forest',
    rules: RegrowthRules = DEFAULT_REGROWTH,
    occupied: Occupancy = () => false,
  ) {
    this.#map = map;
    this.#kind = kind;
    this.#rules = rules;
    this.#occupied = occupied;
    map.onChange((r, c, _old, tile) => {
      if (tile === TILE.ASH) this.#schedule(r, c, 'sprout');
      // Anything else on a tile this was waiting on means something took the
      // tile back. `tick` would drop it on the next pass anyway; dropping it
      // here keeps the map from holding entries for a burnt-over patch.
      else this.#pending.delete(this.#index(r, c));
    });
    map.onReset(() => this.#pending.clear());
  }

  /**
   * Points this at a freshly generated map.
   *
   * The kind and the clearing go together: pending tiles are coordinates on
   * the grid that just went away, and the rules that govern them are the new
   * map's. Splitting these into two calls is how one gets made without the
   * other.
   */
  retarget(kind: MapKind): void {
    this.#kind = kind;
    this.#pending.clear();
  }

  /** Does this map grow anything back? */
  get active(): boolean {
    // The same gate that decides whether terrain can be broken decides whether
    // it comes back. A maze is its walls: it refuses to be broken, so it has
    // nothing to restore, and a mechanic that quietly grew a tree in a corridor
    // would be breaking the rule from the other side.
    return MAP_RULES[this.#kind].destructibleTerrain;
  }

  /** How many tiles are mid-regrowth. Exposed for the HUD and for tests. */
  get pendingCount(): number {
    return this.#pending.size;
  }

  /**
   * Advances every waiting tile by `dt` seconds.
   *
   * A stage that would leave something solid on a tile a body is standing on
   * waits instead of firing: a tree maturing under one traps it inside
   * terrain, which is the one outcome here worse than cover being slow.
   */
  tick(dt: number): void {
    if (!this.active || this.#pending.size === 0) return;
    // Over a snapshot of the keys, not the live map. Maturing a sapling
    // schedules a fresh entry under the key it just deleted, and a Map visits a
    // re-added key at the end of its order — so iterating the map itself would
    // hand this loop the next stage of a tile it just advanced and charge it
    // the same dt twice.
    for (const index of [...this.#pending.keys()]) {
      const row = Math.floor(index / this.#map.cols);
      const col = index % this.#map.cols;
      // Time still to spend on this tile. A stage that finishes partway
      // through the tick hands what is left of it to the next one, so the two
      // delays add up to the same total however dt is chunked — a caller
      // stepping a whole stage at once gets the answer sixty small steps give.
      let spend = dt;
      for (let entry = this.#pending.get(index); entry !== undefined;) {
        const { from, to, next } = STAGE_TILES[entry.stage];
        // Something else has had this tile since it was scheduled.
        if (this.#map.get(row, col) !== from) {
          this.#pending.delete(index);
          break;
        }
        entry.left -= spend;
        if (entry.left > 0) break;
        // Only a stage that ends in something solid can trap anything, which
        // is why the test is on the tile rather than on the stage: a sapling
        // is walkable, so it grows under a body without asking, and only the
        // tree it becomes has to wait for that body to move.
        if (!tilePassable(to) && this.#occupied(row, col)) {
          // Due, but blocked. Held at zero and retried next tick rather than
          // rescheduled, so cover arrives the moment the tile clears instead
          // of restarting every time someone stands on it.
          entry.left = 0;
          break;
        }
        spend = -entry.left;
        this.#pending.delete(index);
        this.#map.set(row, col, to);
        if (next === null) break;
        this.#schedule(row, col, next);
        entry = this.#pending.get(index);
      }
    }
  }

  #schedule(row: number, col: number, stage: Stage): void {
    if (!this.active) return;
    this.#pending.set(this.#index(row, col), {
      left: regrowthDelay(this.#rules, stage, row, col),
      stage,
    });
  }

  #index(row: number, col: number): number {
    return row * this.#map.cols + col;
  }
}
