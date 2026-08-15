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

/**
 * How much of the leftover correction survives each tick. At 60 Hz, 0.85 puts
 * roughly nine tenths of a correction behind you within a sixth of a second:
 * fast enough not to feel like drifting, slow enough not to read as a jump.
 */
const ERROR_DECAY = 0.85;

/**
 * Pixels the correction closes each tick on top of the decay.
 *
 * Decay alone is asymptotic: an eleven pixel correction still had a third of a
 * pixel left after half a second, which is a body that creeps. A floor on the
 * closing rate ends every correction inside about a fifth of a second.
 */
const ERROR_MIN_CLOSE_PX = 0.25;

/**
 * A correction bigger than this is shown at once. Past a body's width it is not
 * a small disagreement being smoothed away, it is a respawn or a teleport, and
 * sliding there would draw the body through everything in between.
 */
const ERROR_SNAP_PX = 48;

/** Where a body is, in world pixels. */
export interface Position {
  x: number;
  y: number;
}

/** Moves one axis of the outstanding correction towards zero, and reaches it. */
function shrink(value: number): number {
  const decayed = Math.abs(value) * ERROR_DECAY - ERROR_MIN_CLOSE_PX;
  return decayed <= 0 ? 0 : Math.sign(value) * decayed;
}

export class Predictor {
  readonly #world: World;
  readonly #self: PlayerId;
  readonly #dt: number;
  /** Inputs applied locally but not yet acknowledged, oldest first. */
  #unacked: InputCommand[] = [];
  #lastTick = -1;
  /**
   * How far the last correction moved the body, still to be worked off. It is
   * added back when drawing, so the body carries on from where it was and
   * closes the gap over the next few ticks instead of jumping.
   */
  #error: Position = { x: 0, y: 0 };

  constructor(options: PredictorOptions) {
    this.#world = options.world;
    this.#self = options.self;
    this.#dt = options.dt;
  }

  /** How many inputs are outstanding. Useful as a health signal. */
  pending(): number {
    return this.#unacked.length;
  }

  /**
   * Where to draw this client's body: the predicted position with whatever is
   * left of the last correction added back, or null if the world has no such
   * body.
   */
  self(): Position | null {
    const settled = this.settled();
    if (!settled) return null;
    return { x: settled.x + this.#error.x, y: settled.y + this.#error.y };
  }

  /**
   * The predicted position with no smoothing: where the simulation says the
   * body is, as opposed to where it is currently being drawn on the way there.
   */
  settled(): Position | null {
    const body = this.#world.snapshot().find((e) => e.id === this.#self);
    return body ? { x: body.x, y: body.y } : null;
  }

  /** Applies an input locally and remembers it until the server confirms it. */
  predict(cmd: InputCommand): void {
    this.#unacked.push(cmd);
    this.#world.step(this.#dt, new Map([[this.#self, cmd]]));
    this.#decayError();
  }

  /**
   * Takes the server's word for where we are, then replays the inputs it had
   * not yet seen when it sent this.
   *
   * What the correction moved is remembered rather than shown. Snapshots arrive
   * 20 times a second and almost always disagree by a pixel or two, and
   * applying each one straight to the drawn position is a body that shivers.
   */
  reconcile(snap: Snapshot): void {
    if (snap.tick <= this.#lastTick) return;         // arrived out of order
    const mine = snap.entities.find((e) => e.id === this.#self);
    if (!mine) return;                               // says nothing about us
    this.#lastTick = snap.tick;

    const before = this.self();

    this.#world.restore(snap.entities);
    const acked = snap.acks.find((a) => a.id === this.#self)?.seq ?? 0;
    this.#unacked = this.#unacked.filter((cmd) => cmd.seq > acked);
    for (const cmd of this.#unacked) {
      this.#world.step(this.#dt, new Map([[this.#self, cmd]]));
    }

    const after = this.settled();
    if (!before || !after) {
      this.#error = { x: 0, y: 0 };
      return;
    }
    const dx = before.x - after.x;
    const dy = before.y - after.y;
    // A jump this large is a respawn, not a disagreement. Show it.
    this.#error =
      Math.hypot(dx, dy) > ERROR_SNAP_PX ? { x: 0, y: 0 } : { x: dx, y: dy };
  }

  /** Works the outstanding correction off a little on every tick. */
  #decayError(): void {
    this.#error.x = shrink(this.#error.x);
    this.#error.y = shrink(this.#error.y);
  }
}
