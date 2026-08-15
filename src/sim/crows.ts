/**
 * The crow: a bird that wanders through a duel and is worth shooting.
 *
 * In the single-player game crows are the whole opposition, nine at a time and
 * one every four and a half seconds. Here they are an event. One drifts across
 * every so often, dies to a single hit as it always has, and leaves a powerup
 * where it fell. That gives two players fighting over the middle of the map a
 * reason to stop fighting each other for a moment.
 *
 * It has no hit points and never attacks. A crow that could kill you would be a
 * third team in a two-team match.
 */

import { ARENA_H, ARENA_W } from './arena';
import { ticks } from './tick';

/** Ticks between arrivals. Slow, because the point is that it is an occasion. */
export const CROW_INTERVAL_TICKS = ticks(15);

/** How many may be in the air at once. */
export const MAX_CROWS = 2;

/** Pixels per second. `crowPassiveSpeed` at the legacy fast pace. */
export const CROW_SPEED = 85;

/** How far a crow rises and falls as it crosses. */
const BOB_AMPLITUDE = 40;

/** How close a shot must pass. `arrowHitRadius: 14` in the legacy CONFIG. */
export const CROW_HIT_RADIUS = 14;

export interface Crow {
  id: number;
  x: number;
  y: number;
  /** The height it drifts around, before the bob is added. */
  baseY: number;
  /** Its own offset into the bob, so two crows do not fly in formation. */
  phase: number;
}

/**
 * Where a new crow enters.
 *
 * Off the right edge and heading left, which is the direction they have always
 * flown. `rng` is passed in so the world stays deterministic: two servers
 * replaying the same match must put the same bird in the same place.
 */
export function spawnCrow(id: number, rng: () => number): Crow {
  const baseY = 32 + rng() * (ARENA_H - 64);
  return { id, x: ARENA_W + 20, y: baseY, baseY, phase: rng() * Math.PI * 2 };
}

/**
 * Moves a crow one step. Returns false once it has left the map and should be
 * forgotten rather than wrapped: a match is short, and a bird that keeps coming
 * back stops being an event.
 */
export function advanceCrow(crow: Crow, dt: number, elapsedSeconds: number): boolean {
  crow.x -= CROW_SPEED * dt;
  crow.y = crow.baseY + Math.sin(elapsedSeconds / 3 + crow.phase) * BOB_AMPLITUDE;
  return crow.x > -20;
}
