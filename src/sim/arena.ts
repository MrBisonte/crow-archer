/**
 * What every networked world shares: the arena's size, how fast a player moves
 * in it, and how held direction buttons become a vector.
 *
 * Two worlds need these now — the movement-only one the netcode was proven
 * against, and the one with arrows in it — so they live here rather than in
 * whichever happened to be written first.
 */

import type { CharacterKind } from '../net/protocol';
import { Button, type InputCommand } from './input';

/** Playable area, the tile grid in pixels. The HUD is a client-side offset. */
export const ARENA_W = 33 * 32;
export const ARENA_H = 21 * 32;

/**
 * Matches the legacy CONFIG, so movement feels the same once the sims merge.
 *
 * The default for a world with no character of its own: MovementWorld and
 * ArenaWorld move one kind of body and know nothing of `CharacterKind`, so
 * they keep reading these flat constants unchanged. BattleWorld reads
 * `CHARACTER_STATS` instead, below.
 */
export const PLAYER_SPEED = 200;
export const PLAYER_RADIUS = 8;
export const PLAYER_MAX_HP = 10;

/** A character's speed and health. Everything else about them is a weapon. */
export interface CharacterStats {
  speed: number;
  maxHp: number;
}

/**
 * Per-character speed and max health, one row per `CharacterKind`.
 *
 * Every row matches the shared defaults above today: nothing has asked a
 * character to move faster or survive more hits than another yet. The table
 * exists anyway, because the day one does, this is the one place that
 * changes, and the compiler refuses to build a `ranger` row short of both
 * fields.
 */
export const CHARACTER_STATS: Record<CharacterKind, CharacterStats> = {
  archer: { speed: PLAYER_SPEED, maxHp: PLAYER_MAX_HP },
  wizard: { speed: PLAYER_SPEED, maxHp: PLAYER_MAX_HP },
  knight: { speed: PLAYER_SPEED, maxHp: PLAYER_MAX_HP },
  ranger: { speed: PLAYER_SPEED, maxHp: PLAYER_MAX_HP },
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
