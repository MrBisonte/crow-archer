/**
 * A world with players and nothing else.
 *
 * This is not the game. It exists so the netcode can be proven end to end
 * against something small: inputs reach the server, a world consumes them, a
 * snapshot describes the result, and every client draws the same thing. Getting
 * that right against 40 lines is cheaper than getting it wrong against 4,000.
 *
 * It is still the world the client predicts with, because it ignores the fire
 * button. Prediction covers this client's movement and nothing else, so there
 * is no locally invented arrow for a snapshot to take back.
 */

import { EntityKind, type EntitySnapshot, type PlayerId, type PlayerStart } from '../net/protocol';
import { ARENA_H, ARENA_W, PLAYER_MAX_HP, PLAYER_SPEED, clampToArena, direction } from './arena';
import type { StepInputs, World } from './world';

export class MovementWorld implements World {
  readonly #bodies: { id: PlayerId; x: number; y: number; hp: number }[];

  constructor(starts: readonly PlayerStart[]) {
    this.#bodies = starts.map((s) => ({ id: s.id, x: s.x, y: s.y, hp: PLAYER_MAX_HP }));
  }

  step(dt: number, inputs: StepInputs): void {
    for (const body of this.#bodies) {
      const cmd = inputs.get(body.id);
      if (!cmd) continue;
      const { dx, dy } = direction(cmd);
      if (dx === 0 && dy === 0) continue;

      body.x = clampToArena(body.x + dx * PLAYER_SPEED * dt, ARENA_W);
      body.y = clampToArena(body.y + dy * PLAYER_SPEED * dt, ARENA_H);
    }
  }

  remove(id: number): void {
    const i = this.#bodies.findIndex((b) => b.id === id);
    if (i >= 0) this.#bodies.splice(i, 1);
  }

  restore(entities: readonly EntitySnapshot[]): void {
    for (const e of entities) {
      const body = this.#bodies.find((b) => b.id === e.id);
      if (!body) continue;          // a seat this world does not hold
      body.x = e.x;
      body.y = e.y;
      body.hp = e.hp;
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
