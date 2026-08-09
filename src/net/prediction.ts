/**
 * Client-side prediction for this client's own body.
 *
 * The server is authoritative, so a client that waited for it would move a
 * round trip late. Instead the input is applied locally the moment it is made,
 * and every snapshot rewinds to the server's position and replays whatever the
 * server has not acknowledged yet. When client and server agree the correction
 * is invisible; when they disagree the server wins, immediately.
 *
 * Only this client's body is predicted. Remote bodies are interpolated between
 * snapshots instead, because their inputs are not known here.
 */

import type { PlayerId, Snapshot } from './protocol';
import type { InputCommand } from '../sim/input';
import type { World } from '../sim/world';

export interface PredictorOptions {
  /** A world holding at least this client's body. Stepped locally, not shared. */
  world: World;
  /** Which seat this client holds. */
  self: PlayerId;
  /** The fixed step, matching the server's, or replay would drift. */
  dt: number;
}

/** Where a body is, in world pixels. */
export interface Position {
  x: number;
  y: number;
}

export class Predictor {
  readonly #world: World;
  readonly #self: PlayerId;
  readonly #dt: number;
  /** Inputs applied locally but not yet acknowledged, oldest first. */
  #unacked: InputCommand[] = [];
  #lastTick = -1;

  constructor(options: PredictorOptions) {
    this.#world = options.world;
    this.#self = options.self;
    this.#dt = options.dt;
  }

  /** How many inputs are outstanding. Useful as a health signal. */
  pending(): number {
    return this.#unacked.length;
  }

  /** This client's predicted position, or null if the world has no such body. */
  self(): Position | null {
    const body = this.#world.snapshot().find((e) => e.id === this.#self);
    return body ? { x: body.x, y: body.y } : null;
  }

  /** Applies an input locally and remembers it until the server confirms it. */
  predict(cmd: InputCommand): void {
    this.#unacked.push(cmd);
    this.#world.step(this.#dt, new Map([[this.#self, cmd]]));
  }

  /**
   * Takes the server's word for where we are, then replays the inputs it had
   * not yet seen when it sent this.
   */
  reconcile(snap: Snapshot): void {
    if (snap.tick <= this.#lastTick) return;         // arrived out of order
    const mine = snap.entities.find((e) => e.id === this.#self);
    if (!mine) return;                               // says nothing about us
    this.#lastTick = snap.tick;

    this.#world.restore(snap.entities);

    const acked = snap.acks.find((a) => a.id === this.#self)?.seq ?? 0;
    this.#unacked = this.#unacked.filter((cmd) => cmd.seq > acked);
    for (const cmd of this.#unacked) {
      this.#world.step(this.#dt, new Map([[this.#self, cmd]]));
    }
  }
}
