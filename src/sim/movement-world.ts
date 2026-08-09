/**
 * A world with players and nothing else.
 *
 * This is not the game. It exists so the netcode can be proven end to end
 * before the simulation is lifted out of the legacy monolith: inputs reach the
 * server, a world consumes them, a snapshot describes the result, and every
 * client draws the same thing. Getting that right against 60 lines is cheaper
 * than getting it wrong against 4,000.
 *
 * Crows, the boss, projectiles and tiles arrive as later slices, each replacing
 * a piece of this rather than editing around it.
 */

import { EntityKind, type EntitySnapshot, type PlayerId, type PlayerStart } from '../net/protocol';
import { Button, type InputCommand } from './input';
import type { StepInputs, World } from './world';

/** Playable area, the tile grid in pixels. The HUD is a client-side offset. */
export const ARENA_W = 33 * 32;
export const ARENA_H = 21 * 32;

/** Matches the legacy CONFIG, so movement feels the same once the sims merge. */
export const PLAYER_SPEED = 200;
export const PLAYER_RADIUS = 8;
export const PLAYER_MAX_HP = 10;

interface Body {
  id: PlayerId;
  x: number;
  y: number;
  hp: number;
}

export class MovementWorld implements World {
  readonly #bodies: Body[];

  constructor(starts: readonly PlayerStart[]) {
    this.#bodies = starts.map((s) => ({ id: s.id, x: s.x, y: s.y, hp: PLAYER_MAX_HP }));
  }

  step(dt: number, inputs: StepInputs): void {
    for (const body of this.#bodies) {
      const cmd = inputs.get(body.id);
      if (!cmd) continue;
      const { dx, dy } = direction(cmd);
      if (dx === 0 && dy === 0) continue;

      body.x = clamp(body.x + dx * PLAYER_SPEED * dt, ARENA_W);
      body.y = clamp(body.y + dy * PLAYER_SPEED * dt, ARENA_H);
    }
  }

  snapshot(): EntitySnapshot[] {
    return this.#bodies.map((b) => ({
      id: b.id,
      kind: EntityKind.PLAYER,
      // Rounded here rather than at the encoder, so what a client draws is
      // exactly what the server holds and prediction has nothing to reconcile
      // that the wire invented.
      x: Math.round(b.x),
      y: Math.round(b.y),
      hp: b.hp,
      state: 0,
    }));
  }
}

/**
 * Unit vector for the held direction buttons. Opposing buttons cancel, and a
 * diagonal is normalised so it does not outrun a straight line.
 */
function direction(cmd: InputCommand): { dx: number; dy: number } {
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
function clamp(v: number, extent: number): number {
  return Math.min(Math.max(v, PLAYER_RADIUS), extent - PLAYER_RADIUS);
}
