/**
 * What every networked world shares: the arena's size, how fast a player moves
 * in it, and how held direction buttons become a vector.
 *
 * Two worlds need these now — the movement-only one the netcode was proven
 * against, and the one with arrows in it — so they live here rather than in
 * whichever happened to be written first.
 */

import type { CharacterKind } from '../net/protocol';
import { MAP_COLS, MAP_ROWS, TILE_SIZE } from './arena-map';
import { Button, type InputCommand } from './input';

/**
 * Playable area, the tile grid in pixels. The HUD is a client-side offset.
 *
 * Derived rather than written out, because these used to be a second copy of
 * the grid size and nothing checked them against the first. Resizing the map
 * left the networked worlds clamping bodies to the old box inside the new one,
 * silently. `src/legacy/arena-size.test.ts` now pins all three statements of
 * the size together.
 */
export const ARENA_W = MAP_COLS * TILE_SIZE;
export const ARENA_H = MAP_ROWS * TILE_SIZE;

/**
 * The default for a world with no character of its own: MovementWorld and
 * ArenaWorld move one kind of body and know nothing of `CharacterKind`, so
 * they read these flat constants. BattleWorld and the single-player game read
 * `CHARACTER_STATS` instead, below, where no hero is 200/10 any more.
 */
export const PLAYER_SPEED = 200;
export const PLAYER_RADIUS = 8;
export const PLAYER_MAX_HP = 10;

/**
 * What a character is, as three numbers. Everything else about them is a
 * weapon.
 *
 * `bossDamageMult` is the whole of how hard one character hits, and its name
 * is its scope. It is applied once, where single-player lowers boss health,
 * and it is deliberately the only damage figure that is per-character: crows,
 * skeletons and rats have exactly one hit point and die to one hit of
 * anything, so scaling a hit that already kills would change nothing and
 * scaling the ranger's below 1 would stop his bolts killing crows at all.
 * `BattleWorld` never reads it, because multiplayer has no bosses and tunes
 * its damage per weapon in `weapons.ts`. See docs/balance.md.
 */
export interface CharacterStats {
  speed: number;
  maxHp: number;
  bossDamageMult: number;
}

/**
 * Per-character speed, max health and damage, one row per `CharacterKind`.
 *
 * Read down a column rather than across a row: the knight is the only hero
 * who has to be in contact to do anything, so he carries the most health and
 * the least speed; the wizard hits hardest and dies fastest, which is what
 * "glass cannon" has to mean numerically; the ranger fires three bolts at
 * once, so the volley rather than the bolt is his unit of damage and his is
 * the only multiplier below 1. Archer and sapper share a body on purpose, and
 * are what the rest of the roster is read against.
 *
 * Speed and health are the base the FEATHERS upgrade tree stacks on, not the
 * final figure. The reasoning per row, and the boss health these multipliers
 * are tuned against, are in docs/balance.md.
 */
export const CHARACTER_STATS: Record<CharacterKind, CharacterStats> = {
  archer: { speed: 200, maxHp:  9, bossDamageMult: 1.4 },
  wizard: { speed: 175, maxHp:  7, bossDamageMult: 2.5 },
  knight: { speed: 150, maxHp: 12, bossDamageMult: 1.5 },
  ranger: { speed: 250, maxHp:  8, bossDamageMult: 0.8 },
  sapper: { speed: 200, maxHp:  9, bossDamageMult: 1.2 },
};

/**
 * Unit vector for the held direction buttons. Opposing buttons cancel, and a
 * diagonal is normalised so it does not outrun a straight line.
 */
export function direction(cmd: InputCommand): { dx: number; dy: number } {
  let dx = 0;
  let dy = 0;
  if (cmd.buttons & Button.LEFT) dx -= 1;
  if (cmd.buttons & Button.RIGHT) dx += 1;
  if (cmd.buttons & Button.UP) dy -= 1;
  if (cmd.buttons & Button.DOWN) dy += 1;

  if (dx !== 0 && dy !== 0) {
    const inv = Math.SQRT1_2;
    dx *= inv;
    dy *= inv;
  }
  return { dx, dy };
}

/** Keeps a body inside the arena by its own radius. */
export function clampToArena(v: number, extent: number): number {
  return Math.min(Math.max(v, PLAYER_RADIUS), extent - PLAYER_RADIUS);
}

/** True while a point is still inside the arena, used to cull spent arrows. */
export function insideArena(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x <= ARENA_W && y <= ARENA_H;
}
